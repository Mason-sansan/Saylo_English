import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import WebSocket, { WebSocketServer } from 'ws';

import { mountServerAuth } from './authLayer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  assessUserEnglishPractice,
  buildFallbackQuickReport,
  buildNonEnglishPracticeQuickReport,
  buildTooShortPracticeQuickReport,
  buildQuickReportSystemPrompt,
  buildQuickReportUserPrompt,
  extractJsonObject,
  LLM_QUICK_REPORT_TIMEOUT_MS,
  normalizeQuickReport,
  sanitizeHallucinatedDrill,
  sliceTranscriptLastNTurns,
  wrapQuickReportWithLegacy,
  finalizeSessionGrowthMoves,
  netCapForPlacementPrior,
  GROWTH_NET_OVERALL_CAP,
} from './quickReport.js';
import { pickPackFromLibrary } from './sceneLibrary.js';

dotenv.config();

const SERVER_AUTH = String(process.env.SERVER_AUTH ?? '0') === '1';
/** When SERVER_AUTH=1, same middleware instance must run on WebSocket upgrades. */
let sessionAuthMiddleware = null;

const app = express();
if (SERVER_AUTH) {
  app.set('trust proxy', 1);
}
app.use(SERVER_AUTH ? cors({ origin: true, credentials: true }) : cors());
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'english-voice-server' });
});
app.use(express.json({ limit: '2mb' }));
if (SERVER_AUTH) {
  sessionAuthMiddleware = mountServerAuth(app);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

/** 方舟 / 豆包对话（与 OpenAI 兼容的 chat/completions） */
const LLM_BASE_URL = (process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
  /\/$/,
  '',
);
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.ARK_API_KEY || process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || process.env.CHAT_MODEL || 'gpt-4o-mini';
/** Optional faster endpoint for rewrite-only JSON (defaults to LLM_MODEL). */
const NATURAL_COACH_MODEL = String(process.env.NATURAL_COACH_MODEL || LLM_MODEL).trim();

/** Background “more natural” rewrites: debounced batch LLM (see scheduleNaturalCoachingTurn). */
const NATURAL_COACH_DEBOUNCE_MS = Number(process.env.NATURAL_COACH_DEBOUNCE_MS ?? 280);
/** Max learner turns per coaching LLM call — smaller requests finish faster and run in-session; default 2. */
const NATURAL_COACH_MAX_BATCH_TURNS = Math.max(1, Math.floor(Number(process.env.NATURAL_COACH_MAX_BATCH_TURNS ?? 2)));
/** Per coaching request (each chunk ≤ NATURAL_COACH_MAX_BATCH_TURNS). */
const NATURAL_COACH_TIMEOUT_MS = Number(process.env.NATURAL_COACH_TIMEOUT_MS ?? 45000);
/** finishSession: max wall time to spend on remaining coaching after clearing debounce (avoids N×timeout). */
const NATURAL_COACH_DRAIN_MAX_MS = Math.max(
  5000,
  Math.floor(Number(process.env.NATURAL_COACH_DRAIN_MAX_MS ?? 28_000)),
);

/** When false (default): skip blocking quick-report LLM at session end; rules fallback + audio fluency still feed Growth. */
const CONVERSATION_QUICK_REPORT_LLM = String(process.env.CONVERSATION_QUICK_REPORT_LLM ?? '0') === '1';

/** 听力转写：默认走 OpenAI Whisper，可与方舟分开配置 */
const WHISPER_BASE_URL = (process.env.WHISPER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
  /\/$/,
  '',
);
const WHISPER_API_KEY = process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || '';
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'whisper-1';

/** 可选服务端 TTS */
const TTS_BASE_URL = (process.env.TTS_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
  /\/$/,
  '',
);
const TTS_API_KEY = process.env.TTS_API_KEY || process.env.OPENAI_API_KEY || '';
const TTS_MODEL = process.env.TTS_MODEL ?? 'tts-1';
const TTS_VOICE = process.env.TTS_VOICE ?? 'alloy';
const LOCAL_TTS_VOICE = process.env.LOCAL_TTS_VOICE ?? 'Samantha';
const execFile = promisify(execFileCb);
const REALTIME_ENABLED = String(process.env.REALTIME_ENABLED ?? '1') !== '0';
const REALTIME_URL = process.env.REALTIME_URL ?? 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const REALTIME_APP_ID = process.env.REALTIME_APP_ID ?? '';
const REALTIME_ACCESS_KEY = process.env.REALTIME_ACCESS_KEY ?? '';
const REALTIME_RESOURCE_ID = process.env.REALTIME_RESOURCE_ID ?? 'volc.speech.dialog';
const REALTIME_APP_KEY = process.env.REALTIME_APP_KEY ?? 'PlgvMymc7f3tQnJ6';
const REALTIME_MODEL = process.env.REALTIME_MODEL ?? '1.2.1.1';
const REALTIME_SPEAKER = process.env.REALTIME_SPEAKER ?? 'zh_female_vv_jupiter_bigtts';
/**
 * When `1`, if the JSON library yields no pack, call on-demand LLM scenario generation (often ~15–45s).
 * Default off: use `data/conversation-scenes.json` then built-in `CONVERSATION_SCENES` only — fast start.
 */
const CONVERSATION_SCENARIO_LLM = String(process.env.CONVERSATION_SCENARIO_LLM ?? '').trim() === '1';

function requireWhisperKey(res) {
  if (!WHISPER_API_KEY) {
    res.status(501).json({
      error:
        'Listening needs WHISPER_API_KEY (e.g. OpenAI). Ark / LLM_API_KEY alone runs Conversation only. See web/voice-server/.env.example.',
    });
    return false;
  }
  return true;
}

function requireTtsKey(res) {
  if (!TTS_API_KEY) {
    res.status(501).json({
      error:
        'Missing TTS_API_KEY (or OPENAI_API_KEY). The app will fall back to browser speech where implemented.',
    });
    return false;
  }
  return true;
}

async function localDarwinTts(text) {
  const inPath = join(tmpdir(), `english-local-tts-${randomUUID()}.aiff`);
  const outPath = join(tmpdir(), `english-local-tts-${randomUUID()}.wav`);
  try {
    await execFile('say', ['-v', LOCAL_TTS_VOICE, '-o', inPath, text]);
    // Convert AIFF to WAV for best browser compatibility.
    await execFile('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', inPath, outPath]);
    const buf = await readFile(outPath);
    return buf;
  } finally {
    await unlink(inPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);
  }
}

async function llmFetch(path, init) {
  const res = await fetch(`${LLM_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${LLM_API_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 800)}`);
  }
  return res;
}

async function whisperFetch(path, init) {
  const res = await fetch(`${WHISPER_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${WHISPER_API_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Whisper request failed (${res.status}): ${text.slice(0, 800)}`);
  }
  return res;
}

async function ttsFetch(path, init) {
  const res = await fetch(`${TTS_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TTS_API_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TTS request failed (${res.status}): ${text.slice(0, 800)}`);
  }
  return res;
}

async function transcribeAudio({ buffer, originalname, mimetype }) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' });
  form.append('file', blob, originalname || 'audio.webm');
  form.append('model', WHISPER_MODEL);

  const res = await whisperFetch('/audio/transcriptions', { method: 'POST', body: form });
  return await res.json();
}

function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    }),
  ]);
}

function isAbortError(e) {
  return (
    e?.name === 'AbortError' ||
    e?.code === 'ABORT_ERR' ||
    e?.code === 20 ||
    (typeof e?.message === 'string' && /aborted|AbortError/i.test(e.message))
  );
}

/**
 * @param {object} opts
 * @param {string} [opts.tag] Log label so you can see which code path is calling the LLM (and which `model` / ep).
 */
async function chatJson({ system, user, temperature = 0.4, signal, model, tag = 'chat' }) {
  const resolvedModel = model ?? LLM_MODEL;
  // eslint-disable-next-line no-console
  console.info(`[llm] request tag=${tag} model=${resolvedModel} base=${LLM_BASE_URL}`);
  try {
    const res = await llmFetch('/chat/completions', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: resolvedModel,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim?.() ?? '';
    return text;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[llm] failed tag=${tag} model=${resolvedModel}:`, e?.message ?? e);
    throw e;
  }
}

function heuristicAssistantReply({ lastAssistant, userText, turn }) {
  const t = (userText ?? '').trim();
  if (!t) return 'I didn’t catch that. Say it again in one sentence.';
  if (turn <= 1) {
    return 'Got it. What is one concrete example from your week that supports that?';
  }
  if (turn <= 2) {
    return 'What trade-off did you accept, and why?';
  }
  return 'If you had to explain this to a non-technical stakeholder in 20 seconds, what would you say?';
}

function heuristicReport({ transcript }) {
  const lines = transcript
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const lastUser = [...lines].reverse().find((l) => l.startsWith('User:'))?.replace(/^User:\s*/i, '') ?? '';

  return {
    snapshot: 'You can sustain a short professional explanation, but details collapse under follow-up pressure.',
    moved: [{ dimension: 'InteractionQuality', delta: 0.1, reason: 'You answered directly on the last turn.' }],
    held: [{ dimension: 'GrammarAccuracy', reason: 'Not enough clean evidence across multiple turns yet.' }],
    evidence: [
      {
        dimension: 'InteractionQuality',
        quote: lastUser.slice(0, 220) || '(no user text captured)',
        note: 'This is the strongest single-turn signal available in this demo path.',
      },
    ],
    nextTarget: 'Next session: answer the first follow-up with claim → reason → one example, without hedging.',
  };
}

/** Listening script sentence count: 3m → 2, 10m → 3, 20m → 5; sub-minute modes → 1. */
function listeningSentenceCount(duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d < 1) return 1;
  if (d === 3) return 2;
  if (d === 10) return 3;
  if (d === 20) return 5;
  if (d < 10) return 2;
  if (d < 20) return 3;
  return 5;
}

function fallbackListeningScript({ level, duration }) {
  const pool = {
    A2: {
      topic: 'daily life',
      lines: [
        'You have a short plan for this weekend with your family.',
        'You will leave early, buy food tonight, and meet near the station.',
        'If it rains, you will switch to an indoor plan and confirm by message.',
      ],
    },
    B1: {
      topic: 'work coordination',
      lines: [
        'Your team delayed a release because checkout errors increased during peak traffic.',
        'You now plan a smaller rollout on Tuesday with support and monitoring owners on call.',
        'You need one clear update for customers: what changed, why, and what happens next.',
        'A short status note is due before the end of today.',
      ],
    },
    B2: {
      topic: 'cross-team update',
      lines: [
        'The migration is stable in staging, yet production still shows intermittent timeout spikes at peak traffic.',
        'Engineering proposes a phased Tuesday rollout so rollback behavior can be observed with support online and stakeholders aligned.',
        'Sales needs language that protects trust without overcommitting to Friday, while product requests release notes focused on decision, risk, and expected user impact.',
        'Before handoff, ownership must be explicit: one lead for monitoring signals and one lead for communication cadence.',
        'The decision today is not just speed, but whether the rollout plan is reversible under realistic load.',
      ],
    },
  };
  const p = pool[level] ?? pool.B1;
  const n = listeningSentenceCount(duration);
  return { topic: p.topic, script: p.lines.slice(0, n).join(' ') };
}

// sessionId -> { turns: number, transcript: string, opening?: string, scenario?: string }
const sessions = new Map();

/** One line for transcript storage so client parsers never drop ASR newlines as “unknown” lines. */
function oneLineTranscriptChunk(s) {
  return String(s ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

const CONVERSATION_SCENES = [
  {
    id: 'coffee-order-fix',
    title: 'Cafe order issue',
    context: 'You ordered a drink, but it came wrong and you want to fix it politely.',
    coachRole: 'Cafe staff',
    learnerRole: 'Customer',
    openingScript:
      "We're at the counter and I just handed you a drink. Something looks off about your order. Take a breath—tell me what you ordered, and what looks wrong about what you got?",
  },
  {
    id: 'team-standup',
    title: 'Team standup update',
    context: 'Your team is in a short standup and you need to explain progress and one blocker.',
    coachRole: 'Team lead',
    learnerRole: 'Engineer',
    openingScript:
      "Quick standup—we only have a few minutes. I'm listening for what you shipped since yesterday and what's blocking you. What's done, and what's stuck?",
  },
  {
    id: 'airport-change',
    title: 'Airport ticket change',
    context: 'Your flight plan changed, and you need to ask for options and confirm the final one.',
    coachRole: 'Airline agent',
    learnerRole: 'Traveler',
    openingScript:
      "You're at the desk after a schedule change. I can help with rebooking or fees, but I need the facts first. What changed about your trip, and what outcome do you want today?",
  },
  {
    id: 'apartment-call',
    title: 'Apartment inquiry',
    context: 'You are calling about an apartment listing to ask details before visiting.',
    coachRole: 'Listing agent',
    learnerRole: 'Renter',
    openingScript:
      "Thanks for calling about the listing—I'll keep this practical. A lot of people ask about rent, move-in, and what's included. What would you like to know first before we book a visit?",
  },
  {
    id: 'interview-intro',
    title: 'Interview opening',
    context: 'A short interview has started, and you need to present your background clearly.',
    coachRole: 'Interviewer',
    learnerRole: 'Candidate',
    openingScript:
      "We're starting a short interview for this role. I'll keep questions focused—no trick questions. In one or two minutes, walk me through your background and what you're looking for next.",
  },
  {
    id: 'doctor-visit',
    title: 'Clinic visit',
    context: 'You are at a clinic and need to explain symptoms and ask for next steps.',
    coachRole: 'Doctor',
    learnerRole: 'Patient',
    openingScript:
      "Thanks for coming in today. I want to understand what's going on before we decide on tests or treatment. What brought you in, and when did the main symptoms start?",
  },
];

function levelCoachingGuide(level) {
  if (level === 'A1' || level === 'A2') {
    return 'Use short, clear sentences and everyday words. Ask one simple question at a time and speak slowly.';
  }
  if (level === 'B2' || level === 'C1' || level === 'C2') {
    return 'Use natural but concise spoken English with follow-up pressure. Ask open questions that require reasons and examples.';
  }
  return 'Use natural daily English at intermediate level. Keep responses concise, with one clear follow-up question each turn.';
}

function safeRandomIntExclusive(max) {
  try {
    return randomInt(0, max);
  } catch {
    return Math.floor(Math.random() * max);
  }
}

function randomScene() {
  const n = CONVERSATION_SCENES.length;
  const i = safeRandomIntExclusive(n);
  return CONVERSATION_SCENES[i] ?? CONVERSATION_SCENES[0];
}

async function generateRandomScenarioPack({ level, duration }) {
  const maxWords = duration < 1 ? 55 : 70;
  const system =
    'You output strict JSON only. No markdown. ' +
    'Keys: scenarioTitle, situation, coachRole, learnerRole, openingScript. ' +
    'openingScript: English only, spoken aloud, exactly 2 or 3 short sentences. ' +
    'Sentence 1–2: set the scene (where we are, what is happening). ' +
    'Final sentence: invite the learner to respond or ask one clear question. ' +
    'No meta (no "prompt", "scenario", "role play"). No bullet labels. No stage directions in brackets.';
  const user =
    `Randomness seed: ${randomUUID()}\n` +
    `Learner CEFR level (internal, never say it aloud): ${level}.\n` +
    `openingScript: max ${maxWords} words total.\n` +
    'Invent a fresh everyday scenario each time. Vary setting widely: work, travel, health, housing, retail, banking, school, neighbors, interviews, repairs, deliveries, etc.\n' +
    'Make coachRole and learnerRole concrete job titles or social roles.';
  const raw = await chatJson({ system, user, temperature: 0.95, tag: 'scenario_random_pack' });
  let t = String(raw).trim();
  const i0 = t.indexOf('{');
  const i1 = t.lastIndexOf('}');
  if (i0 >= 0 && i1 > i0) t = t.slice(i0, i1 + 1);
  const parsed = JSON.parse(t);
  const title = String(parsed.scenarioTitle ?? '').trim();
  const situation = String(parsed.situation ?? '').trim();
  const coachRole = String(parsed.coachRole ?? '').trim();
  const learnerRole = String(parsed.learnerRole ?? '').trim();
  let openingScript = String(parsed.openingScript ?? parsed.firstLine ?? '').trim();
  openingScript = openingScript.replace(/^["'“”]|[ "'“”]$/g, '').trim();
  if (title.length < 2 || situation.length < 8 || coachRole.length < 2 || learnerRole.length < 2) {
    throw new Error('invalid scenario pack');
  }
  if (openingScript.length < 24) throw new Error('invalid opening script');
  return {
    title: title.slice(0, 120),
    context: situation.slice(0, 500),
    coachRole: coachRole.slice(0, 80),
    learnerRole: learnerRole.slice(0, 80),
    openingScript: openingScript.slice(0, 1400),
  };
}

/**
 * Compact Realtime `dialog.system_role` — long blobs can destabilize turn-taking / ASR on some upstream builds.
 * Event 300 `content` carries the spoken opening script; system_role sets role + explicit listen-after-open.
 */
function buildDialogSystemRole({ pack, level, duration, opening }) {
  const guide = levelCoachingGuide(level);
  const durationHint = duration < 1 ? `${Math.round(duration * 60)} seconds` : `${duration} minutes`;
  const situationShort = String(pack.context ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
  return [
    `You are ${pack.coachRole}. The learner is the ${pack.learnerRole}.`,
    `Topic: ${pack.title}. Context: ${situationShort}`,
    `Session about ${durationHint}. ${guide}`,
    'Do not read labels like "scenario" or "instructions" aloud.',
    'The user is practicing English: their speech is in English; understand English ASR and reply in English.',
    'Your first turn: speak the opening script provided in the session (event 300 content) naturally—same meaning, natural spoken English.',
    'Immediately after you finish that opening, stop and listen: the user will speak. Respond to their speech in character. Keep turns concise.',
  ].join('\n');
}

async function createConversationSession(opts = {}) {
  const level = String(opts.level ?? 'B1');
  const duration = Number(opts.duration ?? 10);
  const sessionId = randomUUID();
  let pack = await pickPackFromLibrary(level);
  if (!pack && CONVERSATION_SCENARIO_LLM && LLM_API_KEY) {
    // eslint-disable-next-line no-console
    console.info('[conversation] library had no pack; generating scenario via LLM (set CONVERSATION_SCENARIO_LLM=0 to skip)');
    try {
      pack = await withTimeout(generateRandomScenarioPack({ level, duration }), 45000);
    } catch (e) {
      console.warn('[conversation] generateRandomScenarioPack failed, using built-in scenes:', e?.message ?? e);
      pack = null;
    }
  } else if (!pack && LLM_API_KEY && !CONVERSATION_SCENARIO_LLM) {
    // eslint-disable-next-line no-console
    console.info('[conversation] library had no pack; using built-in scenes (LLM scenario gen off; set CONVERSATION_SCENARIO_LLM=1 to enable)');
  }
  if (!pack) {
    const scene = randomScene();
    pack = {
      title: scene.title,
      context: scene.context,
      coachRole: scene.coachRole,
      learnerRole: scene.learnerRole,
      openingScript: scene.openingScript,
    };
  }
  const opening = oneLineTranscriptChunk(String(pack.openingScript ?? pack.firstLine ?? '').trim());
  if (opening.length < 12) {
    throw new Error('Opening script missing or too short.');
  }
  const dialogSystemRole = buildDialogSystemRole({ pack, level, duration, opening });
  sessions.set(sessionId, {
    turns: 0,
    transcript: `Assistant: ${opening}\n`,
    opening,
    scenario: pack.title,
    startedAt: Date.now(),
    pcm16Bytes: 0,
    level,
    duration,
    /** ASR final for the current user turn (committed to transcript on turn end). */
    turnDraftUser: '',
    /** Latest full assistant text for this turn; 550 may fire many times (streaming). */
    turnDraftAssistant: '',
    /** Last ASR final text (fallback if draft user empty at flush). */
    lastAsrFinal: '',
    naturalCoachSeq: 0,
    naturalCoachQueue: [],
    naturalCoachResults: Object.create(null),
    naturalCoachTimer: null,
    naturalCoachChain: Promise.resolve(),
  });
  return { sessionId, opening, scene: pack.title, dialogSystemRole };
}

/**
 * Realtime 550 `content` may be cumulative (full text so far) or incremental deltas.
 * Replacing with the last chunk only loses the beginning/middle — merge both shapes.
 */
function mergeAssistantStreamChunk(prev, chunkRaw) {
  const p = String(prev ?? '');
  const c = String(chunkRaw ?? '');
  const ct = c.trim();
  if (!ct) return p;
  const pTrim = p.trimEnd();
  if (!pTrim) return c;

  if (c.startsWith(p) || c.startsWith(pTrim) || ct.startsWith(pTrim)) {
    return c.length >= p.length ? c : p;
  }
  if (pTrim.startsWith(ct) && pTrim.length >= ct.length) {
    return p;
  }
  if (pTrim.includes(ct) && ct.length <= pTrim.length) {
    return p;
  }
  if (pTrim.endsWith(ct)) {
    return p;
  }

  const endsOkForAppend =
    /\s$/.test(pTrim) ||
    /[.,;:!?…'")\]\}]$/u.test(pTrim) ||
    /[\u2013\u2014-]$/u.test(pTrim);
  const joiner = endsOkForAppend ? '' : ' ';
  return pTrim + joiner + ct;
}

const NATURAL_COACH_NOTE_MAX_CHARS = 320;

const NATURAL_COACH_SYSTEM =
  'You are an expert spoken-English coach. For each learner turn, give a MORE NATURAL spoken rewrite that keeps the same meaning and intent. Match formality to the assistant_before_user line (casual vs work).\n' +
  'Rules:\n' +
  '- Output valid JSON only. No markdown fences.\n' +
  '- The "rewrite" field must ONLY improve the learner\'s "user" sentence for that turn. Never copy or paraphrase "assistant_reply" or assistant_before_user — those lines are context only.\n' +
  '- For each turn, set already_natural to true if the user sentence is already fully natural; rewrite may match the original or be a tiny optional tweak.\n' +
  '- NEVER leave "rewrite" empty unless skip is true. If already_natural, copy the user line into rewrite or a tiny tweak.\n' +
  '- Optional "note": one short sentence for the learner explaining why the rewrite works better (idiom, register, tone). Write the explanation in Chinese (Simplified). When you cite the learner\'s exact English words, keep those quoted fragments in English — only the surrounding commentary should be Chinese. Omit if it repeats the rewrite or adds nothing.\n' +
  '- If there is nothing useful to say, set skip to true (rare).\n' +
  'Schema: { "items": [ { "id": <number>, "rewrite": "<string>", "note": "<string optional>", "already_natural": <boolean>, "skip": <boolean> } ] }\n' +
  'Each id MUST match a turn id from the user message exactly. Include one item per turn in the same order as input.';

/** @param {string} transcript */
function lastAssistantLineFromTranscript(transcript) {
  let last = '';
  for (const line of String(transcript ?? '').split('\n')) {
    const t = line.trim();
    if (/^Assistant:\s*/i.test(t)) {
      last = t.replace(/^Assistant:\s*/i, '').trim();
    }
  }
  return last;
}

/** @param {string} text */
function shouldSkipNaturalCoaching(text) {
  const t = String(text ?? '').trim();
  if (!t || t === '(audio turn)') return true;
  /** Short answers still get coaching if they carry a phrase (avoid “no 批改” on brief but valid English). */
  if (t.length < 4) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return true;
  const norm = t.toLowerCase().replace(/[^a-z0-9\s']/gi, '').trim();
  if (words.length <= 4) {
    const bc =
      /^(yeah|yes|yep|yup|no|nope|nah|ok|okay|sure|right|fine|thanks|thank you|got it|makes sense|sounds good|fair enough|i see)(\s|$)/i.test(
        norm,
      );
    if (bc) return true;
  }
  return false;
}

/** Normalize for comparing coach vs learner strings (English coaching). */
function normalizeCoachText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect when the model mistakenly puts the assistant's reply (or nearly it) into "rewrite".
 * @param {string} rewrite
 * @param {string} assistantReply
 */
function rewriteEchoesAssistantReply(rewrite, assistantReply) {
  const r = normalizeCoachText(rewrite);
  const a = normalizeCoachText(assistantReply);
  if (r.length < 10 || a.length < 14) return false;
  if (r === a) return true;
  const shorter = r.length <= a.length ? r : a;
  const longer = r.length > a.length ? r : a;
  if (longer.length >= 24 && longer.includes(shorter) && shorter.length >= Math.min(24, longer.length * 0.45)) {
    return true;
  }
  let pref = 0;
  const maxPref = Math.min(r.length, a.length);
  while (pref < maxPref && r[pref] === a[pref]) pref += 1;
  return pref >= 24 && pref >= maxPref * 0.72;
}

/** @param {Record<string, unknown>|null|undefined} obj @param {string[]} keys */
function firstNonEmptyStringField(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

const NATURAL_COACH_REWRITE_KEYS = [
  'rewrite',
  'suggestion',
  'improved',
  'more_natural',
  'natural_rewrite',
  'output',
  'content',
  'revised',
  'rephrase',
  'rephrased',
  'better',
  'natural',
  'spoken',
  'fixed',
  'correction',
  'natural_line',
  'user_line_improved',
  'natural_version',
  'improved_sentence',
  'spoken_rewrite',
  'moreNatural',
];

const NATURAL_COACH_META_KEYS = new Set([
  'id',
  'tag',
  'note',
  'rationale',
  'why',
  'explanation',
  'hint',
  'skip',
  'reason',
  'already_natural',
  'alreadyNatural',
  'turn_id',
  'seq',
  'turnId',
  'turn_index',
  'index',
]);

/** @param {unknown} raw */
function clampCoachNote(raw) {
  const t = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!t) return '';
  const max = NATURAL_COACH_NOTE_MAX_CHARS;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** @param {any} it */
function pickCoachNote(it) {
  if (!it || typeof it !== 'object') return '';
  const n = it.note ?? it.rationale ?? it.why ?? it.explanation ?? it.hint;
  return clampCoachNote(typeof n === 'string' ? n : '');
}

/**
 * @param {any} it
 * @param {number} seq
 * @param {string} [userFallback] learner line for this turn (used when model says already_natural but omits rewrite)
 * @param {string} [assistantReply] same-turn assistant line — must not appear as "rewrite"
 */
function normalizeNaturalCoachingItem(it, seq, userFallback = '', assistantReply = '') {
  let rewrite = firstNonEmptyStringField(it, NATURAL_COACH_REWRITE_KEYS);

  if (!rewrite && it && typeof it === 'object') {
    for (const [k, v] of Object.entries(it)) {
      if (NATURAL_COACH_META_KEYS.has(k)) continue;
      if (typeof v === 'string' && v.trim().length > 2 && /[a-zA-Z]/.test(v)) {
        rewrite = v.trim();
        break;
      }
    }
  }

  if (rewrite) {
    if (rewriteEchoesAssistantReply(rewrite, assistantReply)) {
      const u = String(userFallback ?? '').trim();
      if (u && u !== '(audio turn)') {
        const out = { seq, rewrite: u, already_natural: true };
        const note = pickCoachNote(it);
        if (note) out.note = note;
        return out;
      }
      return { seq, skip: true, reason: 'model_echoed_assistant' };
    }
    const alreadyNatural = it?.already_natural === true || it?.alreadyNatural === true;
    const out = { seq, rewrite, already_natural: alreadyNatural };
    const note = pickCoachNote(it);
    if (note) out.note = note;
    return out;
  }
  if (it?.skip === true) {
    const reason = String(it?.reason ?? '').trim() || 'skipped';
    return { seq, skip: true, reason };
  }
  if (it?.already_natural === true || it?.alreadyNatural === true) {
    const u = String(userFallback ?? '').trim();
    if (u) {
      const out = { seq, rewrite: u, already_natural: true };
      const note = pickCoachNote(it);
      if (note) out.note = note;
      return out;
    }
    return { seq, rewrite: 'Sounds natural as-is.', already_natural: true };
  }
  // eslint-disable-next-line no-console
  console.warn('[conversation] natural coaching empty_rewrite', { seq, keys: it && typeof it === 'object' ? Object.keys(it) : [] });
  return { seq, skip: true, reason: 'empty_rewrite' };
}

/**
 * Small / fast models often return a different JSON shape than requested (no `items` array, alternate keys, or id field names).
 * @param {any} parsed
 * @returns {any[]}
 */
function extractNaturalCoachItemsArray(parsed) {
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed;

  const o = parsed;
  const asArr = (v) => (Array.isArray(v) ? v : null);
  let fromKey =
    asArr(o.items) ??
    asArr(o.results) ??
    asArr(o.data) ??
    asArr(o.turns) ??
    asArr(o.coaching) ??
    asArr(o.suggestions) ??
    asArr(o.rewrites);
  if (fromKey) return fromKey;

  if (o.items && typeof o.items === 'object' && !Array.isArray(o.items)) {
    const entries = Object.entries(o.items);
    if (entries.length) {
      const allNumKeys = entries.every(([k]) => Number.isFinite(Number(k)));
      if (allNumKeys) {
        return entries
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([, v]) => v)
          .filter((v) => v && typeof v === 'object');
      }
    }
  }

  if (typeof o === 'object') {
    const hasRewriteShape =
      typeof o.rewrite === 'string' ||
      o.skip === true ||
      o.already_natural === true ||
      o.suggestion != null ||
      o.improved != null ||
      o.more_natural != null;
    if (hasRewriteShape) return [o];
  }

  return [];
}

/** @param {any} x */
function naturalCoachItemNumericId(x) {
  const raw = x?.id ?? x?.turn_id ?? x?.seq ?? x?.turnId ?? x?.turn_index ?? x?.index;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** @param {any} s @param {string} sessionId */
function scheduleNaturalCoachingTurn(s, sessionId, { user, precedingAssistant, assistantReply }) {
  if (!sessionId || !s) return;
  const seq = (s.naturalCoachSeq = (s.naturalCoachSeq || 0) + 1);
  const u = String(user ?? '').trim();
  if (!LLM_API_KEY) {
    s.naturalCoachResults[seq] = { skip: true, reason: 'no_llm' };
    return;
  }
  if (!u || u === '(audio turn)' || shouldSkipNaturalCoaching(u)) {
    s.naturalCoachResults[seq] = { skip: true, reason: 'short_or_backchannel' };
    return;
  }
  s.naturalCoachQueue.push({
    seq,
    user: u,
    precedingAssistant: String(precedingAssistant ?? '').trim(),
    assistantReply: String(assistantReply ?? '').trim(),
  });
  if (s.naturalCoachTimer) clearTimeout(s.naturalCoachTimer);
  s.naturalCoachTimer = setTimeout(() => {
    s.naturalCoachTimer = null;
    s.naturalCoachChain = s.naturalCoachChain
      .then(() => runNaturalCoachingBatch(sessionId))
      .catch(() => {});
  }, NATURAL_COACH_DEBOUNCE_MS);
}

function truncateNaturalCoachQueue(s, errorText) {
  if (!s?.naturalCoachQueue?.length) return;
  for (const b of s.naturalCoachQueue.splice(0)) {
    s.naturalCoachResults[b.seq] = { skip: true, reason: 'drain_cap', error: errorText };
  }
}

/**
 * Process coaching queue in chunks of NATURAL_COACH_MAX_BATCH_TURNS so work runs during the session
 * (short LLM calls) and end-of-session drain usually has little or nothing left.
 * @param {string} sessionId
 * @param {{ deadline?: number }} [opts] If `deadline` (epoch ms), stop early and truncate queue past budget.
 */
async function runNaturalCoachingBatch(sessionId, opts = {}) {
  const deadline = opts.deadline ?? null;

  while (true) {
    const s = sessions.get(sessionId);
    if (!s || !s.naturalCoachQueue.length) return;

    if (deadline != null && Date.now() >= deadline) {
      truncateNaturalCoachQueue(
        s,
        `Coaching truncated (session drain budget ${NATURAL_COACH_DRAIN_MAX_MS}ms).`,
      );
      // eslint-disable-next-line no-console
      console.warn('[conversation] natural coaching hit drain deadline inside batch loop');
      return;
    }

    const take = Math.min(NATURAL_COACH_MAX_BATCH_TURNS, s.naturalCoachQueue.length);
    const batch = s.naturalCoachQueue.splice(0, take);

    if (!LLM_API_KEY) {
      for (const b of batch) s.naturalCoachResults[b.seq] = { skip: true, reason: 'no_llm' };
      continue;
    }

    let perBatchMs = NATURAL_COACH_TIMEOUT_MS;
    if (deadline != null) {
      const left = deadline - Date.now();
      if (left <= 2500) {
        s.naturalCoachQueue.unshift(...batch);
        truncateNaturalCoachQueue(
          s,
          `Coaching truncated (session drain budget ${NATURAL_COACH_DRAIN_MAX_MS}ms).`,
        );
        return;
      }
      perBatchMs = Math.min(NATURAL_COACH_TIMEOUT_MS, left);
    }

    const scenario = String(s.scenario ?? 'English practice');
    const payload = batch.map((b) => ({
      id: b.seq,
      assistant_before_user: b.precedingAssistant,
      user: b.user,
      assistant_reply: b.assistantReply,
    }));
    const userMsg =
      `Scenario: ${scenario}\nTurns (JSON):\n${JSON.stringify(payload, null, 2)}\n` +
      'Return { "items": [...] } with one object per turn, ids matching input.\n' +
      'Each "rewrite" must improve only that object\'s "user" text; never output the assistant_reply text as rewrite.';

    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), perBatchMs);
    try {
      const raw = await chatJson({
        system: NATURAL_COACH_SYSTEM,
        user: userMsg,
        temperature: 0.25,
        signal: ac.signal,
        model: NATURAL_COACH_MODEL,
        tag: 'natural_coach',
      });
      const parsed = JSON.parse(extractJsonObject(raw));
      const items = extractNaturalCoachItemsArray(parsed);
      const byId = new Map();
      for (const x of items) {
        const id = naturalCoachItemNumericId(x);
        if (id != null) byId.set(id, x);
      }
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i];
        let it = null;
        const positionalOk = items.length === batch.length && items.every((x) => x != null);
        if (positionalOk) {
          it = items[i];
        } else {
          it = byId.get(b.seq);
          if (!it && items[i] != null) it = items[i];
          if (!it && batch.length === 1 && items.length === 1) it = items[0];
        }
        if (!it) {
          // eslint-disable-next-line no-console
          console.warn('[conversation] natural coaching missing_in_model', {
            seq: b.seq,
            batchIndex: i,
            batchLen: batch.length,
            itemsLen: items.length,
            parsedTopKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 12) : [],
            rawHead: String(raw).slice(0, 220),
          });
          s.naturalCoachResults[b.seq] = { skip: true, reason: 'missing_in_model' };
          continue;
        }
        s.naturalCoachResults[b.seq] = normalizeNaturalCoachingItem(it, b.seq, b.user, b.assistantReply);
      }
    } catch (e) {
      let err = e instanceof Error ? e.message : String(e);
      if (isAbortError(e)) {
        err = `natural_coach_llm_timeout_${perBatchMs}ms`;
      }
      // eslint-disable-next-line no-console
      console.warn('[conversation] natural coaching batch failed', {
        model: NATURAL_COACH_MODEL,
        turnsInBatch: batch.length,
        maxBatchTurns: NATURAL_COACH_MAX_BATCH_TURNS,
        perBatchMs,
        error: err,
      });
      for (const b of batch) {
        s.naturalCoachResults[b.seq] = { skip: true, reason: 'error', error: err };
      }
    } finally {
      clearTimeout(tid);
    }
  }
}

/** @param {string} sessionId */
async function drainNaturalCoaching(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (s.naturalCoachTimer) {
    clearTimeout(s.naturalCoachTimer);
    s.naturalCoachTimer = null;
  }
  await s.naturalCoachChain.catch(() => {});
  /** Budget starts after in-flight coaching chain — avoids counting a long in-session request against drain. */
  const deadline = Date.now() + NATURAL_COACH_DRAIN_MAX_MS;
  while (s.naturalCoachQueue.length && Date.now() < deadline) {
    await runNaturalCoachingBatch(sessionId, { deadline });
    const s2 = sessions.get(sessionId);
    if (!s2) return;
    await s2.naturalCoachChain.catch(() => {});
  }
  const s3 = sessions.get(sessionId);
  if (s3?.naturalCoachQueue.length) {
    truncateNaturalCoachQueue(
      s3,
      `Coaching skipped to finish session (drain budget ${NATURAL_COACH_DRAIN_MAX_MS}ms).`,
    );
    // eslint-disable-next-line no-console
    console.warn('[conversation] natural coaching queue truncated after drain budget');
  }
}

/** @param {any} s */
function buildNaturalCoachingList(s) {
  const o = s.naturalCoachResults || {};
  return Object.keys(o)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((seq) => ({ ...(o[seq] || {}), seq }));
}

/**
 * Commit one dialog turn to transcript. Event 550 may fire many times per turn (streaming);
 * we accumulate assistant text in turnDraftAssistant and commit on 359 or session end.
 * @param {string} [userFallback] e.g. last ASR final if turnDraftUser was cleared
 * @param {string|null} [sessionId] when set, enqueue background natural-coaching for this user line
 */
function flushDialogTurnDraft(s, userFallback = '', sessionId = null) {
  if (!s) return;
  const uRaw = String(s.turnDraftUser ?? '').trim() || String(userFallback ?? '').trim();
  const u = oneLineTranscriptChunk(uRaw) || oneLineTranscriptChunk(String(userFallback ?? '').trim());
  const a = oneLineTranscriptChunk(String(s.turnDraftAssistant ?? '').trim());
  if (!u && !a) return;
  const precedingAssistant = lastAssistantLineFromTranscript(s.transcript);
  if (a) {
    s.transcript += `User: ${u || '(audio turn)'}\nAssistant: ${a}\n`;
    s.turns = (s.turns || 0) + 1;
    if (sessionId) {
      scheduleNaturalCoachingTurn(s, sessionId, {
        user: u || '(audio turn)',
        precedingAssistant,
        assistantReply: a,
      });
    }
  } else if (u) {
    s.transcript += `User: ${u}\n`;
    if (sessionId) {
      scheduleNaturalCoachingTurn(s, sessionId, { user: u, precedingAssistant, assistantReply: '' });
    }
  }
  s.turnDraftUser = '';
  s.turnDraftAssistant = '';
  /** Avoid session-end flush re-appending the same user line after 359 already committed the turn. */
  s.lastAsrFinal = '';
}

async function runTurn(sessionId, userText) {
  if (!sessionId || !sessions.has(sessionId)) throw new Error('Invalid sessionId.');
  const clean = String(userText ?? '').trim();
  if (!clean) throw new Error('userText is required.');
  const s = sessions.get(sessionId);
  s.turns += 1;
  s.transcript += `User: ${clean}\n`;

  let assistant = '';
  if (LLM_API_KEY) {
    const system =
      'You are a calm, professional English conversation trainer. ' +
      'Style: natural spoken chat, concise, specific, no emoji, no lecture tone. ' +
      'You may ask a follow-up when useful, but do NOT force one every turn. ' +
      'Keep momentum like a real conversation, react to what the user just said.';
    const user =
      `Conversation transcript so far:\n${s.transcript}\n` +
      `Write the next assistant message only.`;
    assistant = await chatJson({ system, user, tag: 'turn_text_api' });
  } else {
    assistant = heuristicAssistantReply({
      lastAssistant: '',
      userText: clean,
      turn: s.turns,
    });
  }

  s.transcript += `Assistant: ${assistant}\n`;
  return { assistant, turn: s.turns };
}

/** Client sends mono PCM16 little-endian @ 16 kHz (see App.tsx VoicePathA). */
const USER_PCM_SAMPLE_RATE = 16000;

function computeAudioMetrics(session, transcript) {
  const pcm16 = session.pcm16Bytes || 0;
  const speechSec = pcm16 / 2 / USER_PCM_SAMPLE_RATE;
  const wallSec = Math.max(0.5, (Date.now() - (session.startedAt || Date.now())) / 1000);
  const userLines = String(transcript ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^User:/i.test(l))
    .map((l) => l.replace(/^User:\s*/i, '').trim());
  const userText = userLines.join(' ');
  const words = userText ? userText.split(/\s+/).filter(Boolean).length : 0;
  const wpm = speechSec >= 0.35 ? (words / speechSec) * 60 : 0;
  const activityRatio = wallSec > 0 ? speechSec / wallSec : 0;
  const fillerRe = /\b(um|uh|er|ah|like|you know)\b/gi;
  const fillers = (userText.match(fillerRe) || []).length;
  const fillerRate = words > 0 ? fillers / words : 0;
  return {
    speechSeconds: Math.round(speechSec * 10) / 10,
    wallSeconds: Math.round(wallSec * 10) / 10,
    userWords: words,
    userTurns: userLines.length,
    estimatedWpm: Math.round(wpm * 10) / 10,
    activityRatio: Math.round(activityRatio * 100) / 100,
    fillerCount: fillers,
    fillerRate: Math.round(fillerRate * 1000) / 1000,
  };
}

function oralFluencySignalFromAudio(m) {
  let score = 0.52;
  if (m.speechSeconds < 0.8) score -= 0.18;
  if (m.userWords < 4) score -= 0.12;
  if (m.estimatedWpm >= 80 && m.estimatedWpm <= 200) score += 0.18;
  else if (m.estimatedWpm > 0 && m.estimatedWpm < 50) score -= 0.14;
  else if (m.estimatedWpm > 240) score -= 0.1;
  if (m.fillerRate > 0.14) score -= 0.12;
  if (m.fillerRate > 0.24) score -= 0.08;
  if (m.activityRatio > 0.65) score -= 0.06;
  return Math.max(0, Math.min(1, score));
}

function deltaFromFluencySignal(sig) {
  if (sig >= 0.62) return 0.1;
  if (sig <= 0.36) return -0.1;
  return 0;
}

function reportMentionsOralFluency(report) {
  const hit = (x) => String(x?.dimension ?? '') === 'OralFluency';
  return (
    (report.moved ?? []).some(hit) ||
    (report.held ?? []).some(hit) ||
    (report.evidence ?? []).some(hit)
  );
}

function applyAudioFluencyFromMetrics(report, metrics) {
  if (!report) return report;
  report.audioMetrics = metrics;
  if (reportMentionsOralFluency(report)) return report;
  const sig = oralFluencySignalFromAudio(metrics);
  const delta = deltaFromFluencySignal(sig);
  const pct = Math.round(metrics.fillerRate * 100);
  const reason =
    delta === 0
      ? `Audio-derived: ~${metrics.estimatedWpm} wpm over ${metrics.speechSeconds}s speech; ${metrics.fillerCount} fillers (${pct}% of words). Mid band — no step change.`
      : `Audio-derived: ~${metrics.estimatedWpm} wpm, ${metrics.speechSeconds}s captured speech, fillers ${metrics.fillerCount} (${pct}% of words).`;
  if (!report.moved) report.moved = [];
  if (!report.held) report.held = [];
  if (delta !== 0) {
    report.moved.push({
      dimension: 'OralFluency',
      delta,
      reason,
    });
  } else {
    report.held.push({
      dimension: 'OralFluency',
      reason,
    });
  }
  return report;
}

async function finishSession(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) throw new Error('Invalid sessionId.');
  const s = sessions.get(sessionId);
  /** Only flush real drafts; do not use lastAsrFinal here (would duplicate User after turn_complete). */
  flushDialogTurnDraft(s, '', sessionId);
  await drainNaturalCoaching(sessionId);
  const s2 = sessions.get(sessionId);
  if (!s2) throw new Error('Session missing after drainNaturalCoaching.');
  const naturalCoaching = buildNaturalCoachingList(s2);
  const transcript = s2.transcript;
  const level = String(s2.level ?? 'B1');
  const duration = Number(s2.duration ?? 10);
  const metrics = computeAudioMetrics(s2, transcript);
  const metricsBlock = `\n\nAudio-derived metrics (PCM16 mono @16kHz from client; use for OralFluency context only): ${JSON.stringify(metrics)}`;
  const slice = sliceTranscriptLastNTurns(transcript, 16);

  const t0 = Date.now();
  let quick;
  const lang = assessUserEnglishPractice(transcript);
  if (lang === 'non_english') {
    quick = buildNonEnglishPracticeQuickReport({ transcript, level, duration });
    quick.meta.latency_ms = Date.now() - t0;
  } else if (lang === 'too_short') {
    quick = buildTooShortPracticeQuickReport({ transcript, level, duration });
    quick.meta.latency_ms = Date.now() - t0;
  } else if (LLM_API_KEY && CONVERSATION_QUICK_REPORT_LLM) {
    try {
      const raw = await withTimeout(
        chatJson({
          system: buildQuickReportSystemPrompt(),
          user: buildQuickReportUserPrompt({ slice, level, duration, metricsBlock }),
          temperature: 0.35,
          tag: 'quick_report_end',
        }),
        LLM_QUICK_REPORT_TIMEOUT_MS,
      );
      const parsed = JSON.parse(extractJsonObject(raw));
      quick = normalizeQuickReport(parsed, {
        level,
        duration,
        latencyMs: Date.now() - t0,
        source: 'llm',
        model: LLM_MODEL,
      });
      quick = sanitizeHallucinatedDrill(quick, slice);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[conversation] quick report LLM path failed, using rules fallback:', e?.message ?? e);
      quick = buildFallbackQuickReport({ transcript, level, duration });
      quick.meta.latency_ms = Date.now() - t0;
      quick.meta.source = 'fallback';
    }
  } else {
    quick = buildFallbackQuickReport({ transcript, level, duration });
    quick.meta.latency_ms = Date.now() - t0;
    quick.meta.source = CONVERSATION_QUICK_REPORT_LLM ? 'fallback' : 'rules_fast';
    quick.meta.model = quick.meta.model || 'rules_v1';
  }

  const priorKnown = Boolean(s2.placementStateReceived);
  const prior = priorKnown
    ? Math.max(0, Math.min(10000, Math.floor(Number(s2.placementPriorScored ?? 0))))
    : null;
  const netCap = prior === null ? GROWTH_NET_OVERALL_CAP : netCapForPlacementPrior(prior);
  const placement =
    prior === null
      ? undefined
      : {
          priorScored: prior,
          ordinal: prior + 1,
          netCap,
          phase: prior < 3 ? 'calibrating' : 'steady',
        };

  let report = wrapQuickReportWithLegacy(quick, metrics, transcript, { netCap, placement });
  if (quick.meta?.language_gate !== 'non_english') {
    report = applyAudioFluencyFromMetrics(report, metrics);
    report = finalizeSessionGrowthMoves(report);
  }
  if (report?._growthLog) {
    // eslint-disable-next-line no-console
    console.log('[growth] cefr session', { sessionId, ...report._growthLog });
    delete report._growthLog;
  }
  const withRewrite = naturalCoaching.filter((x) => x.rewrite && !x.skip).length;
  if (!String(transcript ?? '').trim()) {
    // eslint-disable-next-line no-console
    console.warn('[conversation] session ended with empty transcript', { sessionId });
  }
  // eslint-disable-next-line no-console
  console.log('[conversation] session summary', {
    sessionId,
    transcriptChars: String(transcript ?? '').length,
    naturalCoachingTotal: naturalCoaching.length,
    naturalCoachingWithRewrite: withRewrite,
    quickSource: quick.meta?.source ?? 'unknown',
  });
  sessions.delete(sessionId);
  return { transcript, report, naturalCoaching };
}

function parseProtocolFrame(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (data.length < 8) return null;
  const headerSize = (data[0] & 0x0f) * 4;
  const messageType = (data[1] >> 4) & 0x0f;
  const flags = data[1] & 0x0f;
  const serialization = (data[2] >> 4) & 0x0f;
  let offset = headerSize;
  if (offset < 4 || offset > data.length) return null;
  let code = null;
  let eventId = null;
  if (messageType === 0x0f) {
    if (data.length < offset + 4) return null;
    code = data.readUInt32BE(offset);
    offset += 4;
  }
  if (flags === 0x04) {
    if (data.length < offset + 4) return null;
    eventId = data.readUInt32BE(offset);
    offset += 4;
  }
  let sessionId = '';
  if (data.length >= offset + 4) {
    const maybeLen = data.readUInt32BE(offset);
    if (maybeLen > 0 && maybeLen < 1024 && data.length >= offset + 4 + maybeLen + 4) {
      offset += 4;
      sessionId = data.subarray(offset, offset + maybeLen).toString('utf8');
      offset += maybeLen;
    }
  }
  if (data.length < offset + 4) return null;
  const payloadSize = data.readUInt32BE(offset);
  offset += 4;
  if (data.length < offset + payloadSize) return null;
  const payload = data.subarray(offset, offset + payloadSize);
  let json = null;
  if (serialization === 1 && payload.length) {
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return { messageType, flags, serialization, code, eventId, sessionId, payload, json };
}

function buildEventFrame({ eventId, sessionId = null, payloadObj = {}, messageType = 0x1, serialization = 0x1 }) {
  const header = Buffer.from([0x11, (messageType << 4) | 0x04, (serialization << 4) | 0x00, 0x00]);
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeUInt32BE(eventId >>> 0, 0);
  const parts = [header, eventBuf];
  if (sessionId) {
    const sid = Buffer.from(sessionId, 'utf8');
    const sidLen = Buffer.alloc(4);
    sidLen.writeUInt32BE(sid.length, 0);
    parts.push(sidLen, sid);
  }
  const payload =
    serialization === 1
      ? Buffer.from(JSON.stringify(payloadObj ?? {}), 'utf8')
      : Buffer.from(payloadObj ?? Buffer.alloc(0));
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(payload.length, 0);
  parts.push(payloadLen, payload);
  return Buffer.concat(parts);
}

function buildAudioFrame({ sessionId, audioBuffer }) {
  const header = Buffer.from([0x11, (0x2 << 4) | 0x04, 0x00, 0x00]);
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeUInt32BE(200, 0);
  const sid = Buffer.from(sessionId, 'utf8');
  const sidLen = Buffer.alloc(4);
  sidLen.writeUInt32BE(sid.length, 0);
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(audioBuffer.length, 0);
  return Buffer.concat([header, eventBuf, sidLen, sid, payloadLen, audioBuffer]);
}

app.post('/api/listening/script', async (req, res) => {
  try {
    const level = String(req.body?.level ?? 'B1');
    const duration = Number(req.body?.duration ?? 10);
    const n = listeningSentenceCount(duration);
    if (!LLM_API_KEY) {
      return res.json(fallbackListeningScript({ level, duration }));
    }

    const system =
      'You write listening clips for spoken English training. Output JSON only. No markdown. ' +
      'Keys: {topic:string, script:string}.';
    const user =
      `Create one natural spoken monologue for English listening practice.\n` +
      `Level: ${level}. Duration mode: ${duration < 1 ? `${Math.round(duration * 60)} seconds` : `${duration} minutes`}.\n` +
      `Write exactly ${n} sentences.\n` +
      `Requirements: realistic, neutral tone, no slang, no list format, no quotes, no meta words.\n` +
      `Return strict JSON only with keys topic and script.`;
    const raw = await chatJson({ system, user, tag: 'listening_script' });
    try {
      const parsed = JSON.parse(raw);
      const topic = String(parsed?.topic ?? '').trim() || 'listening practice';
      const script = String(parsed?.script ?? '').trim();
      if (!script) throw new Error('empty script');
      return res.json({ topic, script });
    } catch {
      return res.json(fallbackListeningScript({ level, duration }));
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'script generation failed' });
  }
});

app.post('/api/session/start', async (req, res) => {
  try {
    const level = String(req.body?.level ?? 'B1');
    const duration = Number(req.body?.duration ?? 10);
    const out = await createConversationSession({ level, duration });
    res.json({ sessionId: out.sessionId, opening: out.opening, scene: out.scene });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Session start failed.' });
  }
});

app.post('/api/session/upload', upload.single('audio'), async (req, res) => {
  if (!requireWhisperKey(res)) return;
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing audio file field "audio".' });

    const json = await transcribeAudio({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
    });

    const text = (json.text ?? '').trim();
    res.json({ text, raw: json });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Transcription failed.' });
  }
});

app.post('/api/session/turn', async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    const out = await runTurn(sessionId, req.body?.userText);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Turn failed.' });
  }
});

app.post('/api/session/end', async (req, res) => {
  try {
    const out = await finishSession(req.body?.sessionId);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'End failed.' });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text is required.' });

    // Priority:
    // 1) Cloud TTS when API key exists
    // 2) macOS local "say" fallback when running on darwin
    // 3) 501 so frontend can decide fallback UI
    if (TTS_API_KEY) {
      const resAudio = await ttsFetch('/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TTS_MODEL,
          voice: TTS_VOICE,
          input: text,
          format: 'mp3',
        }),
      });
      const buf = Buffer.from(await resAudio.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
      res.send(buf);
      return;
    }

    if (process.platform === 'darwin') {
      const buf = await localDarwinTts(text);
      res.setHeader('Content-Type', 'audio/wav');
      res.send(buf);
      return;
    }

    if (!requireTtsKey(res)) return;
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'TTS failed.' });
  }
});

/**
 * Production: serve Vite `dist` from the same origin as `/api` (Railway / single-host deploy).
 * Set SERVE_STATIC=1 and place files in STATIC_DIR (default: ./dist next to server.js).
 */
const SERVE_STATIC = String(process.env.SERVE_STATIC ?? '0') === '1';
const staticRoot = process.env.STATIC_DIR || join(__dirname, 'dist');
if (SERVE_STATIC) {
  if (!existsSync(staticRoot)) {
    // eslint-disable-next-line no-console
    console.warn(`[static] SERVE_STATIC=1 but folder missing: ${staticRoot}`);
  } else {
    app.use(express.static(staticRoot));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api')) return next();
      res.sendFile(join(staticRoot, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
    // eslint-disable-next-line no-console
    console.log(`[static] serving SPA from ${staticRoot}`);
  }
}

const port = Number(process.env.PORT ?? 8787);
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/realtime' });

wss.on('connection', (ws, req) => {
  const runConnection = () => {
    void (async () => {
    let closed = false;
    const peer = `${req.socket.remoteAddress ?? 'unknown'}:${req.socket.remotePort ?? ''}`;
    // eslint-disable-next-line no-console
    console.log('[ws] /api/realtime connected', { peer, url: req.url });
    const sendJson = (payload) => {
      if (closed) {
        return false;
      }
      try {
        ws.send(JSON.stringify(payload));
        return true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ws] sendJson failed', { peer, err: e instanceof Error ? e.message : e });
        return false;
      }
    };

    ws.on('close', (code, reason) => {
      closed = true;
      // eslint-disable-next-line no-console
      console.log('[ws] /api/realtime closed', {
        peer,
        code,
        reason: reason?.toString?.() || undefined,
      });
    });
    ws.on('error', (e) => {
      // eslint-disable-next-line no-console
      console.log('[ws] /api/realtime client socket error', { peer, error: e instanceof Error ? e.message : e });
    });

    sendJson({ type: 'session_preparing' });

    const url = new URL(req.url ?? '/api/realtime', `http://${req.headers.host ?? 'localhost'}`);
    const level = String(url.searchParams.get('level') ?? 'B1');
    const duration = Number(url.searchParams.get('duration') ?? 10);

    if (!REALTIME_ENABLED || !REALTIME_APP_ID || !REALTIME_ACCESS_KEY) {
      sendJson({
        type: 'error',
        error:
          'Realtime not configured. Set REALTIME_APP_ID and REALTIME_ACCESS_KEY in voice-server .env.',
      });
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      return;
    }

    let sessionId;
    let opening;
    let scene;
    let dialogSystemRole;
    try {
      const s = await createConversationSession({ level, duration });
      sessionId = s.sessionId;
      opening = s.opening;
      scene = s.scene;
      dialogSystemRole = s.dialogSystemRole;
    } catch (e) {
      const raw =
        e instanceof Error && e.message?.trim()
          ? e.message.trim()
          : String(e ?? '').trim();
      const safe = (raw || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 240);
      console.error('[conversation] createConversationSession failed:', e);
      sendJson({
        type: 'error',
        error: `Failed to start conversation session. ${safe}`,
      });
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      return;
    }

    /** Client arms a handshake timeout from each `session_preparing`. LLM scenario gen can take ~45s; refresh the window before realtime connect. */
    sendJson({ type: 'session_preparing', stage: 'realtime_connect' });

    let ending = false;
    let finalizeQueue = Promise.resolve();
    let lastUserFinal = '';
    /**
     * Before the browser sends real mic PCM, inject silence so the upstream ASR channel does not idle-timeout.
     * IMPORTANT: stop immediately once the first real mic frame arrives — injecting silence between ScriptProcessor
     * chunks (~85ms apart) was destroying recognition and barge-in (mic frames were interleaved with fake silence).
     */
    let clientMicAudioSeen = false;
    let lastClientMicAt = 0;
    let upstreamKeepaliveTimer = null;
    /** 100ms silence @ 16kHz mono s16le — matches ASR config. */
    const UPSTREAM_KEEPALIVE_SILENCE = Buffer.alloc(3200);
    const clearUpstreamKeepalive = () => {
      if (upstreamKeepaliveTimer != null) {
        clearInterval(upstreamKeepaliveTimer);
        upstreamKeepaliveTimer = null;
      }
    };
    const scheduleUpstreamKeepalive = () => {
      clearUpstreamKeepalive();
      upstreamKeepaliveTimer = setInterval(() => {
        if (closed || ending) return;
        if (protoWs.readyState !== WebSocket.OPEN) return;
        // Only inject silence when the client isn't providing steady mic audio.
        // If we interleave fake silence between real mic chunks (~85ms), recognition and barge-in degrade.
        const now = Date.now();
        if (clientMicAudioSeen && now - lastClientMicAt <= 250) return;
        sendProto(buildAudioFrame({ sessionId, audioBuffer: UPSTREAM_KEEPALIVE_SILENCE }));
      }, 80);
    };
    const connectId = randomUUID();
    const protoWs = new WebSocket(REALTIME_URL, {
      headers: {
        'X-Api-App-ID': REALTIME_APP_ID,
        'X-Api-Access-Key': REALTIME_ACCESS_KEY,
        'X-Api-Resource-Id': REALTIME_RESOURCE_ID,
        'X-Api-App-Key': REALTIME_APP_KEY,
        'X-Api-Connect-Id': connectId,
      },
    });

    const closeAll = () => {
      clearUpstreamKeepalive();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      try {
        protoWs?.close();
      } catch {
        /* ignore */
      }
    };

    const sendProto = (buf) => {
      if (protoWs.readyState !== WebSocket.OPEN) return;
      protoWs.send(buf);
    };

    protoWs.on('open', () => {
    sendProto(buildEventFrame({ eventId: 1, payloadObj: {} }));
    const startCfg = {
      tts: {
        speaker: REALTIME_SPEAKER,
        audio_config: {
          channel: 1,
          format: 'pcm_s16le',
          sample_rate: 24000,
        },
      },
      asr: {
        audio_info: {
          format: 'pcm',
          sample_rate: 16000,
          channel: 1,
        },
        /** Snappier turn-end + two-pass helps English STT on realtime dialogue (Volc ASR extra). */
        extra: {
          end_smooth_window_ms: 1000,
          enable_asr_twopass: true,
        },
      },
      dialog: {
        bot_name: 'English Coach',
        system_role: dialogSystemRole,
        speaking_style: 'friendly, concise, spoken',
        extra: {
          model: REALTIME_MODEL,
        },
      },
    };
    sendProto(buildEventFrame({ eventId: 100, sessionId, payloadObj: startCfg }));
    /** Event 300 `content` = spoken opening only (multi-sentence script), not internal instructions. */
    sendProto(
      buildEventFrame({
        eventId: 300,
        sessionId,
        payloadObj: {
          content: opening,
        },
      }),
    );
    scheduleUpstreamKeepalive();
  });

  protoWs.on('message', (raw) => {
    const frame = parseProtocolFrame(raw);
    if (!frame) return;
    if (frame.messageType === 0x0f) {
      // eslint-disable-next-line no-console
      console.error('[realtime upstream error]', frame.code, frame.json?.error ?? frame.json);
      let errMsg = frame.json?.error || `Realtime error code ${frame.code ?? 'unknown'}`;
      if (typeof errMsg === 'string' && /DialogAudioIdleTimeout/i.test(errMsg)) {
        errMsg =
          'Dialog audio idle timeout: the realtime service stopped receiving microphone audio. Keep the session active (start the conversation promptly after connect, and avoid muting). If this persists, try again.';
      }
      clearUpstreamKeepalive();
      sendJson({ type: 'error', error: errMsg });
      return;
    }
    if (frame.eventId === 150) {
      sendJson({ type: 'session_started', sessionId, opening, scene });
      return;
    }
    if (frame.eventId === 352) {
      sendJson({
        type: 'audio',
        format: 'pcm_s16le',
        sampleRate: 24000,
        data: Buffer.from(frame.payload).toString('base64'),
      });
      return;
    }
    if (frame.eventId === 451) {
      const r0 = frame.json?.results?.[0];
      const txt = String(r0?.text ?? '').trim();
      /** Only treat explicit `true` as partial; missing field = final (otherwise we never update). */
      const isInterim = r0?.is_interim === true;
      if (txt) {
        lastUserFinal = txt;
        const s = sessions.get(sessionId);
        if (s) {
          /** Keep latest ASR on draft for every 451 so 359 / flush never sees an empty user line if only interim arrived. */
          s.turnDraftUser = txt;
          if (!isInterim) s.lastAsrFinal = txt;
        }
        if (!isInterim) {
          sendJson({ type: 'user_text', text: txt });
        }
      }
      return;
    }
    if (frame.eventId === 550) {
      const piece = String(frame.json?.content ?? '');
      if (piece.trim()) {
        const s = sessions.get(sessionId);
        const merged = s ? mergeAssistantStreamChunk(s.turnDraftAssistant, piece) : piece.trim();
        if (s) s.turnDraftAssistant = merged;
        sendJson({ type: 'assistant_text', text: merged });
      }
      return;
    }
    if (frame.eventId === 450) {
      sendJson({ type: 'barge_in' });
      return;
    }
    if (frame.eventId === 359) {
      const s = sessions.get(sessionId);
      if (s) flushDialogTurnDraft(s, lastUserFinal, sessionId);
      sendJson({ type: 'turn_complete' });
      return;
    }
    if (frame.eventId === 152) {
      finalizeQueue = finalizeQueue
        .then(async () => {
          const t0 = Date.now();
          try {
            const out = await finishSession(sessionId);
            const finishMs = Date.now() - t0;
            // eslint-disable-next-line no-console
            console.log('[conversation] finishSession ok (event 152)', {
              sessionId,
              finishSessionMs: finishMs,
              reportPresent: Boolean(out?.report),
            });
            const sent = sendJson({
              type: 'session_ended',
              transcript: out.transcript,
              report: out.report,
              naturalCoaching: out.naturalCoaching ?? [],
            });
            if (!sent) {
              // eslint-disable-next-line no-console
              console.error('[conversation] session_ended not sent after 152 (socket closed)', { sessionId });
            }
          } catch (e) {
            const finishMs = Date.now() - t0;
            const errMsg = e instanceof Error ? e.message : String(e);
            // eslint-disable-next-line no-console
            console.error('[conversation] finishSession failed (event 152)', {
              sessionId,
              finishSessionMs: finishMs,
              error: errMsg,
            });
            /** Other path (e.g. client `end` + timeout) may have already finalized and deleted the session — do not send a second empty `session_ended`. */
            if (!sessions.has(sessionId)) {
              // eslint-disable-next-line no-console
              console.warn('[conversation] finishSession failure ignored (session already finalized)', { sessionId });
              return;
            }
            sendJson({ type: 'session_ended', transcript: '', report: null, naturalCoaching: [] });
          }
        })
        .finally(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        });
    }
  });

  protoWs.on('error', (e) => {
    clearUpstreamKeepalive();
    sendJson({ type: 'error', error: e instanceof Error ? e.message : 'Realtime upstream error' });
    if (!ending) {
      sessions.delete(sessionId);
      closeAll();
    }
  });

  protoWs.on('close', () => {
    clearUpstreamKeepalive();
    if (!closed && !ending) {
      sendJson({ type: 'error', error: 'Realtime upstream closed unexpectedly.' });
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      sessions.delete(sessionId);
    }
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendJson({ type: 'error', error: 'Invalid JSON message.' });
      return;
    }
    if (msg?.type === 'client_state') {
      const st = sessions.get(sessionId);
      if (st) {
        st.placementPriorScored = Math.max(0, Math.min(10000, Math.floor(Number(msg.placementPriorScored ?? 0))));
        st.placementStateReceived = true;
      }
      return;
    }
    if (msg?.type === 'end') {
      const st = sessions.get(sessionId);
      if (st && msg.placementPriorScored !== undefined && msg.placementPriorScored !== null) {
        st.placementPriorScored = Math.max(0, Math.min(10000, Math.floor(Number(msg.placementPriorScored))));
        st.placementStateReceived = true;
      }
      if (ending) return;
      ending = true;
      const endScheduleAt = Date.now();
      sendProto(buildEventFrame({ eventId: 102, sessionId, payloadObj: {} }));
      setTimeout(() => {
        const waitMs = Date.now() - endScheduleAt;
        if (closed) {
          // eslint-disable-next-line no-console
          console.error('[conversation] finish_after_end skipped: client WebSocket already closed', {
            sessionId,
            waitAfterEndMs: waitMs,
          });
          return;
        }
        if (!sessions.has(sessionId)) {
          // eslint-disable-next-line no-console
          console.error('[conversation] finish_after_end skipped: session not in map', {
            sessionId,
            waitAfterEndMs: waitMs,
          });
          sendJson({
            type: 'error',
            error:
              'Session expired before the report could be built (server state was cleared). Try connecting again.',
          });
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          return;
        }
        void (async () => {
          const t0 = Date.now();
          try {
            const out = await finishSession(sessionId);
            const finishMs = Date.now() - t0;
            // eslint-disable-next-line no-console
            console.log('[conversation] finishSession ok', {
              sessionId,
              finishSessionMs: finishMs,
              reportPresent: Boolean(out?.report),
            });
            const sent = sendJson({
              type: 'session_ended',
              transcript: out.transcript,
              report: out.report,
              naturalCoaching: out.naturalCoaching ?? [],
            });
            if (!sent) {
              // eslint-disable-next-line no-console
              console.error('[conversation] session_ended not sent (socket already closed)', { sessionId });
            }
          } catch (e) {
            const finishMs = Date.now() - t0;
            const errMsg = e instanceof Error ? e.message : String(e);
            // eslint-disable-next-line no-console
            console.error('[conversation] finishSession failed', {
              sessionId,
              finishSessionMs: finishMs,
              error: errMsg,
            });
            if (!sessions.has(sessionId)) {
              // eslint-disable-next-line no-console
              console.warn('[conversation] finishSession failure ignored (session already finalized)', { sessionId });
              return;
            }
            sendJson({ type: 'session_ended', transcript: '', report: null, naturalCoaching: [] });
          } finally {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          }
        })();
      }, 1800);
      return;
    }
    if (msg?.type === 'audio') {
      if (ending) return;
      const b64 = String(msg?.data ?? '');
      if (!b64) return;
      const audio = Buffer.from(b64, 'base64');
      if (!clientMicAudioSeen) {
        clientMicAudioSeen = true;
      }
      lastClientMicAt = Date.now();
      const sess = sessions.get(sessionId);
      if (sess) {
        sess.pcm16Bytes = (sess.pcm16Bytes || 0) + audio.length;
      }
      sendProto(buildAudioFrame({ sessionId, audioBuffer: audio }));
      return;
    }
    if (msg?.type === 'ping') {
      sendJson({ type: 'pong' });
    }
  });

  ws.on('close', () => {
    closed = true;
    clearUpstreamKeepalive();
    try {
      if (protoWs.readyState === WebSocket.OPEN) {
        sendProto(buildEventFrame({ eventId: 102, sessionId, payloadObj: {} }));
      }
    } catch {
      /* ignore */
    }
    try {
      protoWs.close();
    } catch {
      /* ignore */
    }
    if (!ending) sessions.delete(sessionId);
  });
  ws.on('error', () => {
    closed = true;
    try {
      protoWs.close();
    } catch {
      /* ignore */
    }
    if (!ending) sessions.delete(sessionId);
  });
  })();
  };
  if (sessionAuthMiddleware) {
    sessionAuthMiddleware(req, {}, () => {
      if (!req.session?.userId) {
        try {
          ws.send(JSON.stringify({ type: 'error', error: 'Sign in required.' }));
        } catch {
          /* ignore */
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }
      runConnection();
    });
  } else {
    runConnection();
  }
});

server.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`voice-server listening on http://0.0.0.0:${port} (localhost / LAN)`);
  if (SERVER_AUTH) {
    // eslint-disable-next-line no-console
    console.log('[config] SERVER_AUTH=1 — accounts + Growth/last-session persist in SQLite; WebSocket requires session cookie');
  }
  // eslint-disable-next-line no-console
  console.log(
    `[config] LLM: ${LLM_API_KEY ? 'on' : 'off'} (${LLM_BASE_URL})  Whisper: ${WHISPER_API_KEY ? 'on' : 'off'}  TTS: ${TTS_API_KEY ? 'on' : 'off'}  Realtime speaker: ${REALTIME_SPEAKER}`,
  );
  if (!TTS_API_KEY && process.platform === 'darwin') {
    // eslint-disable-next-line no-console
    console.log(`[config] TTS fallback: local macOS voice "${LOCAL_TTS_VOICE}"`);
  }
  if (LLM_API_KEY) {
    // eslint-disable-next-line no-console
    console.log(
      `[config] LLM_MODEL (default for chat): ${LLM_MODEL}  (env NATURAL_COACH empty → natural coach uses this)`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[config] Natural coach: model=${NATURAL_COACH_MODEL} batch≤${NATURAL_COACH_MAX_BATCH_TURNS} debounce=${NATURAL_COACH_DEBOUNCE_MS}ms perRequest=${NATURAL_COACH_TIMEOUT_MS}ms drainCap=${NATURAL_COACH_DRAIN_MAX_MS}ms`,
    );
  }
});
