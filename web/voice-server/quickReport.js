/**
 * C2 quick session report: one structured JSON (quick_report_v1) + deterministic fallback.
 */

export const QUICK_REPORT_INPUT_TURNS = 16;
export const LLM_QUICK_REPORT_TIMEOUT_MS = 10_000;

/** @type {const} */
export const CEFR_FIVE_ORDER = [
  'ListeningComprehension',
  'OralFluency',
  'GrammarAccuracy',
  'VocabularyRange',
  'InteractionQuality',
];

/** Aligned with web/src/lib/cefrDimensions.ts CEFR_SESSION_WEIGHTS (Σ = 1). */
export const CEFR_SESSION_WEIGHTS = {
  ListeningComprehension: 0.3,
  OralFluency: 0.25,
  GrammarAccuracy: 0.2,
  VocabularyRange: 0.15,
  InteractionQuality: 0.1,
};

/** One-session cap on (Σ weight_i * delta_i) for linear overall step (same as client recompute). */
export const GROWTH_NET_OVERALL_CAP = 0.2;

/**
 * Steady growth uses {@link GROWTH_NET_OVERALL_CAP}. First three **scored** sessions (by prior history length)
 * use looser caps so levels can move toward evidence quickly (see `GROWTH-PLACEMENT-SPEC.md`).
 * @param {number} priorScored - `growth.history.length` on the client at session connect (0 = first ever)
 * @returns {number} max |Σ w_i δ_i| for this session
 */
export function netCapForPlacementPrior(priorScored) {
  const p = Math.max(0, Math.min(10000, Math.floor(Number(priorScored))));
  if (p >= 3) return GROWTH_NET_OVERALL_CAP;
  if (p === 0) return 0.5;
  if (p === 1) return 0.35;
  return 0.28;
}

const MAX_QUOTE = 160;
const MAX_LINE = 180;

/** @param {string} transcript */
export function sliceTranscriptLastNTurns(transcript, nTurns = QUICK_REPORT_INPUT_TURNS) {
  const lines = String(transcript ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const userStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^User:/i.test(lines[i])) userStarts.push(i);
  }
  if (userStarts.length === 0) {
    return String(transcript ?? '').slice(-6000);
  }
  const from = userStarts.length > nTurns ? userStarts[userStarts.length - nTurns] : userStarts[0];
  return lines.slice(from).join('\n');
}

function clip(s, max) {
  const t = String(s ?? '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function countWords(s) {
  return String(s ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** @param {string} transcript */
export function extractUserLines(transcript) {
  return String(transcript ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^User:/i.test(l))
    .map((l) => l.replace(/^User:\s*/i, '').trim())
    .filter(Boolean);
}

/**
 * Conversation coaching expects enough English production to anchor feedback.
 * - non_english: user turns are mainly Chinese (CJK) → do not score
 * - too_short: some English exists but too little to anchor specific feedback → do not score
 * @returns {'english_ok' | 'non_english' | 'too_short' | 'no_user_text'}
 */
export function assessUserEnglishPractice(transcript) {
  const users = extractUserLines(transcript)
    .map((u) => u.trim())
    .filter((u) => u && !/^\(audio turn\)$/i.test(u));
  if (users.length === 0) return 'no_user_text';

  let totalCjk = 0;
  let totalLatin = 0;
  let totalWords = 0;
  for (const u of users) {
    totalCjk += (u.match(/[\u3400-\u9FFF]/g) || []).length;
    totalLatin += (u.match(/[a-zA-Z]/g) || []).length;
    totalWords += countWords(u);
  }

  if (totalLatin === 0 && totalCjk >= 2) return 'non_english';
  if (totalLatin < 8 && totalCjk >= totalLatin * 1.5 && totalCjk >= 8) return 'non_english';
  if (totalCjk > totalLatin * 2 && totalCjk >= 10) return 'non_english';
  // If we captured only 1-2 ultra-short English replies, avoid LLM hallucinations and do not score.
  if (users.length < 2 && totalWords < 12) return 'too_short';
  if (totalLatin >= 28 && totalWords >= 14) return 'english_ok';
  return 'too_short';
}

/**
 * Quick report when user did not produce assessable English.
 */
export function buildNonEnglishPracticeQuickReport({ transcript, level, duration }) {
  const users = extractUserLines(transcript).filter((u) => !/^\(audio turn\)$/i.test(u.trim()));
  const u0 = clip(users[0] || '…', MAX_QUOTE);
  const u1 = clip(users[1] || users[0] || '…', MAX_QUOTE);
  const orig = clip(users[0] || '(no user text)', MAX_LINE);

  return normalizeQuickReport(
    {
      type: 'quick_report_v1',
      level: String(level || 'B1'),
      duration_minutes: duration < 1 ? duration : duration,
      generated_at: new Date().toISOString(),
      verdict:
        'English practice only: your replies were mainly not in English, so this session is not scored toward levels.',
      strengths: [
        'You still took turns with the coach.',
        'Run again in English to get real strengths and gaps.',
      ],
      gaps: ['Reply in full English sentences.', 'Match the coach language — this mode is English-only.'],
      evidence: {
        quotes: [
          { speaker: 'user', text: u0 },
          { speaker: 'user', text: u1 },
        ],
      },
      correction: {
        kind: 'clarity',
        subkind: 'language_match',
        original: orig,
        better: 'Answer in English: one sentence, then add because plus one example.',
        why: 'Feedback and scores here apply only to English you produce, not Chinese.',
      },
      next_drill: {
        title: 'English-only retry',
        target_dimension: 'fluency',
        prompt: 'Repeat the last coach question with an all-English answer in two short sentences.',
        example_answer: 'I would pick Tuesday because the team has more coverage that day.',
        success_check: ['Entire answer in English.', 'Include the word because once.'],
      },
      growth_tags: { strong: [], focus: ['fluency'] },
      meta: {
        source: 'language_gate',
        latency_ms: 0,
        input_turns: QUICK_REPORT_INPUT_TURNS,
        model: 'rules_v1',
        language_gate: 'non_english',
      },
    },
    { level, duration, latencyMs: 0, source: 'language_gate', model: 'rules_v1' },
  );
}

/**
 * Quick report when user produced some English but too little to anchor specific feedback.
 * We avoid any invented scenario details and keep the drill generic + executable.
 */
export function buildTooShortPracticeQuickReport({ transcript, level, duration }) {
  const users = extractUserLines(transcript).filter((u) => !/^\(audio turn\)$/i.test(u.trim()));
  const u0 = clip(users[0] || '…', MAX_QUOTE);
  const u1 = clip(users[1] || users[0] || '…', MAX_QUOTE);
  const orig = clip(users[0] || '(no user text)', MAX_LINE);

  return normalizeQuickReport(
    {
      type: 'quick_report_v1',
      level: String(level || 'B1'),
      duration_minutes: duration < 1 ? duration : duration,
      generated_at: new Date().toISOString(),
      verdict: 'Too little English was captured to give specific, quote-anchored feedback in this session.',
      strengths: ['You started the response.', 'Run 15–20 seconds in English next time.'],
      gaps: ['Answer in 2 short sentences.', 'Add because plus one concrete detail.'],
      evidence: {
        quotes: [
          { speaker: 'user', text: u0 },
          { speaker: 'user', text: u1 },
        ],
      },
      correction: {
        kind: 'clarity',
        subkind: 'insufficient_evidence',
        original: orig,
        better: 'Answer in English: 1) your view, 2) because + one concrete detail.',
        why: 'Short answers make it hard to judge strengths and gaps reliably.',
      },
      next_drill: {
        title: '15-second answer',
        target_dimension: 'coherence',
        prompt: 'Answer the same question again in two sentences: your view, then one clear reason + one concrete detail.',
        example_answer: 'I would postpone because we still have one unresolved issue to check.',
        success_check: ['Two sentences only.', 'Say a clear reason.'],
      },
      growth_tags: { strong: [], focus: ['coherence'] },
      meta: {
        source: 'language_gate',
        latency_ms: 0,
        input_turns: QUICK_REPORT_INPUT_TURNS,
        model: 'rules_v1',
        language_gate: 'too_short',
      },
    },
    { level, duration, latencyMs: 0, source: 'language_gate', model: 'rules_v1' },
  );
}

const CORRECTION_RULES = [
  {
    re: /\bdiscuss about\b/i,
    apply: (t) => t.replace(/\bdiscuss about\b/gi, 'discuss'),
    kind: 'grammar',
    subkind: 'preposition_drop',
    why: 'After discuss, drop about — discuss is transitive here.',
  },
  {
    re: /\bdepend of\b/i,
    apply: (t) => t.replace(/\bdepend of\b/gi, 'depend on'),
    kind: 'grammar',
    subkind: 'collocation',
    why: 'The fixed phrase is depend on, not depend of.',
  },
  {
    re: /\bvery like\b/i,
    apply: (t) => t.replace(/\bvery like\b/gi, 'really like'),
    kind: 'naturalness',
    subkind: 'intensifier',
    why: 'In English we usually say really like, not very like.',
  },
  {
    re: /\bopen the light\b/i,
    apply: (t) => t.replace(/\bopen the light\b/gi, 'turn on the light'),
    kind: 'word_choice',
    subkind: 'collocation',
    why: 'Lights are turned on, not opened.',
  },
  {
    re: /\bclose the light\b/i,
    apply: (t) => t.replace(/\bclose the light\b/gi, 'turn off the light'),
    kind: 'word_choice',
    subkind: 'collocation',
    why: 'Lights are turned off, not closed.',
  },
  {
    re: /\bI think it is\b/i,
    apply: (t) => t.replace(/\bI think it is\b/gi, "I think it's"),
    kind: 'naturalness',
    subkind: 'contraction',
    why: "Contractions sound more natural in spoken English.",
  },
];

function mapCorrectionKindToGrowthDimension(kind) {
  if (kind === 'grammar') return 'grammar';
  if (kind === 'word_choice') return 'vocabulary';
  if (kind === 'pronunciation') return 'fluency';
  if (kind === 'clarity') return 'coherence';
  return 'fluency';
}

function drillForDimension(target) {
  if (target === 'grammar') {
    return {
      title: 'Past-tense mini drill',
      target_dimension: 'grammar',
      prompt: 'Say three short lines about yesterday: what you did, one problem, and what you fixed.',
      example_answer: 'Yesterday I shipped a fix, then I watched errors drop on the dashboard.',
      success_check: ['Use past tense verbs.', 'Keep each line under 12 words.'],
    };
  }
  if (target === 'vocabulary') {
    return {
      title: 'Collocation swap',
      target_dimension: 'vocabulary',
      prompt: 'Pick one verb you used today and replace a weak phrase with a stronger collocation.',
      example_answer: 'Instead of make a decision, say make the call or decide.',
      success_check: ['Name the old phrase.', 'Say the new phrase in a full sentence.'],
    };
  }
  if (target === 'coherence') {
    return {
      title: 'Claim + reason',
      target_dimension: 'coherence',
      prompt: 'Answer in two sentences: your view, then one reason with because.',
      example_answer: 'I would delay the rollout because checkout errors spiked last night.',
      success_check: ['Sentence 1 states a clear view.', 'Sentence 2 starts with because.'],
    };
  }
  if (target === 'pronunciation') {
    return {
      title: 'Slow clear read',
      target_dimension: 'pronunciation',
      prompt: 'Read your last answer slowly, stressing content words, then say it once at normal speed.',
      example_answer: '(Read your own last sentence aloud.)',
      success_check: ['Stress three content words.', 'Second pass feels smooth, not rushed.'],
    };
  }
  return {
    title: 'Fluency micro-turn',
    target_dimension: 'fluency',
    prompt: 'Answer the last question again in one breath: opinion, because, one concrete example.',
    example_answer: 'I would postpone because risk is high — for example, checkout errors doubled.',
    success_check: ['Include because.', 'Add one concrete example.'],
  };
}

/**
 * Deterministic quick report when LLM is slow/unavailable.
 * @param {{ transcript: string; level: string; duration: number; startedAt?: number }} ctx
 */
export function buildFallbackQuickReport(ctx) {
  const { transcript, level, duration } = ctx;
  const slice = sliceTranscriptLastNTurns(transcript, QUICK_REPORT_INPUT_TURNS);
  const users = extractUserLines(slice);
  const longest = [...users].sort((a, b) => b.length - a.length)[0] || users[users.length - 1] || '(no user text captured)';
  const second = users.filter((u) => u !== longest).sort((a, b) => b.length - a.length)[0] || longest;

  let original = clip(longest, MAX_LINE);
  let better = original;
  let kind = 'naturalness';
  let subkind = 'conversational_tighten';
  let why = 'More natural and conversational for everyday speech.';

  for (const rule of CORRECTION_RULES) {
    if (rule.re.test(original)) {
      better = clip(rule.apply(original), MAX_LINE);
      kind = rule.kind;
      subkind = rule.subkind;
      why = rule.why;
      break;
    }
  }
  if (better === original && countWords(original) >= 4) {
    const t = original.replace(/\bvery\b/i, 'really');
    if (t !== original) {
      better = clip(t, MAX_LINE);
      kind = 'naturalness';
      subkind = 'intensifier';
      why = 'Really often fits better than very in short spoken answers.';
    }
  }

  const targetDim = mapCorrectionKindToGrowthDimension(kind);
  const drill = drillForDimension(targetDim);

  const strengths = [
    users.length >= 2 ? 'You kept the exchange going across turns.' : 'You engaged and responded in this session.',
    countWords(longest) >= 10 ? 'You produced a fuller sentence with enough detail to react to.' : 'You answered directly without drifting off-topic.',
  ];
  const gaps = [
    kind === 'grammar' ? 'Small grammar and phrasing details still slip in.' : 'Naturalness can be tighter under time pressure.',
    'Add one because clause plus one concrete example when you justify a view.',
  ];

  const verdict =
    countWords(original) < 3
      ? 'Good start — stretch answers with because plus one example next time.'
      : 'Good effort — tighten phrasing and keep answers structured under pressure.';

  const now = new Date().toISOString();
  const durationMinutes = duration < 1 ? duration : duration;

  return {
    type: 'quick_report_v1',
    level: String(level || 'B1'),
    duration_minutes: durationMinutes,
    generated_at: now,
    verdict: clip(verdict, 140),
    strengths: strengths.map((s) => clip(s, 120)),
    gaps: gaps.map((s) => clip(s, 120)),
    evidence: {
      quotes: [
        { speaker: 'user', text: clip(original, MAX_QUOTE) },
        { speaker: 'user', text: clip(second, MAX_QUOTE) },
      ],
    },
    correction: {
      kind,
      subkind,
      original: clip(original, MAX_LINE),
      better: clip(better, MAX_LINE),
      why: clip(why, 120),
    },
    next_drill: {
      title: clip(drill.title, 80),
      target_dimension: drill.target_dimension,
      prompt: clip(drill.prompt, 220),
      example_answer: clip(drill.example_answer, 220),
      success_check: drill.success_check.map((x) => clip(x, 80)),
    },
    growth_tags: {
      strong: [],
      focus: [drill.target_dimension],
    },
    meta: {
      source: 'fallback',
      latency_ms: 0,
      input_turns: QUICK_REPORT_INPUT_TURNS,
      model: 'rules_v1',
    },
  };
}

export function normalizeQuickReport(parsed, { level, duration, latencyMs, source, model }) {
  const g = (x, d) => (x == null || x === '' ? d : x);
  const arr2 = (a, fill) => {
    const out = Array.isArray(a) ? a.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    while (out.length < 2) out.push(fill);
    return out.slice(0, 2).map((s) => clip(s, 120));
  };
  const quotes = parsed?.evidence?.quotes;
  const q0 = quotes?.[0];
  const q1 = quotes?.[1];
  const sp0 = g(q0?.speaker, 'user').toLowerCase();
  const dim0 = sp0 === 'assistant' ? 'assistant' : 'user';
  const sp1 = g(q1?.speaker, 'assistant').toLowerCase();
  const dim1 = sp1 === 'user' || sp1 === 'assistant' ? sp1 : 'assistant';
  const drill = parsed?.next_drill ?? {};
  const corr = parsed?.correction ?? {};
  const focus0 = String(drill.target_dimension || 'fluency').toLowerCase();
  const focus = [focus0];
  if (parsed?.growth_tags?.focus?.[1]) focus.push(String(parsed.growth_tags.focus[1]).toLowerCase());

  const out = {
    type: 'quick_report_v1',
    /** Optional; removed before payload to client; merged in wrapQuickReportWithLegacy. */
    cefr_five: parsed?.cefr_five && typeof parsed.cefr_five === 'object' ? parsed.cefr_five : undefined,
    level: String(parsed?.level || level || 'B1'),
    duration_minutes: typeof parsed?.duration_minutes === 'number' ? parsed.duration_minutes : duration,
    generated_at: String(parsed?.generated_at || new Date().toISOString()),
    verdict: clip(g(parsed?.verdict, 'Session complete.'), 140),
    strengths: arr2(parsed?.strengths, 'You stayed engaged.'),
    gaps: arr2(parsed?.gaps, 'Keep answers tighter under time pressure.'),
    evidence: {
      quotes: [
        { speaker: dim0, text: clip(g(q0?.text, ''), MAX_QUOTE) },
        { speaker: dim1, text: clip(g(q1?.text, g(q0?.text, '')), MAX_QUOTE) },
      ],
    },
    correction: {
      kind: ['grammar', 'word_choice', 'naturalness', 'pronunciation', 'clarity'].includes(
        String(corr.kind || '').toLowerCase(),
      )
        ? String(corr.kind).toLowerCase()
        : 'naturalness',
      subkind: clip(g(corr.subkind, 'general'), 40),
      original: clip(g(corr.original, ''), MAX_LINE),
      better: clip(g(corr.better, g(corr.original, '')), MAX_LINE),
      why: clip(g(corr.why, 'More natural phrasing helps clarity.'), 120),
    },
    next_drill: {
      title: clip(g(drill.title, 'Quick practice'), 80),
      target_dimension: ['fluency', 'grammar', 'vocabulary', 'pronunciation', 'coherence'].includes(focus0)
        ? focus0
        : 'fluency',
      prompt: clip(g(drill.prompt, 'Repeat your last answer with because plus one example.'), 220),
      example_answer: clip(g(drill.example_answer, 'I would wait because traffic risk is higher at rush hour.'), 220),
      success_check: Array.isArray(drill.success_check)
        ? drill.success_check.map((x) => clip(String(x), 80)).slice(0, 2)
        : ['Include because.', 'Add one example.'],
    },
    growth_tags: {
      strong: Array.isArray(parsed?.growth_tags?.strong)
        ? parsed.growth_tags.strong.slice(0, 1).map((x) => String(x).toLowerCase())
        : [],
      focus: focus.slice(0, 2),
    },
    meta: {
      source: source || 'llm',
      latency_ms: Math.round(latencyMs ?? 0),
      input_turns: QUICK_REPORT_INPUT_TURNS,
      model: String(model || ''),
      ...(parsed?.meta?.language_gate === 'non_english' ? { language_gate: 'non_english' } : {}),
      ...(parsed?.meta?.language_gate === 'too_short' ? { language_gate: 'too_short' } : {}),
    },
  };

  if (out.evidence.quotes[0].speaker !== 'user' && out.evidence.quotes[1].text) {
    const swap = out.evidence.quotes[0];
    out.evidence.quotes[0] = out.evidence.quotes[1];
    out.evidence.quotes[1] = swap;
  }
  if (out.evidence.quotes[0].speaker !== 'user') {
    out.evidence.quotes[0] = { speaker: 'user', text: out.evidence.quotes[0].text || out.correction.original };
  }
  out.growth_tags.focus[0] = out.next_drill.target_dimension;
  if (!out.next_drill.success_check[1]) out.next_drill.success_check.push('Keep it under 20 seconds.');
  return out;
}

export function buildQuickReportSystemPrompt() {
  return [
    'You are an English conversation coach. Output ONLY a single JSON object. No markdown. No extra text.',
    'SCORING RULE: Only evaluate **User** lines that are primarily **English** (Latin letters).',
    'Ignore User lines that are mainly Chinese (Han script) for strengths, gaps, correction, and quotes.',
    'Put evidence quotes only from English User lines. If there are no English User lines with real content, set meta.language_gate to the string non_english and still output valid JSON with honest verdict and next_drill in English.',
    'CRITICAL: Do not invent scenario details, facts, numbers, or nouns not present in the transcript. If the transcript is short or vague, keep coaching generic (e.g. "postpone", "plan", "issue") and do not mention product-specific terms like checkout, payments, migrations unless the User said them.',
    'Schema quick_report_v1 with keys:',
    'type (literal quick_report_v1), level, duration_minutes, generated_at (ISO-8601),',
    'verdict (<=20 words), strengths (exactly 2 strings, each <=12 words), gaps (exactly 2, each <=12 words),',
    'evidence.quotes (exactly 2 objects: speaker user|assistant, text <=160 chars, verbatim from transcript, at least one user),',
    'correction {kind: grammar|word_choice|naturalness|pronunciation|clarity, subkind snake_case, original, better (<=180 chars each), why (1 sentence <=18 words)},',
    'next_drill {title (<=8 words), target_dimension fluency|grammar|vocabulary|pronunciation|coherence, prompt (<=40 words), example_answer (<=45 words), success_check (exactly 2 strings, each <=12 words)},',
    'growth_tags {strong: 0 or 1 items from target_dimension set, focus: 1 or 2 items; focus[0] MUST equal next_drill.target_dimension},',
    'cefr_five: REQUIRED object with EXACT keys ListeningComprehension, OralFluency, GrammarAccuracy, VocabularyRange, InteractionQuality.',
    'Each value is { proposed_delta: -0.1|0|0.1, confidence: number 0-1, reason: string <= 28 words, English }.',
    'Use transcript evidence: listening = tracking questions & appropriate replies; oral = pace/fillers/naturalness; grammar; vocabulary; interaction = turn-taking, relevance, clarity.',
    'With 2+ English user turns, usually give at least 2-3 different dimensions a non-zero proposed_delta when the transcript supports it (e.g. listening + interaction + grammar or vocabulary).',
    'Do not output all zeros for non-oral dimensions just because the audio metrics line exists — conversation shows listening, language control, and interaction too.',
    'proposed_delta is your best estimate for ONE session step. Non-zero only with evidence. confidence reflects certainty.',
    'meta {source: llm, latency_ms: number, input_turns: 16, model: string, language_gate?: omit or non_english}.',
    'All coaching text must be English.',
  ].join(' ');
}

export function buildQuickReportUserPrompt({ slice, level, duration, metricsBlock }) {
  const dm = duration < 1 ? duration : duration;
  return [
    'Generate the Quick Report JSON.',
    `CEFR level: ${level}. Session duration (minutes): ${dm}.`,
    'Use input_turns=16 in meta; transcript below is already trimmed to the last ~16 learner turns.',
    'Be specific: tie strengths, gaps, and correction to quoted English from the User lines — no generic praise.',
    metricsBlock || '',
    '\nTranscript:\n',
    slice,
  ].join('\n');
}

/**
 * Strip a JSON object from model output (handles occasional preamble).
 * @param {string} raw
 */
export function extractJsonObject(raw) {
  let t = String(raw ?? '').trim();
  const i0 = t.indexOf('{');
  const i1 = t.lastIndexOf('}');
  if (i0 >= 0 && i1 > i0) t = t.slice(i0, i1 + 1);
  return t;
}

function tagToCefrDimension(tag) {
  const t = String(tag || '').toLowerCase();
  if (t === 'fluency' || t === 'pronunciation') return 'OralFluency';
  if (t === 'grammar') return 'GrammarAccuracy';
  if (t === 'vocabulary') return 'VocabularyRange';
  if (t === 'coherence') return 'InteractionQuality';
  return 'OralFluency';
}

function correctionKindToCefrDimension(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'grammar') return 'GrammarAccuracy';
  if (k === 'word_choice') return 'VocabularyRange';
  if (k === 'clarity') return 'InteractionQuality';
  if (k === 'pronunciation') return 'OralFluency';
  return 'OralFluency';
}

/**
 * @param {number} x
 * @returns {-0.1|0|0.1}
 */
function clampCefrDelta(x) {
  if (x == null || !Number.isFinite(x)) return 0;
  if (x > 0.05) return 0.1;
  if (x < -0.05) return -0.1;
  return 0;
}

/**
 * Linear model: Δoverall ≈ Σ w_i * delta_i (ignores 1.0/5.0 bounds; matches spec).
 * @param {Array<{ dimension: string; delta: number }>} moves
 */
export function weightedOverallStepFromDeltas(moves) {
  let s = 0;
  for (const m of moves) {
    const w = CEFR_SESSION_WEIGHTS[/** @type {keyof typeof CEFR_SESSION_WEIGHTS} */ (m.dimension)] ?? 0;
    s += w * m.delta;
  }
  return Math.round(s * 1000) / 1000;
}

/**
 * Keep at most one move per dimension (stronger |delta| wins, then higher confidence).
 * @param {Array<{ dimension: string; delta: number; reason?: string; confidence?: number }>} moves
 */
function dedupeMovesByDimension(moves) {
  const by = new Map();
  for (const m of moves) {
    if (!m?.dimension) continue;
    const d = m.dimension;
    const prev = by.get(d);
    if (!prev) {
      by.set(d, m);
      continue;
    }
    if (Math.abs(m.delta) > Math.abs(prev.delta)) {
      by.set(d, m);
    } else if (Math.abs(m.delta) === Math.abs(prev.delta) && (m.confidence ?? 0) > (prev.confidence ?? 0)) {
      by.set(d, m);
    }
  }
  return CEFR_FIVE_ORDER.map((k) => by.get(k)).filter(Boolean);
}

/**
 * @param {Array<{ dimension: string; delta: number; reason?: string; confidence?: number }>} moves
 * @param {number} [maxNet]
 * @returns {Array<{ dimension: string; delta: number; reason: string; confidence: number }>}
 */
export function capMovesByNetOverallStep(moves, maxNet = GROWTH_NET_OVERALL_CAP) {
  let list = dedupeMovesByDimension(moves);
  if (list.length === 0) return [];

  const net = () => Math.abs(weightedOverallStepFromDeltas(list));
  if (net() <= maxNet) {
    return list.map((m) => ({
      dimension: m.dimension,
      delta: m.delta,
      reason: String(m.reason ?? '').trim() || 'Session signal.',
      confidence: typeof m.confidence === 'number' && !Number.isNaN(m.confidence) ? m.confidence : 0.5,
    }));
  }
  // Drop lowest-confidence entries until the linear net fits (deterministic; no fractional deltas).
  list = list.slice().sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0));
  while (list.length > 0 && net() > maxNet) {
    list.shift();
  }
  return list.map((m) => ({
    dimension: m.dimension,
    delta: m.delta,
    reason: String(m.reason ?? '').trim() || 'Session signal.',
    confidence: typeof m.confidence === 'number' && !Number.isNaN(m.confidence) ? m.confidence : 0.5,
  }));
}

/**
 * Re-apply net cap after server-side additions (e.g. audio Oral). Matches confidence from prior cap when possible.
 * @param {object} report
 */
export function finalizeSessionGrowthMoves(report) {
  if (!report || !Array.isArray(report.moved)) return report;
  const log = report._growthLog;
  const capTable = log?.moves_post_cap || [];
  const withConf = report.moved.map((m) => {
    const hit = capTable.find((x) => x.dimension === m.dimension && x.delta === m.delta);
    return { ...m, confidence: hit?.confidence ?? 0.58 };
  });
  const maxNet = report._sessionNetCap != null ? report._sessionNetCap : GROWTH_NET_OVERALL_CAP;
  const capped = capMovesByNetOverallStep(withConf, maxNet);
  report.moved = capped.map(({ dimension, delta, reason }) => ({
    dimension,
    delta,
    reason: clip(String(reason), 240),
  }));
  if (report._growthLog) {
    report._growthLog.moves_after_audio = withConf;
    report._growthLog.moves_final = capped;
    report._growthLog.weighted_net_final = weightedOverallStepFromDeltas(
      capped.map((m) => ({ dimension: m.dimension, delta: m.delta })),
    );
  }
  if (Object.prototype.hasOwnProperty.call(report, '_sessionNetCap')) {
    delete report._sessionNetCap;
  }
  return report;
}

/**
 * @param {object} q — normalized quick_report_v1
 * @param {string} [transcript]
 * @returns {Record<string, { proposed_delta: -0.1|0|0.1; confidence: number; reason: string }>}
 */
export function synthesizeCefrFive(quick, transcript = '') {
  const users = extractUserLines(transcript);
  const userTurns = users.length;
  const primary = tagToCefrDimension(quick.next_drill?.target_dimension);
  const corrKind = String(quick.correction?.kind || '').toLowerCase();
  const corrDim = correctionKindToCefrDimension(quick.correction?.kind);
  const base = (reason) => ({ proposed_delta: 0, confidence: 0.35, reason });
  const o = {
    ListeningComprehension: base('Not estimated (rules).'),
    OralFluency: base('Oral signal deferred to audio heuristics when present.'),
    GrammarAccuracy: base('Not estimated (rules).'),
    VocabularyRange: base('Not estimated (rules).'),
    InteractionQuality: base('Not estimated (rules).'),
  };
  if (userTurns >= 2) {
    if (primary === 'ListeningComprehension') {
      o.ListeningComprehension = {
        proposed_delta: 0.1,
        confidence: 0.64,
        reason: 'Multiple user turns; session focus is listening/response alignment.',
      };
    } else {
      o.ListeningComprehension = {
        proposed_delta: 0.1,
        confidence: 0.52,
        reason: 'Multiple user turns; you followed the exchange.',
      };
    }
  }
  o[primary] = {
    proposed_delta: 0.1,
    confidence: primary === 'ListeningComprehension' && userTurns >= 2 ? 0.66 : 0.64,
    reason: clip(
      userTurns >= 2 && primary === 'ListeningComprehension'
        ? `Next drill: ${quick.next_drill?.title || 'session focus'}.`
        : `Next drill focus: ${quick.next_drill?.title || 'session'}.`,
      220,
    ),
  };
  if (corrDim && corrDim !== primary) {
    o[corrDim] = {
      proposed_delta: 0.1,
      confidence: 0.5,
      reason: clip(`Correction kind ${corrKind} points here.`, 220),
    };
  } else if (corrDim && corrDim === primary) {
    o[primary] = {
      ...o[primary],
      reason: clip(`${o[primary].reason} Correction cue (${corrKind}) aligns.`, 240),
      confidence: Math.max(o[primary].confidence, 0.66),
    };
  }
  return o;
}

/**
 * @param {object|undefined} raw
 * @param {object} quick - normalized
 * @param {string} [transcript]
 */
function mergeCefrFiveFromModel(raw, quick, transcript) {
  const synth = synthesizeCefrFive(quick, transcript);
  if (raw && typeof raw === 'object') {
    const out = { ...synth };
    for (const k of CEFR_FIVE_ORDER) {
      const row = raw[k];
      if (!row || typeof row !== 'object') continue;
      const sv = clampCefrDelta(row.proposed_delta);
      if (sv !== 0) {
        out[k] = {
          proposed_delta: sv,
          confidence:
            typeof row.confidence === 'number' && row.confidence >= 0 && row.confidence <= 1
              ? row.confidence
              : 0.5,
          reason: clip(String(row.reason || synth[k].reason), 400),
        };
      }
      // If the model says 0 for this dimension, keep rule-based `synth[k]` instead of zeroing
      // the whole row (LLMs often under-fill non-oral keys while still outputting cefr_five).
    }
    return out;
  }
  return synth;
}

/**
 * @param {Record<string, { proposed_delta: number; confidence: number; reason: string }>} cefr
 */
function movesFromCefrFiveDict(cefr) {
  const out = [];
  for (const k of CEFR_FIVE_ORDER) {
    const row = cefr[k];
    if (!row) continue;
    const d = clampCefrDelta(row.proposed_delta);
    if (d === 0) continue;
    out.push({
      dimension: k,
      delta: d,
      reason: row.reason,
      confidence: row.confidence,
    });
  }
  return out;
}

function includesAnyTerm(text, terms) {
  const t = String(text || '').toLowerCase();
  return terms.some((x) => t.includes(x));
}

function transcriptIncludesAnyTerm(transcript, terms) {
  return includesAnyTerm(transcript, terms);
}

export function sanitizeHallucinatedDrill(q, transcript) {
  // If model invents product/domain details not present in transcript, fall back to generic drill text.
  const banned = [
    'checkout',
    'payment',
    'payments',
    'migration',
    'rollout',
    'staging',
    'dashboard',
    'latency',
    'api',
    'database',
    'server',
    'deploy',
    'production',
  ];
  const allow = transcriptIncludesAnyTerm(transcript, banned);
  if (allow) return q;

  const drillText = `${q.next_drill?.title || ''} ${q.next_drill?.prompt || ''} ${q.next_drill?.example_answer || ''}`;
  if (!includesAnyTerm(drillText, banned)) return q;

  const safe = { ...q };
  safe.next_drill = {
    ...(safe.next_drill || {}),
    title: 'One-breath answer',
    target_dimension: safe.next_drill?.target_dimension || 'coherence',
    prompt: 'Answer again in one breath: your view, then one reason + one concrete detail.',
    example_answer: 'I would postpone because one key detail is still unclear.',
    success_check: ['Say a clear reason.', 'Add one concrete detail.'],
  };
  return safe;
}

/**
 * @param {object} q
 */
function stripCefrFiveForClient(q) {
  if (!q || typeof q !== 'object') return q;
  const { cefr_five: _c, ...rest } = q;
  return rest;
}

/**
 * Wire payload: nested `quick` (schema) + legacy fields for Growth + history previews.
 * @param {object} quick normalized quick_report_v1
 * @param {object} metrics from computeAudioMetrics
 * @param {string} [transcript] for rules cefr synthesis when cefr_five absent
 * @param {{ netCap?: number, placement?: { priorScored: number, ordinal: number, netCap: number, phase: 'calibrating'|'steady' } }} [opts]
 */
export function wrapQuickReportWithLegacy(quick, metrics, transcript = '', opts = {}) {
  const q = quick;
  const nextTarget = clip(`${q.next_drill.title}: ${q.next_drill.prompt}`, 420);
  const netCap = typeof opts.netCap === 'number' && Number.isFinite(opts.netCap) ? opts.netCap : GROWTH_NET_OVERALL_CAP;

  if (q.meta?.language_gate === 'non_english' || q.meta?.language_gate === 'too_short') {
    return {
      quick: stripCefrFiveForClient(q),
      snapshot: q.verdict,
      nextTarget,
      moved: [],
      evidence: [],
      audioMetrics: metrics,
    };
  }

  const cefr = mergeCefrFiveFromModel(q.cefr_five, q, transcript);
  const preCap = movesFromCefrFiveDict(cefr);
  const netPre = weightedOverallStepFromDeltas(
    preCap.map((m) => ({ dimension: m.dimension, delta: m.delta })),
  );
  const capped = capMovesByNetOverallStep(preCap, netCap);
  const netPost = weightedOverallStepFromDeltas(capped.map((m) => ({ dimension: m.dimension, delta: m.delta })));
  const moved = capped.map(({ dimension, delta, reason }) => ({
    dimension,
    delta,
    reason: clip(reason, 240),
  }));

  const corrDim = correctionKindToCefrDimension(q.correction.kind);
  /** @type {Record<string, unknown>} */
  const out = {
    quick: stripCefrFiveForClient(q),
    snapshot: q.verdict,
    nextTarget,
    moved,
    evidence: [
      {
        dimension: corrDim,
        quote: clip(q.correction.original, 220),
        note: clip(`${q.correction.better} — ${q.correction.why}`, 380),
      },
    ],
    audioMetrics: metrics,
    _sessionNetCap: netCap,
    _growthLog: {
      cefr_five: cefr,
      moves_pre_cap: preCap,
      weighted_net_pre: netPre,
      moves_post_cap: capped,
      weighted_net_post: netPost,
      net_cap: netCap,
    },
  };
  if (opts.placement) {
    out.placement = opts.placement;
  }
  return out;
}
