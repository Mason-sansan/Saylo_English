import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSession, listLocalAccountEmails } from './lib/auth';
import { USE_SERVER_AUTH } from './lib/serverAuthConfig';
import { useAuth } from './auth/AuthContext';
import { AccountView } from './AccountView';
import { AuthScreen } from './AuthScreen';
import './App.css';

import { overlapScore } from './lib/coach';
import { demoGrowthState, demoLastSession } from './lib/demoGrowth';
import type { Level } from './lib/types';
import { buildListeningFeedback } from './lib/sessionFeedback';
import type { QuickReportCardsPayload, SessionFeedbackPayload } from './lib/sessionFeedback';
import {
  ALL_DIMENSIONS,
  CEFR_SESSION_WEIGHTS,
  DIMENSION_LABEL,
  normalizeReportDimension,
  type Dimension,
} from './lib/cefrDimensions';

function feedbackDimensionLabel(raw: string) {
  const k = normalizeReportDimension(raw);
  return k ? DIMENSION_LABEL[k] : raw;
}

function clipText(s: string, max: number) {
  const t = String(s ?? '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

let activeAudio: HTMLAudioElement | null = null;

/** Prevents double-applying conversation dimension deltas (e.g. React StrictMode). */
const asyncConversationGrowthApplied = new Set<string>();

/** When false, the Listening path card is hidden on Home (Conversation remains). */
const SHOW_LISTENING_ON_HOME = false;

function stopAllPlayback() {
  try {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
  } catch {
    /* ignore */
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

function requestAudioPlaybackFromUserGesture(): void {
  try {
    window.speechSynthesis?.resume();
  } catch {
    /* ignore */
  }
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
    .AudioContext
    ?? (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    void ctx.resume().finally(() => {
      void ctx.close();
    });
  } catch {
    /* ignore */
  }
}

/** Maps Growth `overall` to CEFR for voice sessions (conversation + listening). Same value drives WebSocket `level`. */
function levelFromScore(overall: number): Level {
  if (overall < 1.8) return 'A1';
  if (overall <= 2.2) return 'A2';
  if (overall <= 3.2) return 'B1';
  if (overall <= 4.0) return 'B2';
  if (overall <= 4.6) return 'C1';
  return 'C2';
}

type Tab = 'home' | 'growth' | 'account';
type Flow = 'idle' | 'listening' | 'conversation';
type SessionDuration = 3 | 10 | 20;

type VoiceReport = {
  /** C2 structured quick report (English). Legacy `moved` / `evidence` may coexist for Growth. */
  quick?: QuickReportCardsPayload;
  snapshot?: string;
  moved?: Array<{ dimension: string; delta: number; reason: string }>;
  held?: Array<{ dimension: string; reason: string }>;
  evidence?: Array<{ dimension: string; quote: string; note: string }>;
  nextTarget?: string;
  note?: string;
  parseError?: string;
  /** When present: which placement window this session used (net cap on overall step). */
  placement?: {
    priorScored: number;
    ordinal: number;
    netCap: number;
    phase: 'calibrating' | 'steady';
  };
  /** Server-computed from PCM16 @ 16kHz (conversation path). */
  audioMetrics?: {
    speechSeconds: number;
    wallSeconds: number;
    userWords: number;
    userTurns: number;
    estimatedWpm: number;
    activityRatio: number;
    fillerCount: number;
    fillerRate: number;
  };
};

/** Per user turn from voice-server `session_ended.naturalCoaching` (background batched LLM). */
type NaturalCoachingItem = {
  seq: number;
  skip?: boolean;
  reason?: string;
  rewrite?: string;
  /** Short coach rationale from server (English). */
  note?: string;
  already_natural?: boolean;
  error?: string;
};

type SessionCardPayload = {
  mode: 'listening' | 'conversation';
  snapshot: string;
  nextTarget?: string;
  report?: VoiceReport | null;
  listening?: { attempts: Array<{ segmentId: string; attempt: string; score: number }> };
  feedback?: { score: number; session: SessionFeedbackPayload };
  /** Conversation: same payload as the post-session transcript feedback screen. */
  transcript?: string;
  naturalCoaching?: NaturalCoachingItem[];
};

function conversationToneFromDelta(delta: number): 'good' | 'warn' | 'miss' | 'neutral' {
  if (delta >= 0.08) return 'good';
  if (delta > 0) return 'warn';
  if (delta <= -0.08) return 'miss';
  if (delta < 0) return 'warn';
  return 'neutral';
}

function scoreFromTone(tone: 'good' | 'warn' | 'miss' | 'neutral') {
  if (tone === 'good') return 1;
  if (tone === 'warn') return 0.65;
  if (tone === 'miss') return 0.25;
  return 0.5;
}

function countUserTurns(transcript: string) {
  if (!transcript.trim()) return -1;
  const matches = transcript.match(/^User:/gm);
  return matches ? matches.length : 0;
}

function appendOralFluencyAudioDetail(detail: string, dim: Dimension, report: VoiceReport | null) {
  if (dim !== 'OralFluency' || !report?.audioMetrics) return detail;
  const m = report.audioMetrics;
  const pct = (m.fillerRate * 100).toFixed(0);
  return `${detail}\n\nAudio signal: ~${m.estimatedWpm} wpm over ${m.speechSeconds}s captured speech; ${m.fillerCount} filler tokens (${pct}% of words). Speech vs session time: ${m.activityRatio}.`;
}

function quickGrowthTagToDimension(tag: string): Dimension | null {
  const t = String(tag || '').toLowerCase();
  if (t === 'fluency' || t === 'pronunciation') return 'OralFluency';
  if (t === 'grammar') return 'GrammarAccuracy';
  if (t === 'vocabulary') return 'VocabularyRange';
  if (t === 'coherence') return 'InteractionQuality';
  return null;
}

function correctionKindToDimension(kind: string): Dimension {
  const k = String(kind || '').toLowerCase();
  if (k === 'grammar') return 'GrammarAccuracy';
  if (k === 'word_choice') return 'VocabularyRange';
  if (k === 'clarity') return 'InteractionQuality';
  if (k === 'pronunciation' || k === 'naturalness') return 'OralFluency';
  return 'OralFluency';
}

/** When quick report only flags 1–2 dimensions, fill the rest with concrete copy (not generic “stable”). */
function neutralDimensionFromQuick(
  dim: Dimension,
  q: QuickReportCardsPayload,
  corrDim: Dimension,
  report: VoiceReport | null,
): SessionFeedbackPayload['dimensions'][number] {
  if (dim === 'ListeningComprehension') {
    return {
      dimension: dim,
      tone: 'neutral',
      headline: 'Following the coach',
      detail: appendOralFluencyAudioDetail(
        `${q.verdict} · You stayed in the exchange; this row reflects how well you tracked the spoken scenario, not a separate listening quiz.`,
        dim,
        report,
      ),
    };
  }
  if (dim === 'OralFluency') {
    return {
      dimension: dim,
      tone: 'neutral',
      headline: clipText(q.strengths[0] || 'Fluency snapshot', 96),
      detail: appendOralFluencyAudioDetail(
        q.strengths[1] || q.gaps[0] || 'Keep one complete thought per turn while the clock is running.',
        dim,
        report,
      ),
    };
  }
  if (dim === 'GrammarAccuracy') {
    return {
      dimension: dim,
      tone: 'neutral',
      headline: 'Grammar snapshot',
      detail: appendOralFluencyAudioDetail(
        corrDim === 'GrammarAccuracy'
          ? 'Main grammar cue is under Quick fix above.'
          : q.gaps[0] || 'Aim for clean clauses: subject–verb, tense, and short stacks.',
        dim,
        report,
      ),
    };
  }
  if (dim === 'VocabularyRange') {
    return {
      dimension: dim,
      tone: 'neutral',
      headline: 'Word choice',
      detail: appendOralFluencyAudioDetail(
        q.gaps[1] || q.strengths[1] || 'Replace one vague word with a sharper, more specific one next turn.',
        dim,
        report,
      ),
    };
  }
  return {
    dimension: dim,
    tone: 'neutral',
    headline: 'On-task interaction',
    detail: appendOralFluencyAudioDetail(
      q.gaps[0] || 'Answer the question first, then add because plus one concrete example.',
      dim,
      report,
    ),
  };
}

function buildConversationFeedbackFromQuick(
  q: QuickReportCardsPayload,
  report: VoiceReport | null,
  transcript: string,
): { score: number; session: SessionFeedbackPayload } {
  const userTurns = countUserTurns(transcript);
  if (userTurns === 0) {
    return {
      score: 0,
      session: {
        mode: 'conversation',
        dimensions: ALL_DIMENSIONS.map((dim) => ({
          dimension: dim,
          tone: 'warn' as const,
          headline: 'No response captured yet.',
          detail: 'You ended before your first spoken answer was captured, so this session is not scored.',
        })),
        summaryNext: 'Answer the first question in one sentence, then add one reason.',
        quickCards: null,
      },
    };
  }

  if (q.meta?.language_gate === 'non_english' || q.meta?.language_gate === 'too_short') {
    const checks = q.next_drill.success_check.map((c) => `• ${c}`).join(' ');
    const summaryNext = `${q.next_drill.title}: ${q.next_drill.prompt}\nExample: ${q.next_drill.example_answer}\n${checks}`;
    return {
      score: 0,
      session: {
        mode: 'conversation',
        dimensions: ALL_DIMENSIONS.map((dim) => ({
          dimension: dim,
          tone: 'na' as const,
          headline: q.meta?.language_gate === 'too_short' ? 'Not scored (too short)' : 'Not scored (English only)',
          detail:
            q.meta?.language_gate === 'too_short'
              ? 'Too little English was captured to grade reliably, so no dimension is graded and Growth is unchanged.'
              : 'This path grades English speaking. Your turns were mainly not English, so no dimension is graded and Growth is unchanged.',
        })),
        summaryNext,
        quickCards: q,
        scoringMode: 'not_scored',
        notScoredReason: q.meta?.language_gate === 'too_short' ? 'too_short' : 'non_english',
      },
    };
  }

  const corrDim = correctionKindToDimension(q.correction.kind);
  const strongTag = q.growth_tags?.strong?.[0];
  const focusTags = q.growth_tags?.focus ?? [];
  const strongDim = strongTag ? quickGrowthTagToDimension(strongTag) : null;
  const focus0 = focusTags[0] ? quickGrowthTagToDimension(focusTags[0]) : null;
  const focus1 = focusTags[1] ? quickGrowthTagToDimension(focusTags[1]) : null;

  const dimensions = ALL_DIMENSIONS.map((dim) => {
    if (dim === corrDim) {
      return {
        dimension: dim,
        tone: 'warn' as const,
        headline: `Quick fix: ${q.correction.better.slice(0, 96)}${q.correction.better.length > 96 ? '…' : ''}`,
        detail: appendOralFluencyAudioDetail(
          `You said: "${q.correction.original}"\n\n${q.correction.why}\n\nBetter: ${q.correction.better}`,
          dim,
          report,
        ),
      };
    }
    if (strongDim && dim === strongDim) {
      return {
        dimension: dim,
        tone: 'good' as const,
        headline: q.strengths[0] || 'Strong signal this session.',
        detail: appendOralFluencyAudioDetail(q.strengths[1] || q.strengths[0] || 'Keep building on this.', dim, report),
      };
    }
    if (focus0 && dim === focus0) {
      return {
        dimension: dim,
        tone: 'warn' as const,
        headline: q.gaps[0] || 'Tighten this area next.',
        detail: appendOralFluencyAudioDetail(
          `${q.next_drill.title}: ${q.next_drill.prompt}`,
          dim,
          report,
        ),
      };
    }
    if (focus1 && dim === focus1 && dim !== focus0) {
      return {
        dimension: dim,
        tone: 'warn' as const,
        headline: q.gaps[1] || 'Secondary focus.',
        detail: appendOralFluencyAudioDetail(
          `Practice angle: ${q.next_drill.example_answer}`,
          dim,
          report,
        ),
      };
    }
    return neutralDimensionFromQuick(dim, q, corrDim, report);
  });

  const score = dimensions.reduce((sum, row) => {
    const w = CEFR_SESSION_WEIGHTS[row.dimension];
    return sum + w * scoreFromTone(row.tone as 'good' | 'warn' | 'miss' | 'neutral');
  }, 0);

  const checks = q.next_drill.success_check.map((c) => `• ${c}`).join(' ');
  const summaryNext = `${q.next_drill.title}: ${q.next_drill.prompt}\nExample: ${q.next_drill.example_answer}\n${checks}`;

  return {
    score,
    session: {
      mode: 'conversation',
      dimensions,
      summaryNext,
      quickCards: q,
      scoringMode: 'scored',
    },
  };
}

function buildConversationFeedback(report: VoiceReport | null, transcript = ''): { score: number; session: SessionFeedbackPayload } {
  if (report?.quick?.verdict && report.quick.strengths?.length && report.quick.correction && report.quick.next_drill) {
    return buildConversationFeedbackFromQuick(report.quick as QuickReportCardsPayload, report, transcript);
  }
  const userTurns = countUserTurns(transcript);
  if (userTurns === 0) {
    return {
      score: 0,
      session: {
        mode: 'conversation',
        dimensions: ALL_DIMENSIONS.map((dim) => ({
          dimension: dim,
          tone: 'warn' as const,
          headline: 'No response captured yet.',
          detail: 'You ended before your first spoken answer was captured, so this session is not scored.',
        })),
        summaryNext: 'Answer the first question in one sentence, then add one reason.',
      },
    };
  }
  const movedByDim = new Map<Dimension, NonNullable<VoiceReport['moved']>[number]>();
  for (const x of report?.moved ?? []) {
    const dim = normalizeReportDimension(x.dimension);
    if (dim) movedByDim.set(dim, x);
  }
  const heldByDim = new Map<Dimension, NonNullable<VoiceReport['held']>[number]>();
  for (const x of report?.held ?? []) {
    const dim = normalizeReportDimension(x.dimension);
    if (dim) heldByDim.set(dim, x);
  }
  const evidenceByDim = new Map<Dimension, NonNullable<VoiceReport['evidence']>[number]>();
  for (const x of report?.evidence ?? []) {
    const dim = normalizeReportDimension(x.dimension);
    if (dim) evidenceByDim.set(dim, x);
  }

  const dimensions = ALL_DIMENSIONS.map((dim) => {
    const moved = movedByDim.get(dim);
    const held = heldByDim.get(dim);
    const evidence = evidenceByDim.get(dim);

    if (moved) {
      const tone = conversationToneFromDelta(moved.delta);
      const deltaLabel = `${moved.delta >= 0 ? '+' : ''}${moved.delta.toFixed(1)}`;
      const baseDetail = evidence
        ? `Evidence: "${evidence.quote}" — ${evidence.note}`
        : 'This judgment comes from your response pattern across turns in this session.';
      return {
        dimension: dim,
        tone,
        headline: `${deltaLabel} change. ${moved.reason}`,
        detail: appendOralFluencyAudioDetail(baseDetail, dim, report),
      };
    }

    if (held) {
      const baseDetail = evidence
        ? `Evidence: "${evidence.quote}" — ${evidence.note}`
        : 'No drift detected in this dimension during this conversation.';
      return {
        dimension: dim,
        tone: 'neutral' as const,
        headline: `Level held. ${held.reason}`,
        detail: appendOralFluencyAudioDetail(baseDetail, dim, report),
      };
    }

    const baseDetail = evidence
      ? `Evidence: "${evidence.quote}" — ${evidence.note}`
      : 'No strong movement signal was detected, so this dimension remains stable for now.';
    return {
      dimension: dim,
      tone: 'neutral' as const,
      headline: 'Stable in this session.',
      detail: appendOralFluencyAudioDetail(baseDetail, dim, report),
    };
  });

  const score = dimensions.reduce((sum, row) => {
    const w = CEFR_SESSION_WEIGHTS[row.dimension];
    return sum + w * scoreFromTone(row.tone as 'good' | 'warn' | 'miss' | 'neutral');
  }, 0);

  const summaryNext = report?.nextTarget?.trim() || 'Next: answer with claim -> reason -> one concrete example.';

  return {
    score,
    session: {
      mode: 'conversation',
      dimensions,
      summaryNext,
    },
  };
}

function toneFromFeedbackScore(score: number): 'good' | 'warn' | 'miss' {
  if (score >= 0.45) return 'good';
  if (score >= 0.25) return 'warn';
  return 'miss';
}

function buildListeningFeedbackFromAttempts(
  attempts: Array<{ segmentId: string; attempt: string; score: number }>,
  nextTarget?: string
): { score: number; session: SessionFeedbackPayload } {
  const score =
    attempts.length > 0 ? attempts.reduce((sum, x) => sum + x.score, 0) / attempts.length : 0;
  const tone = toneFromFeedbackScore(score);

  const dimensions: SessionFeedbackPayload['dimensions'] = [
    {
      dimension: 'ListeningComprehension',
      tone,
      headline:
        tone === 'good'
          ? 'Main message is clear.'
          : tone === 'warn'
            ? 'Main message is partly clear.'
            : 'Main message needs tighter recall.',
      detail:
        tone === 'good'
          ? 'You captured enough core meaning to act on the content (CEFR-aligned listening comprehension).'
          : tone === 'warn'
            ? 'Core signal is present, but one key detail is still vague.'
            : 'Key decision, reason, or next action is missing in your recap.',
    },
    {
      dimension: 'OralFluency',
      tone: 'na',
      headline: 'Not assessed in this Listening card.',
      detail: 'Oral fluency is assessed in Conversation sessions.',
    },
    {
      dimension: 'GrammarAccuracy',
      tone: 'na',
      headline: 'Not assessed in this Listening card.',
      detail: 'Grammar accuracy is assessed in Conversation sessions.',
    },
    {
      dimension: 'VocabularyRange',
      tone: 'na',
      headline: 'Not assessed in this Listening card.',
      detail: 'Vocabulary range is assessed in Conversation sessions.',
    },
    {
      dimension: 'InteractionQuality',
      tone: 'na',
      headline: 'Not assessed in this Listening card.',
      detail: 'Interaction quality is assessed in Conversation sessions.',
    },
  ];

  return {
    score,
    session: {
      mode: 'listening',
      dimensions,
      summaryNext:
        nextTarget?.trim() || 'Next: summarize as decision + reason + next action in two sentences.',
    },
  };
}

function feedbackFromSessionCard(card: SessionCardPayload): { score: number; session: SessionFeedbackPayload } | null {
  if (card.feedback) return card.feedback;
  if (card.mode === 'conversation') {
    return buildConversationFeedback(card.report ?? null);
  }
  if (card.mode === 'listening' && card.listening) {
    return buildListeningFeedbackFromAttempts(card.listening.attempts, card.nextTarget);
  }
  return null;
}

type HistoryEntryV1 = SessionCardPayload & {
  id: string;
  at: string;
  /** Planned session length (min) chosen on Home. */
  minutes?: number;
  /** Change in overall level from this session (±0.1 steps). */
  overallDelta?: number;
};

type GrowthStateV1 = {
  version: 2;
  overall: number;
  dimensions: Record<Dimension, number>;
  history: HistoryEntryV1[];
};

/** Legacy 4-dimension payload from earlier builds (localStorage). */
type GrowthStateLegacyV1 = {
  version: 1;
  overall: number;
  dimensions: {
    Comprehension: number;
    ResponseFit: number;
    VocabularyUse: number;
    SentenceControl: number;
  };
  history: HistoryEntryV1[];
};

function migrateGrowthLegacyV1(parsed: GrowthStateLegacyV1): GrowthStateV1 {
  const d = parsed.dimensions;
  const dimensions: Record<Dimension, number> = {
    ListeningComprehension: d.Comprehension,
    OralFluency: clampLevel((d.ResponseFit + d.SentenceControl) / 2),
    GrammarAccuracy: d.SentenceControl,
    VocabularyRange: d.VocabularyUse,
    InteractionQuality: d.ResponseFit,
  };
  return {
    version: 2,
    dimensions,
    history: parsed.history,
    overall: recomputeOverall(dimensions),
  };
}

/** Pre–per-user builds: single global blob (migrated when safe). */
const LEGACY_GROWTH_KEY = 'english.growth.v1';
const LEGACY_LAST_SESSION_KEY = 'english.last-session.v1';
const LEGACY_DEMO_OPT_OUT_KEY = 'english.demoOptOut';

function growthStorageKeyForUser(email: string) {
  return `english.growth.v1.user::${email}`;
}
function lastSessionKeyForUser(email: string) {
  return `english.last-session.v1.user::${email}`;
}
function demoOptOutKeyForUser(email: string) {
  return `english.demoOptOut.v1.user::${email}`;
}

/** Set from `?useDemo=1` when not signed in; next login runs `seedDemoIntoStorageForUser` once. */
const PENDING_DEMO_SEED_KEY = 'english.pendingDemoSeed';

function seedDemoIntoStorageForUser(email: string) {
  if (!demoSessionsEnabled()) return;
  try {
    localStorage.removeItem(demoOptOutKeyForUser(email));
    localStorage.setItem(growthStorageKeyForUser(email), JSON.stringify(demoGrowthState()));
    localStorage.setItem(lastSessionKeyForUser(email), JSON.stringify(demoLastSession()));
  } catch {
    /* ignore */
  }
}

/**
 * `?useDemo=1` — 注入样例 4.2 / 假历史（需 `VITE_DEMO_SESSIONS=1`），并取消 demo opt-out。
 * 已登录时直接写入当前账号的 localStorage；未登录时只打 pending，**下次登录**再种入。
 */
function applyUseDemoParamIfPresent() {
  if (typeof window === 'undefined') return;
  const p = new URLSearchParams(window.location.search);
  if (p.get('useDemo') !== '1') return;
  try {
    localStorage.removeItem(LEGACY_DEMO_OPT_OUT_KEY);
    const s = getSession();
    if (s) {
      localStorage.removeItem(demoOptOutKeyForUser(s.email));
      if (demoSessionsEnabled()) {
        seedDemoIntoStorageForUser(s.email);
      }
    } else {
      localStorage.setItem(PENDING_DEMO_SEED_KEY, '1');
    }
  } catch {
    /* ignore */
  }
  p.delete('useDemo');
  const next = p.toString();
  const clean = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash || ''}`;
  window.history.replaceState(null, '', clean);
}

function applyPendingDemoSeedIfAny(email: string) {
  try {
    if (localStorage.getItem(PENDING_DEMO_SEED_KEY) !== '1') return;
    localStorage.removeItem(PENDING_DEMO_SEED_KEY);
    if (!demoSessionsEnabled()) return;
    seedDemoIntoStorageForUser(email);
  } catch {
    /* ignore */
  }
}

/**
 * `?resetProgress=1` — clear scores + history (localStorage) then strip the param.
 * If `VITE_DEMO_SESSIONS` is on, also opts out of demo for this profile so the UI shows empty/defaults instead of mock rows.
 * In production builds, a confirm runs once first (dev: no confirm).
 */
function applyProgressResetIfRequested() {
  if (typeof window === 'undefined') return;
  const p = new URLSearchParams(window.location.search);
  if (p.get('resetProgress') !== '1') return;
  if (!import.meta.env.DEV) {
    if (!window.confirm('Clear saved scores and session history in this browser?')) {
      p.delete('resetProgress');
      const next = p.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash || ''}`);
      return;
    }
  }
  try {
    const s = getSession();
    if (s) {
      localStorage.removeItem(growthStorageKeyForUser(s.email));
      localStorage.removeItem(lastSessionKeyForUser(s.email));
    }
    localStorage.removeItem(LEGACY_GROWTH_KEY);
    localStorage.removeItem(LEGACY_LAST_SESSION_KEY);
    if (demoSessionsEnabled() && s) {
      localStorage.setItem(demoOptOutKeyForUser(s.email), '1');
    } else if (demoSessionsEnabled()) {
      localStorage.setItem(LEGACY_DEMO_OPT_OUT_KEY, '1');
    }
  } catch {
    /* ignore */
  }
  p.delete('resetProgress');
  const next = p.toString();
  const clean = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash || ''}`;
  window.history.replaceState(null, '', clean);
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function clampLevel(n: number) {
  return Math.min(5, Math.max(1, Math.round(n * 10) / 10));
}

function clampDelta(d: number) {
  if (!Number.isFinite(d)) return 0;
  if (d === 0) return 0;
  if (d > 0) return Math.min(0.2, d);
  return Math.max(-0.2, d);
}

function isShortDuration(duration: SessionDuration) {
  return duration < 1;
}

function durationSeconds(duration: SessionDuration) {
  return Math.round(duration * 60);
}

function durationLabel(duration: SessionDuration) {
  return isShortDuration(duration) ? `${durationSeconds(duration)}-second` : `${duration}-minute`;
}

/**
 * WebSocket URL for conversation realtime.
 * - Local UI (Vite dev/preview, localhost, LAN): **same-origin** `ws(s)://当前 host/api/realtime` so Vite proxies to
 *   voice-server. Avoids **mixed content** when the page is HTTPS (e.g. embedded preview, `vite --https`): a secure
 *   page cannot open `ws://127.0.0.1:8787`.
 * - Deployed site: same-origin `ws` / `wss` (your reverse proxy must forward `/api/realtime`).
 * - Override: `VITE_VOICE_WS_URL` (use `wss://…` if the app is served over HTTPS).
 */
function realtimeWebSocketUrl(level: Level, duration: SessionDuration): string {
  const params = new URLSearchParams({ level, duration: String(duration) });
  const baseOverride = import.meta.env.VITE_VOICE_WS_URL as string | undefined;
  if (baseOverride?.trim()) {
    const joiner = baseOverride.includes('?') ? '&' : '?';
    return `${baseOverride.trim()}${joiner}${params.toString()}`;
  }
  if (typeof window === 'undefined') {
    return `ws://127.0.0.1:8787/api/realtime?${params.toString()}`;
  }
  const { protocol, hostname, port } = window.location;
  const p = port || (protocol === 'https:' ? '443' : '80');
  const isDev = import.meta.env.MODE === 'development';
  const isLan =
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  const isLocalFrontend =
    isDev ||
    p === '5173' ||
    p === '4173' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    isLan;

  if (isLocalFrontend) {
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}/api/realtime?${params.toString()}`;
  }

  const proto = protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/realtime?${params.toString()}`;
}

function defaultGrowth(): GrowthStateV1 {
  const base = 2.0;
  const dimensions: Record<Dimension, number> = {
    ListeningComprehension: base,
    OralFluency: base,
    GrammarAccuracy: base,
    VocabularyRange: base,
    InteractionQuality: base,
  };
  return {
    version: 2,
    overall: recomputeOverall(dimensions),
    dimensions,
    history: [],
  };
}

function demoSessionsEnabled() {
  return import.meta.env.VITE_DEMO_SESSIONS === '1' || import.meta.env.VITE_DEMO_SESSIONS === 'true';
}

function canMigrateGlobalLegacyToThisUser(email: string): boolean {
  const acc = listLocalAccountEmails();
  return acc.length === 1 && acc[0] === email;
}

function loadGrowthForUser(email: string): GrowthStateV1 {
  try {
    applyUseDemoParamIfPresent();
    applyProgressResetIfRequested();
    applyPendingDemoSeedIfAny(email);
    const k = growthStorageKeyForUser(email);
    let raw = localStorage.getItem(k);
    if (!raw && canMigrateGlobalLegacyToThisUser(email)) {
      const leg = localStorage.getItem(LEGACY_GROWTH_KEY);
      if (leg) {
        localStorage.setItem(k, leg);
        localStorage.removeItem(LEGACY_GROWTH_KEY);
        if (localStorage.getItem(LEGACY_DEMO_OPT_OUT_KEY) === '1') {
          localStorage.setItem(demoOptOutKeyForUser(email), '1');
          localStorage.removeItem(LEGACY_DEMO_OPT_OUT_KEY);
        }
        raw = leg;
      }
    }
    if (!raw) {
      return defaultGrowth();
    }
    const parsed = JSON.parse(raw) as GrowthStateV1 | GrowthStateLegacyV1;
    if (!parsed) return defaultGrowth();
    if (parsed.version === 1) {
      return migrateGrowthLegacyV1(parsed as GrowthStateLegacyV1);
    }
    if (parsed.version !== 2) return defaultGrowth();
    const d = parsed.dimensions;
    if (
      !d ||
      typeof d.ListeningComprehension !== 'number' ||
      typeof d.OralFluency !== 'number' ||
      typeof d.GrammarAccuracy !== 'number' ||
      typeof d.VocabularyRange !== 'number' ||
      typeof d.InteractionQuality !== 'number'
    ) {
      return defaultGrowth();
    }
    const overall = recomputeOverall(d as Record<Dimension, number>);
    return { ...parsed, overall, dimensions: d as Record<Dimension, number> };
  } catch {
    return defaultGrowth();
  }
}

function saveGrowthForUser(email: string, g: GrowthStateV1) {
  localStorage.setItem(growthStorageKeyForUser(email), JSON.stringify(g));
}

function loadLastSessionForUser(email: string): SessionCardPayload | null {
  try {
    applyUseDemoParamIfPresent();
    applyProgressResetIfRequested();
    applyPendingDemoSeedIfAny(email);
    const k = lastSessionKeyForUser(email);
    let raw = localStorage.getItem(k);
    if (!raw && canMigrateGlobalLegacyToThisUser(email)) {
      const leg = localStorage.getItem(LEGACY_LAST_SESSION_KEY);
      if (leg) {
        localStorage.setItem(k, leg);
        localStorage.removeItem(LEGACY_LAST_SESSION_KEY);
        raw = leg;
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCardPayload;
    if (!parsed || (parsed.mode !== 'listening' && parsed.mode !== 'conversation')) return null;
    if (typeof parsed.snapshot !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLastSessionForUser(email: string, session: SessionCardPayload | null) {
  if (!session) {
    localStorage.removeItem(lastSessionKeyForUser(email));
    return;
  }
  localStorage.setItem(lastSessionKeyForUser(email), JSON.stringify(session));
}

/** Parse Growth JSON from GET /api/me/state (same rules as loadGrowthForUser, without localStorage). */
function coerceGrowthFromServer(data: unknown): GrowthStateV1 {
  if (!data || typeof data !== 'object') return defaultGrowth();
  const parsed = data as GrowthStateV1 | GrowthStateLegacyV1;
  if (!parsed) return defaultGrowth();
  if (parsed.version === 1) {
    return migrateGrowthLegacyV1(parsed as GrowthStateLegacyV1);
  }
  if (parsed.version !== 2) return defaultGrowth();
  const d = parsed.dimensions;
  if (
    !d ||
    typeof d.ListeningComprehension !== 'number' ||
    typeof d.OralFluency !== 'number' ||
    typeof d.GrammarAccuracy !== 'number' ||
    typeof d.VocabularyRange !== 'number' ||
    typeof d.InteractionQuality !== 'number'
  ) {
    return defaultGrowth();
  }
  const overall = recomputeOverall(d as Record<Dimension, number>);
  return { ...parsed, overall, dimensions: d as Record<Dimension, number> };
}

function coerceLastSessionFromServer(data: unknown): SessionCardPayload | null {
  if (!data || typeof data !== 'object') return null;
  const parsed = data as SessionCardPayload;
  if (!parsed || (parsed.mode !== 'listening' && parsed.mode !== 'conversation')) return null;
  if (typeof parsed.snapshot !== 'string') return null;
  return parsed;
}

function recomputeOverall(d: Record<Dimension, number>) {
  let sum = 0;
  for (const dim of ALL_DIMENSIONS) {
    sum += CEFR_SESSION_WEIGHTS[dim] * d[dim];
  }
  return clampLevel(sum);
}

function applyDeltasStable(
  prev: GrowthStateV1,
  deltas: Array<{ dimension: Dimension; delta: number }>
) {
  const next: GrowthStateV1 = structuredClone(prev);
  for (const x of deltas) {
    next.dimensions[x.dimension] = clampLevel(next.dimensions[x.dimension] + x.delta);
  }
  next.overall = recomputeOverall(next.dimensions);
  return next;
}

function overallDeltaBetween(before: GrowthStateV1, after: GrowthStateV1) {
  return Math.round((after.overall - before.overall) * 10) / 10;
}

function conversationDeltasFromReport(
  report: VoiceReport | null,
): Array<{ dimension: Dimension; delta: number }> {
  const out: Array<{ dimension: Dimension; delta: number }> = [];
  for (const m of report?.moved ?? []) {
    const dim = normalizeReportDimension(m.dimension);
    if (!dim) continue;
    const d = clampDelta(m.delta);
    if (d === 0) continue;
    out.push({ dimension: dim, delta: d });
  }
  return out;
}

function appendHistoryEntry(g: GrowthStateV1, item: HistoryEntryV1): GrowthStateV1 {
  return { ...g, history: [...g.history, item].slice(-30) };
}

function appendSessionToGrowth(
  before: GrowthStateV1,
  after: GrowthStateV1,
  card: SessionCardPayload & { minutes: number }
): GrowthStateV1 {
  const overallDelta = overallDeltaBetween(before, after);
  const item: HistoryEntryV1 = {
    ...card,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    minutes: card.minutes,
    overallDelta,
  };
  return { ...after, history: [...after.history, item].slice(-30) };
}

function waitForSpeechVoices(): Promise<void> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done);
      resolve();
    };
    window.speechSynthesis.addEventListener('voiceschanged', done);
    window.setTimeout(done, 400);
  });
}

async function speakText(text: string): Promise<boolean> {
  const t = text.trim();
  if (!t) return false;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t }),
    });
    if (!res.ok) {
      let msg = 'tts failed';
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (blob.size === 0) throw new Error('empty audio');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.setAttribute('playsinline', '');
    audio.preload = 'auto';
    activeAudio = audio;
    try {
      await audio.play();
    } catch {
      URL.revokeObjectURL(url);
      if (activeAudio === audio) activeAudio = null;
      throw new Error('play blocked');
    }
    // `error` must not resolve as success — otherwise decode/load failures skip speech fallback.
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (activeAudio === audio) activeAudio = null;
      };
      audio.addEventListener(
        'ended',
        () => {
          cleanup();
          resolve();
        },
        { once: true },
      );
      audio.addEventListener(
        'error',
        () => {
          cleanup();
          reject(new Error('audio element error'));
        },
        { once: true },
      );
    });
    return true;
  } catch {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
      window.speechSynthesis.cancel();
      await waitForSpeechVoices();
      const ok = await new Promise<boolean>((resolve) => {
        let settled = false;
        const u = new SpeechSynthesisUtterance(t);
        u.lang = 'en-US';
        u.rate = 1.0;
        try {
          const voices = window.speechSynthesis.getVoices();
          const en = voices.find((v) => /en(-|$)/i.test(v.lang));
          if (en) u.voice = en;
        } catch {
          /* ignore — invalid voice breaks speak() on some WebKit builds */
        }
        u.onstart = () => {
          settled = true;
        };
        u.onend = () => resolve(true);
        u.onerror = () => resolve(settled);
        window.setTimeout(() => resolve(settled), 60000);
        try {
          window.speechSynthesis.speak(u);
        } catch {
          resolve(false);
        }
      });
      return ok;
    }
    return false;
  }
}

/** ZWSP / BOM etc. break /^Assistant:/ matching — strip before parsing. */
function stripInvisibleTranscriptNoise(s: string) {
  return s.replace(/[\u200b-\u200d\ufeff\u2060]/g, '');
}

/**
 * Parse stored transcript without dropping ASR newlines (continuation lines merge into current turn).
 * Accepts ASCII or full-width colons after User/Assistant.
 */
function parseTranscriptTurns(transcript: string): Array<{ role: 'assistant' | 'user'; text: string }> {
  const lines = stripInvisibleTranscriptNoise(transcript).split(/\n/);
  const out: Array<{ role: 'assistant' | 'user'; text: string }> = [];
  let cur: { role: 'assistant' | 'user'; text: string } | null = null;
  const startAssistant = /^\s*Assistant\s*[:：]\s*(.*)$/i;
  const startUser = /^\s*User\s*[:：]\s*(.*)$/i;

  for (const raw of lines) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (line && (m = line.match(startAssistant))) {
      if (cur) out.push(cur);
      cur = { role: 'assistant', text: (m[1] ?? '').trim() };
      continue;
    }
    if (line && (m = line.match(startUser))) {
      if (cur) out.push(cur);
      cur = { role: 'user', text: (m[1] ?? '').trim() };
      continue;
    }
    if (!line) continue;
    if (cur) {
      cur.text = cur.text ? `${cur.text} ${line}` : line;
    } else {
      /** Orphan line before any header (rare) — keep as assistant so nothing is silently dropped. */
      cur = { role: 'assistant', text: line };
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** When the server omits transcript text but still returns coaching rows, show rewrites in order. */
function NaturalCoachingOnlyList({ items }: { items: NaturalCoachingItem[] }) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => Number(a.seq) - Number(b.seq));
  return (
    <ul className="convo-coaching-only" style={{ margin: '12px 0 0', paddingLeft: 20, listStyle: 'disc' }}>
      {sorted.map((c) => (
        <li key={c.seq} style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Turn {c.seq}</span>
          {c.skip ? (
            <div className="convo-grade convo-grade--skip" style={{ marginTop: 6 }}>
              <span className="convo-margin-tag">Coach</span>
              <span className="convo-ink-text">{c.reason ?? 'skipped'}</span>
            </div>
          ) : null}
          {c.rewrite ? (
            <div className="convo-grade convo-grade--ok" style={{ marginTop: 6 }}>
              <span className="convo-margin-tag">More natural</span>
              <span className="convo-ink-text">{c.rewrite}</span>
            </div>
          ) : null}
          {c.error ? (
            <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '6px 0 0' }}>{c.error}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ConversationTranscriptWithCoaching(props: { transcript: string; coaching: NaturalCoachingItem[] }) {
  const turns = parseTranscriptTurns(props.transcript);
  const sorted = [...props.coaching].sort((a, b) => Number(a.seq) - Number(b.seq));
  const bySeq = new Map<number, NaturalCoachingItem>();
  for (const c of props.coaching) {
    const k = Number(c.seq);
    if (Number.isFinite(k)) bySeq.set(k, c);
  }
  let userOrdinal = 0;
  const raw = props.transcript.trim();
  if (raw && turns.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[Conversation] transcript did not parse into turns; showing raw', { preview: raw.slice(0, 200) });
    }
    return (
      <pre
        className="convo-transcript-fallback"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 12,
          color: 'var(--text-2)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.65,
          margin: 0,
        }}
      >
        {props.transcript}
      </pre>
    );
  }
  return (
    <div className="convo-natural-thread">
      {turns.map((turn, i) => {
        if (turn.role === 'assistant') {
          return (
            <div key={i} className="turn assistant">
              <div className="turn-who">Assistant</div>
              <div className="turn-text">{turn.text}</div>
            </div>
          );
        }
        userOrdinal += 1;
        let entry = bySeq.get(userOrdinal);
        if (!entry && sorted.length >= userOrdinal) {
          entry = sorted[userOrdinal - 1];
        }
        const hasRewrite = Boolean(entry?.rewrite?.trim());
        const showRewrite = hasRewrite;
        const soft = entry?.already_natural === true && hasRewrite;
        const skipped = Boolean(entry?.skip && !hasRewrite);
        const coachNote =
          !showRewrite && entry
            ? [entry.reason, entry.error].filter((x) => typeof x === 'string' && x.trim()).join(' · ') || null
            : null;
        return (
          <div
            key={i}
            className={`convo-grade${soft ? ' convo-grade--ok' : ''}${skipped ? ' convo-grade--skip' : ''}`}
          >
            <div className="turn-who">You</div>
            <div className="convo-your-line">{turn.text}</div>
            {showRewrite ? (
              <>
                <div className="convo-ink-row">
                  <span className="convo-ink-mark" aria-hidden="true">
                    {soft ? '◇' : '→'}
                  </span>
                  <span className="convo-ink-text">{entry?.rewrite}</span>
                </div>
                {entry?.note?.trim() ? (
                  <details className="convo-notes">
                    <summary className="convo-notes-summary">Notes</summary>
                    <div className="convo-notes-body">{entry.note.trim()}</div>
                  </details>
                ) : null}
              </>
            ) : null}
            {coachNote ? (
              <div className="convo-coach-note" style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)' }}>
                <span className="convo-margin-tag">Coach</span>
                {coachNote}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Same transcript block as the post-conversation feedback screen (no bottom actions). */
function ConversationTranscriptFeedbackBody(props: { transcript: string; naturalCoaching: NaturalCoachingItem[] }) {
  const t = String(props.transcript ?? '').trim();
  const c = props.naturalCoaching ?? [];
  return (
    <>
      {!t && !c.length ? (
        <p className="convo-notice" role="status">
          No transcript was returned (server error or disconnect). Check the voice-server terminal for{' '}
          <code>[conversation] finishSession</code> or <code>session ended with empty transcript</code>.
        </p>
      ) : null}
      {t || c.length ? (
        <div className="convo-transcript-details">
          <div className="feedback-section-k">Full transcript</div>
          {t ? (
            <ConversationTranscriptWithCoaching transcript={props.transcript} coaching={c} />
          ) : (
            <>
              <p className="convo-notice" style={{ marginTop: 0 }}>
                Transcript text was missing for this session; showing coaching hints only if the server returned them.
              </p>
              <NaturalCoachingOnlyList items={c} />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

function VoicePathA(props: {
  level: Level;
  duration: SessionDuration;
  /**
   * Completed growth sessions in history before this one (`growth.history.length` when the socket opens).
   * Sent to the server for placement net-step caps (first three sessions: looser; then steady 0.2).
   */
  placementPriorScored: number;
  /**
   * Mic from the same click gesture that started the session (parent stores Promise until consumed).
   * If omitted, `startMicStreaming` uses getUserMedia when the session is ready.
   */
  acquireMic?: () => Promise<MediaStream | null>;
  onDone: (payload: {
    report: VoiceReport | null;
    transcript: string;
    naturalCoaching: NaturalCoachingItem[];
  }) => void;
}) {
  type ConvoStatus = 'connecting' | 'ready' | 'live' | 'ending' | 'failed' | 'no_audio_api';

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [convoStatus, setConvoStatus] = useState<ConvoStatus>('connecting');
  const [remainingSec, setRemainingSec] = useState(durationSeconds(props.duration));
  const [confirmStop, setConfirmStop] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(true);

  const finishedRef = useRef(false);
  const autoBeginAttemptedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsCloseRef = useRef<(() => void) | null>(null);
  const endingRequestedRef = useRef(false);
  /** performance.now() when we sent `{ type: 'end' }` (for wrap timing logs). */
  const endRequestTimeRef = useRef<number | null>(null);
  /** Failsafe if `session_ended` never arrives (should be rare). */
  const endWrapSafetyTimerRef = useRef<number | null>(null);
  /** Mic PCM is streaming to the server (set only after Start conversation succeeds). */
  const micStartedRef = useRef(false);

  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSilenceRef = useRef<GainNode | null>(null);

  const playCtxRef = useRef<AudioContext | null>(null);
  const playQueueRef = useRef<Float32Array[]>([]);
  const playBusyRef = useRef(false);
  const playSourceRef = useRef<AudioBufferSourceNode | null>(null);
  /** True while waiting for user to tap and resume suspended assistant AudioContext. */
  const assistantPlaybackUnlockRef = useRef(false);

  const [assistantAudioNeedsTap, setAssistantAudioNeedsTap] = useState(false);
  const [isStartingConvo, setIsStartingConvo] = useState(false);
  /** First assistant PCM chunk actually started playing (src.start), not just queued. */
  const [firstAssistantHeard, setFirstAssistantHeard] = useState(false);
  const firstAssistantMarkedRef = useRef(false);
  /** Last server/proxy error for this session (also logged with console.error). */
  const [convoWireError, setConvoWireError] = useState<string | null>(null);

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64: string): Uint8Array {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
    if (sourceRate === 16000) return input;
    const ratio = sourceRate / 16000;
    const outLen = Math.max(1, Math.round(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const x = i * ratio;
      const x0 = Math.floor(x);
      const x1 = Math.min(input.length - 1, x0 + 1);
      const frac = x - x0;
      out[i] = input[x0] * (1 - frac) + input[x1] * frac;
    }
    return out;
  }

  function floatToPCM16LE(input: Float32Array): Uint8Array {
    const out = new Uint8Array(input.length * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return out;
  }

  function stopPlaybackQueue() {
    playQueueRef.current = [];
    playBusyRef.current = false;
    assistantPlaybackUnlockRef.current = false;
    setAssistantAudioNeedsTap(false);
    try {
      playSourceRef.current?.stop();
    } catch {
      /* ignore */
    }
    playSourceRef.current = null;
  }

  function pumpPlayback(sampleRate = 24000) {
    const ctx = playCtxRef.current;
    if (!ctx || playBusyRef.current) return;
    if (ctx.state === 'suspended') {
      if (playQueueRef.current.length > 0 && !assistantPlaybackUnlockRef.current) {
        assistantPlaybackUnlockRef.current = true;
        setAssistantAudioNeedsTap(true);
      }
      return;
    }
    assistantPlaybackUnlockRef.current = false;
    const chunk = playQueueRef.current.shift();
    if (!chunk) return;
    playBusyRef.current = true;
    const buffer = ctx.createBuffer(1, chunk.length, sampleRate);
    buffer.getChannelData(0).set(chunk);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    playSourceRef.current = src;
    src.onended = () => {
      playSourceRef.current = null;
      playBusyRef.current = false;
      pumpPlayback(sampleRate);
    };
    src.start();
    if (!firstAssistantMarkedRef.current) {
      firstAssistantMarkedRef.current = true;
      setFirstAssistantHeard(true);
    }
  }

  async function enqueuePcmPlayback(base64Data: string, sampleRate = 24000) {
    try {
      const bytes = base64ToBytes(base64Data);
      if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          console.error('[Conversation audio] Web Audio API not available');
          return;
        }
        playCtxRef.current = new AC();
      }
      if (playCtxRef.current.state === 'suspended') {
        await playCtxRef.current.resume().catch(() => undefined);
      }
      const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const pcm = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) pcm[i] = samples[i] / 32768;
      playQueueRef.current.push(pcm);
      pumpPlayback(sampleRate);
    } catch (e) {
      console.error('[Conversation audio] decode or playback enqueue failed', e);
    }
  }

  function stopMicStreaming() {
    try {
      micProcessorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      micSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      micSilenceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    micProcessorRef.current = null;
    micSourceRef.current = null;
    micSilenceRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (micCtxRef.current) {
      void micCtxRef.current.close().catch(() => undefined);
    }
    micCtxRef.current = null;
  }

  async function startMicStreaming(): Promise<'ok' | 'unsupported' | 'blocked'> {
    const ws = wsRef.current;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ws || ws.readyState !== WebSocket.OPEN) return 'blocked';
    if (!AC) return 'unsupported';
    const micArgs = {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    } as const;
    let stream: MediaStream | null = null;
    if (props.acquireMic) {
      stream = await props.acquireMic();
    } else if (navigator.mediaDevices?.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(micArgs);
      } catch {
        stream = null;
      }
    } else {
      return 'unsupported';
    }
    if (!stream) return 'blocked';
    const ctx = new AC();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined);
        return 'blocked';
      }
    }
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const silence = ctx.createGain();
    silence.gain.value = 0;
    processor.onaudioprocess = (ev) => {
      const curWs = wsRef.current;
      if (!curWs || curWs.readyState !== WebSocket.OPEN || endingRequestedRef.current) return;
      const mono = ev.inputBuffer.getChannelData(0);
      const down = downsampleTo16k(mono, ctx.sampleRate);
      const pcm = floatToPCM16LE(down);
      curWs.send(
        JSON.stringify({
          type: 'audio',
          data: bytesToBase64(pcm),
        }),
      );
    };
    source.connect(processor);
    processor.connect(silence);
    silence.connect(ctx.destination);
    micCtxRef.current = ctx;
    micStreamRef.current = stream;
    micSourceRef.current = source;
    micProcessorRef.current = processor;
    micSilenceRef.current = silence;
    return 'ok';
  }

  async function connectSession() {
    finishedRef.current = false;
    endingRequestedRef.current = false;
    autoBeginAttemptedRef.current = false;
    wsCloseRef.current?.();
    wsCloseRef.current = null;
    wsRef.current = null;
    micStartedRef.current = false;
    firstAssistantMarkedRef.current = false;
    setFirstAssistantHeard(false);
    stopMicStreaming();
    stopPlaybackQueue();
    setConvoStatus('connecting');
    setConfirmStop(false);
    setSessionId(null);
    setRemainingSec(durationSeconds(props.duration));
    setVoiceAvailable(true);
    setConvoWireError(null);
    endRequestTimeRef.current = null;
    if (endWrapSafetyTimerRef.current != null) {
      window.clearTimeout(endWrapSafetyTimerRef.current);
      endWrapSafetyTimerRef.current = null;
    }
    try {
      const wsUrl = realtimeWebSocketUrl(props.level, props.duration);
      if (import.meta.env.DEV) {
        console.info('[Conversation WS] connecting', wsUrl.replace(/\/api\/realtime\?.*/, '/api/realtime?…'));
      }
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      let manuallyClosed = false;
      let handshakeDone = false;
      let connectTimeoutId: number | null = null;
      let firstFrameLogged = false;
      const clearConnectTimeout = () => {
        if (connectTimeoutId != null) {
          window.clearTimeout(connectTimeoutId);
          connectTimeoutId = null;
        }
      };
      const armConnectTimeout = () => {
        clearConnectTimeout();
        connectTimeoutId = window.setTimeout(() => {
          if (finishedRef.current || handshakeDone) return;
          if (ws.readyState !== WebSocket.CONNECTING && ws.readyState !== WebSocket.OPEN) return;
          closeThisWs();
          setConvoStatus('failed');
          setConvoWireError((prev) => prev ?? 'Connection timed out before the session started.');
        }, 90000);
      };
      armConnectTimeout();
      const closeThisWs = () => {
        manuallyClosed = true;
        clearConnectTimeout();
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      wsCloseRef.current = closeThisWs;
      ws.onopen = () => {
        if (import.meta.env.DEV) console.info('[Conversation WS] open');
      };
      ws.onmessage = (ev) => {
        let msg: {
          type?: string;
          sessionId?: string;
          report?: VoiceReport;
          transcript?: string;
          naturalCoaching?: NaturalCoachingItem[];
          error?: string;
          data?: string;
          sampleRate?: number;
        };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          if (!firstFrameLogged) {
            firstFrameLogged = true;
            const raw = ev.data as unknown;
            const kind =
              raw instanceof ArrayBuffer ? 'ArrayBuffer' : raw instanceof Blob ? 'Blob' : typeof raw;
            console.error('[Conversation WS] non-JSON message', {
              kind,
              preview: String(raw).slice(0, 200),
            });
          }
          return;
        }
        if (!firstFrameLogged) {
          firstFrameLogged = true;
          if (import.meta.env.DEV) console.info('[Conversation WS] first message', msg.type ?? '(no type)');
        }
        if (msg.type === 'session_preparing') {
          if (import.meta.env.DEV && 'stage' in msg && (msg as { stage?: string }).stage) {
            console.info('[Conversation WS] session_preparing', (msg as { stage?: string }).stage);
          }
          armConnectTimeout();
          return;
        }
        if (msg.type === 'session_started') {
          clearConnectTimeout();
          handshakeDone = true;
          setSessionId(msg.sessionId ?? null);
          setConvoStatus('ready');
          try {
            ws.send(
              JSON.stringify({
                type: 'client_state',
                placementPriorScored: props.placementPriorScored,
              }),
            );
          } catch {
            /* ignore */
          }
          // Product intent: entering Conversation == Start. We try to auto-start mic immediately after the socket is ready.
          // If the browser still blocks mic/audio, UI will show a single fallback button.
          if (!autoBeginAttemptedRef.current && !endingRequestedRef.current) {
            autoBeginAttemptedRef.current = true;
            void beginConversation(msg.sessionId ?? null, 'auto');
          }
          return;
        }
        if (msg.type === 'audio' && msg.data) {
          clearConnectTimeout();
          handshakeDone = true;
          void enqueuePcmPlayback(msg.data, msg.sampleRate ?? 24000);
          // Do not switch to "live" here — first assistant audio used to hide "Start conversation" before the mic was on.
          if (micStartedRef.current && !endingRequestedRef.current) setConvoStatus('live');
          return;
        }
        if (msg.type === 'barge_in') {
          stopPlaybackQueue();
          return;
        }
        if (msg.type === 'session_ended') {
          /** Two paths can call `finishSession` (client `{type:'end'}` delay + upstream event 152). The loser sends an empty `session_ended`; ignore any duplicate after the first. */
          if (finishedRef.current) {
            if (import.meta.env.DEV) {
              console.warn('[Conversation] ignoring duplicate session_ended', {
                transcriptChars: (msg.transcript ?? '').length,
                reportPresent: msg.report != null,
              });
            }
            return;
          }
          finishedRef.current = true;
          endingRequestedRef.current = false;
          if (endWrapSafetyTimerRef.current != null) {
            window.clearTimeout(endWrapSafetyTimerRef.current);
            endWrapSafetyTimerRef.current = null;
          }
          const waitedMs =
            endRequestTimeRef.current != null ? Math.round(performance.now() - endRequestTimeRef.current) : -1;
          endRequestTimeRef.current = null;
          if (import.meta.env.DEV) {
            console.info('[Conversation] session_ended', {
              waitedMs,
              reportPresent: msg.report != null,
              transcriptChars: (msg.transcript ?? '').length,
              naturalCoaching: Array.isArray(msg.naturalCoaching) ? msg.naturalCoaching.length : 0,
            });
          }
          stopMicStreaming();
          stopPlaybackQueue();
          const naturalCoaching = Array.isArray(msg.naturalCoaching) ? msg.naturalCoaching : [];
          props.onDone({ report: msg.report ?? null, transcript: msg.transcript ?? '', naturalCoaching });
          return;
        }
        if (msg.type === 'error') {
          if (finishedRef.current) return;
          const errText = typeof msg.error === 'string' && msg.error.trim() ? msg.error.trim() : 'Server returned an error (no message).';
          if (endingRequestedRef.current) {
            finishedRef.current = true;
            endingRequestedRef.current = false;
            if (endWrapSafetyTimerRef.current != null) {
              window.clearTimeout(endWrapSafetyTimerRef.current);
              endWrapSafetyTimerRef.current = null;
            }
            const waitedMs =
              endRequestTimeRef.current != null ? Math.round(performance.now() - endRequestTimeRef.current) : -1;
            endRequestTimeRef.current = null;
            console.error('[Conversation] error during end wrap', { waitedMs, errText });
            stopMicStreaming();
            stopPlaybackQueue();
            setConvoWireError(errText);
            setConvoStatus('failed');
            return;
          }
          console.error('[Conversation WS]', errText);
          setConvoWireError(errText);
          stopMicStreaming();
          stopPlaybackQueue();
          setConvoStatus('failed');
        }
      };
      ws.onerror = () => {
        clearConnectTimeout();
        // React 18 Strict Mode (dev) runs effect cleanup → closes the first socket; browsers may still fire `error`
        // for that socket. Ignore events from any WebSocket that is no longer the active one (same as Retry working).
        if (wsRef.current !== ws) return;
        if (finishedRef.current || endingRequestedRef.current) return;
        const errText =
          'WebSocket transport error (often follows a server-side close). If a specific error appeared above, use that first; otherwise check voice-server, Vite `/api` proxy, and HTTPS/wss.';
        console.error('[Conversation WS]', errText);
        // Some browsers fire `error` after the server already sent `{ type: "error" }` and closed — do not overwrite that text.
        setConvoWireError((prev) => prev ?? errText);
        setConvoStatus('failed');
      };
      ws.onclose = (ev) => {
        clearConnectTimeout();
        // Stale close from a replaced socket must not clear wsRef or flip UI to failed.
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (manuallyClosed) return;
        if (finishedRef.current) return;
        const code = ev.code;
        const reason = typeof ev.reason === 'string' && ev.reason.trim() ? ev.reason.trim() : '';
        if (endingRequestedRef.current) {
          finishedRef.current = true;
          endingRequestedRef.current = false;
          if (endWrapSafetyTimerRef.current != null) {
            window.clearTimeout(endWrapSafetyTimerRef.current);
            endWrapSafetyTimerRef.current = null;
          }
          const waitedMs =
            endRequestTimeRef.current != null ? Math.round(performance.now() - endRequestTimeRef.current) : -1;
          endRequestTimeRef.current = null;
          console.error('[Conversation WS] closed during end wrap (no session_ended)', {
            code,
            reason: reason || undefined,
            waitedMs,
          });
          const hint1006 =
            code === 1006
              ? ' Check voice-server on 8787, Vite /api proxy, and upstream realtime.'
              : '';
          setConvoWireError(
            (prev) =>
              prev ??
              `Connection closed before the report arrived (close ${code}).${hint1006 ? ` ${hint1006}` : ''}`,
          );
          setConvoStatus('failed');
          return;
        }
        const abnormal = code !== 1000 && code !== 1001;
        const hint1006 =
          code === 1006
            ? ' Usually: voice-server is not running on port 8787, Vite cannot proxy /api/realtime to it, or the realtime upstream dropped TCP before a proper WebSocket close.'
            : '';
        const detail = abnormal ? ` Close code ${code}${reason ? `: ${reason}` : ''}.${hint1006}` : '';
        console.error('[Conversation WS] closed', { code, reason: reason || undefined });
        setConvoWireError((prev) => {
          const next = `Connection closed before the session finished.${detail}`;
          if (!prev) return next;
          if (/^WebSocket transport error/i.test(prev) || /^WebSocket error/i.test(prev)) return next;
          return prev;
        });
        setConvoStatus('failed');
      };
    } catch {
      const errText = 'Failed to create WebSocket (check dev server and /api/realtime proxy).';
      console.error('[Conversation WS]', errText);
      setConvoWireError(errText);
      setConvoStatus('failed');
    }
  }

  async function unlockAssistantPlayback() {
    requestAudioPlaybackFromUserGesture();
    const ctx = playCtxRef.current;
    if (ctx?.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }
    assistantPlaybackUnlockRef.current = false;
    setAssistantAudioNeedsTap(false);
    pumpPlayback(24000);
  }

  async function beginConversation(explicitSessionId: string | null = null, mode: 'auto' | 'manual' = 'manual') {
    const sid = explicitSessionId ?? sessionId;
    if (!sid) return;
    setIsStartingConvo(true);
    requestAudioPlaybackFromUserGesture();
    try {
      const outcome = await startMicStreaming();
      if (outcome === 'unsupported') {
        setVoiceAvailable(false);
        setConvoStatus('no_audio_api');
        return;
      }
      if (outcome !== 'ok') {
        setVoiceAvailable(true);
        setConvoWireError((prev) => {
          if (prev) return prev;
          return mode === 'auto'
            ? 'Auto-start was blocked by the browser. Tap once to enable mic/audio and start.'
            : 'Microphone did not start. Check permission and try again.';
        });
        // Stay in `ready` so the user can tap once to unlock. Do not fail the whole session on a first blocked attempt.
        setConvoStatus('ready');
        return;
      }
      micStartedRef.current = true;
      setVoiceAvailable(true);
      setConvoStatus('live');
      const pctx = playCtxRef.current;
      if (pctx?.state === 'suspended') {
        await pctx.resume().catch(() => undefined);
      }
      pumpPlayback(24000);
    } catch {
      setVoiceAvailable(true);
      setConvoWireError((prev) => prev ?? (mode === 'auto' ? 'Auto-start failed. Tap once to enable mic/audio.' : 'Could not start microphone.'));
      setConvoStatus('ready');
    } finally {
      setIsStartingConvo(false);
    }
  }

  async function endSession() {
    if (finishedRef.current) return;
    stopMicStreaming();
    stopPlaybackQueue();
    setConfirmStop(false);
    if (!sessionId) {
      finishedRef.current = true;
      props.onDone({ report: null, transcript: '', naturalCoaching: [] });
      return;
    }
    endingRequestedRef.current = true;
    setConvoStatus('ending');
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: 'end', placementPriorScored: props.placementPriorScored }),
        );
        endRequestTimeRef.current = performance.now();
        if (import.meta.env.DEV) {
          console.info('[Conversation] end sent, waiting for session_ended (server ~1.8s + finishSession)');
        }
        if (endWrapSafetyTimerRef.current != null) {
          window.clearTimeout(endWrapSafetyTimerRef.current);
        }
        endWrapSafetyTimerRef.current = window.setTimeout(() => {
          endWrapSafetyTimerRef.current = null;
          if (finishedRef.current) return;
          const waitedMs =
            endRequestTimeRef.current != null ? Math.round(performance.now() - endRequestTimeRef.current) : -1;
          endRequestTimeRef.current = null;
          console.error('[Conversation] end wrap safety timeout (120s) — still no session_ended', { waitedMs });
          finishedRef.current = true;
          endingRequestedRef.current = false;
          props.onDone({ report: null, transcript: '', naturalCoaching: [] });
        }, 120_000);
        return;
      }
      finishedRef.current = true;
      props.onDone({ report: null, transcript: '', naturalCoaching: [] });
    } catch {
      endingRequestedRef.current = false;
      setConvoStatus('live');
    }
  }

  useEffect(() => {
    void connectSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (convoStatus !== 'live') return;
    const id = window.setInterval(() => {
      setRemainingSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [convoStatus]);

  useEffect(() => {
    if (remainingSec !== 0) return;
    if (sessionId && !finishedRef.current) void endSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec]);

  useEffect(() => {
    return () => {
      if (endWrapSafetyTimerRef.current != null) {
        window.clearTimeout(endWrapSafetyTimerRef.current);
        endWrapSafetyTimerRef.current = null;
      }
      stopMicStreaming();
      stopPlaybackQueue();
      wsCloseRef.current?.();
      wsCloseRef.current = null;
      wsRef.current = null;
      if (playCtxRef.current) void playCtxRef.current.close().catch(() => undefined);
      playCtxRef.current = null;
    };
  }, []);

  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss2 = String(remainingSec % 60).padStart(2, '0');

  /** Only when auto/mic start failed and we need an explicit tap (not during normal “starting”). */
  const needsManualMicTap =
    convoStatus === 'ready' &&
    convoWireError != null &&
    /Auto-start was blocked|Auto-start failed|Tap once|Microphone did not start|Could not start microphone/i.test(
      convoWireError,
    );

  const bootBlockingOverlay =
    convoStatus !== 'failed' &&
    convoStatus !== 'no_audio_api' &&
    !needsManualMicTap &&
    (convoStatus === 'connecting' ||
      convoStatus === 'ready' ||
      (convoStatus === 'live' && !firstAssistantHeard && !assistantAudioNeedsTap));
  const endingOverlay = convoStatus === 'ending';
  const showLoadingOverlay = (bootBlockingOverlay || endingOverlay) && !confirmStop;
  const sessionOverlayLabel = endingOverlay ? 'Wrapping up your session' : 'Preparing your session';

  return (
    <div
      className={`listen-player-screen${confirmStop ? ' listen-player-screen--confirm' : ''}${showLoadingOverlay ? ' listen-player-screen--loading' : ''}`}
      aria-busy={showLoadingOverlay}
    >
      {showLoadingOverlay ? (
        <div className="listen-convo-overlay listen-convo-overlay--unified" role="status" aria-live="polite">
          <div className="listen-convo-boot">
            <div className="listen-convo-boot-ring" aria-hidden="true">
              <span className="listen-convo-boot-ring-arc" />
            </div>
            <p className="listen-convo-boot-label">{sessionOverlayLabel}</p>
          </div>
        </div>
      ) : null}

      <div className="listen-focus">You are in a {durationLabel(props.duration)} conversation.</div>

      {voiceAvailable ? (
        <div className="listen-orb-wrap">
          <div className="listen-orb">
            <span className="listen-orb-core" />
          </div>
        </div>
      ) : null}

      <div className="listen-timer">{mm}:{ss2}</div>

      {needsManualMicTap && convoStatus === 'ready' && sessionId && (
        <div style={{ marginTop: 12, textAlign: 'center' as const, maxWidth: 340 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 10px' }}>
            If the browser blocked auto-start, tap once to enable mic/audio and start.
          </p>
          <button
            type="button"
            className="action-btn"
            disabled={isStartingConvo}
            onClick={() => void beginConversation(null, 'manual')}
          >
            {isStartingConvo ? 'Starting…' : 'Start conversation'}
          </button>
        </div>
      )}

      {(convoStatus === 'live' || convoStatus === 'ready') && assistantAudioNeedsTap && (
        <div style={{ marginTop: 12, textAlign: 'center' as const, maxWidth: 340 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 10px' }}>
            Assistant audio is paused until you allow playback.
          </p>
          <button type="button" className="action-btn" onClick={() => void unlockAssistantPlayback()}>
            Enable assistant sound
          </button>
        </div>
      )}

      {convoStatus === 'no_audio_api' && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Microphone or Web Audio is not available in this browser.</p>
          <button
            type="button"
            className="action-btn"
            onClick={() => {
              void connectSession();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!confirmStop && convoStatus !== 'ending' && convoStatus !== 'failed' && (
        <button
          type="button"
          className="listen-stop-link"
          onClick={() => {
            if (convoStatus === 'connecting') {
              wsCloseRef.current?.();
              wsCloseRef.current = null;
              wsRef.current = null;
              setConvoStatus('failed');
              return;
            }
            setConfirmStop(true);
          }}
        >
          {convoStatus === 'connecting' ? 'Cancel' : 'Stop early'}
        </button>
      )}

      {convoStatus === 'failed' && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {convoWireError &&
            /websocket|connection closed|timed out|proxy|wss|^connection /i.test(convoWireError)
              ? 'Could not open the conversation connection. Fix network / HTTPS (see detail below) or voice-server, then retry.'
              : 'Could not start conversation. If the detail below mentions keys or realtime, fix voice-server .env; otherwise check connection and retry.'}
          </p>
          {convoWireError && (
            <pre
              style={{
                marginTop: 10,
                padding: 10,
                fontSize: 12,
                lineHeight: 1.4,
                textAlign: 'left' as const,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--panel-soft, rgba(0,0,0,0.2))',
                borderRadius: 8,
                color: 'var(--text)',
              }}
            >
              {convoWireError}
            </pre>
          )}
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
            Same message is printed to the browser console as <code>[Conversation WS]</code> or <code>[Conversation audio]</code>.
          </p>
          <button
            type="button"
            className="action-btn"
            onClick={() => {
              void connectSession();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {confirmStop && (
        <div
          className="listen-stop-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="convo-stop-title"
        >
          <button
            type="button"
            className="listen-stop-sheet-backdrop"
            aria-label="Dismiss"
            onClick={() => setConfirmStop(false)}
          />
          <div className="listen-stop-sheet-panel">
            <span className="listen-stop-sheet-kicker">Conversation</span>
            <h2 id="convo-stop-title" className="listen-stop-sheet-title">
              Stop before the time ends?
            </h2>
            <p className="listen-stop-sheet-body">
              Stops here. Next you&apos;ll go directly to feedback.
            </p>
            <div className="listen-stop-sheet-actions">
              <button
                type="button"
                className="action-btn listen-stop-keep-primary"
                onClick={() => setConfirmStop(false)}
              >
                Keep going
              </button>
              <button
                type="button"
                className="ghost-btn listen-stop-end"
                onClick={() => {
                  void endSession();
                }}
              >
                End &amp; feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ListeningFeedbackPanel(props: {
  payload: SessionFeedbackPayload;
  gistScore: number;
  onFinish: () => void;
  /** When false, hides the bottom primary action (e.g. history detail sheet with header close). */
  showFooterAction?: boolean;
}) {
  const { payload, gistScore, onFinish, showFooterAction = true } = props;
  const isConversation = payload.mode === 'conversation';
  const qc = payload.quickCards;
  const notScored = payload.scoringMode === 'not_scored';
  const noConversationInput =
    isConversation && payload.dimensions.every((d) => d.headline === 'No response captured yet.');

  const verdictTone = noConversationInput ? 'warn' : notScored ? 'warn' : gistScore >= 0.45 ? 'good' : gistScore >= 0.25 ? 'warn' : 'miss';
  const verdictTitle = isConversation
    ? noConversationInput
      ? 'No response captured yet.'
      : qc?.verdict
        ? clipText(qc.verdict, 140)
        : gistScore >= 0.45
          ? 'Conversation performance is strong.'
          : gistScore >= 0.25
            ? 'Conversation performance is mixed.'
            : 'Conversation needs tighter control.'
    : gistScore >= 0.45
      ? 'Gist is clear.'
      : gistScore >= 0.25
        ? 'Gist is partially clear.'
        : 'Gist needs more detail.';
  const gistPct = notScored ? '—' : (Math.round(gistScore * 1000) / 10).toFixed(1);

  function toneLabel(tone: 'good' | 'warn' | 'miss' | 'neutral' | 'na') {
    if (tone === 'good') return 'Strong evidence';
    if (tone === 'warn') return 'Some evidence';
    if (tone === 'miss') return 'Needs clearer evidence';
    if (tone === 'na') return isConversation && notScored ? 'Not scored' : 'Not assessed in Listening';
    return 'Informational';
  }

  function prettyCheckLine(line: string) {
    const t = String(line || '').trim();
    if (!t) return t;
    // Make the “because” instruction human-readable for Chinese users.
    if (/because/i.test(t) && /(include|use)\s+because/i.test(t)) {
      return 'Say one clear reason (use “because” = 因为).';
    }
    if (/^Use because once\.?$/i.test(t)) {
      return 'Say one clear reason (use “because” = 因为).';
    }
    if (/^Include because\.?$/i.test(t)) {
      return 'Say one clear reason (use “because” = 因为).';
    }
    return t;
  }

  return (
    <>
      <div className={`feedback-block feedback-${verdictTone}`}>
        <div className="feedback-next feedback-next-primary">
          <div className="feedback-next-k">Next to do</div>
          {isConversation && qc?.next_drill ? (
            <div className="feedback-next-title" style={{ lineHeight: 1.45 }}>
              <div style={{ fontWeight: 650 }}>{qc.next_drill.title}</div>
              <div style={{ marginTop: 6 }}>{qc.next_drill.prompt}</div>
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 10,
                  background: 'var(--panel-soft, rgba(255,255,255,0.04))',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 6 }}>
                  SAY IT LIKE THIS
                </div>
                <div style={{ fontSize: 14, color: 'var(--text)' }}>{qc.next_drill.example_answer}</div>
              </div>
              {qc.next_drill.success_check?.length ? (
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text)' }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 6 }}>
                    CHECK
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.45 }}>
                    {qc.next_drill.success_check.map((c) => (
                      <li key={c}>{prettyCheckLine(c)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="feedback-next-title">{payload.summaryNext}</div>
          )}
          {isConversation ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.45 }}>
              {notScored
                ? 'Guidance only — not counted toward session % or Growth (use English next time).'
                : qc
                  ? 'From your quick report: drill title, prompt, example, and two check lines.'
                  : null}
            </div>
          ) : null}
        </div>

        {isConversation && qc && (
          <div className="quick-report-cards" style={{ marginTop: 16, textAlign: 'left' }}>
            {notScored ? (
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text)',
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--panel-soft, rgba(255,255,255,0.04))',
                }}
              >
                Chinese (or other non-English) replies are not graded in this English practice mode. Use the drill
                below in English on your next try.
              </div>
            ) : null}
            <div className="feedback-section-k">Session snapshot</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                marginTop: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 6 }}>
                  STRENGTHS
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', fontSize: 14, lineHeight: 1.45 }}>
                  {qc.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 6 }}>
                  FOCUS NEXT
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', fontSize: 14, lineHeight: 1.45 }}>
                  {qc.gaps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 10,
                background: 'var(--panel-soft, rgba(255,255,255,0.04))',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 6 }}>
                QUICK FIX · {qc.correction.kind}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--muted)' }}>You said: </span>
                <span style={{ fontStyle: 'italic' }}>&ldquo;{clipText(qc.correction.original, 200)}&rdquo;</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 8, color: 'var(--text)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--muted)' }}>Try: </span>
                {qc.correction.better}
              </div>
              <div style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)', lineHeight: 1.45 }}>{qc.correction.why}</div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
              Drill ·{' '}
              {String(qc.next_drill.target_dimension || '')
                .replace(/^\w/, (c) => c.toUpperCase())}
              {qc.meta?.source === 'fallback' ? (
                <span style={{ marginLeft: 8, opacity: 0.85 }}>(offline coach)</span>
              ) : null}
            </div>
          </div>
        )}

        <div className="feedback-overview feedback-overview-compact">
          <div className={`feedback-overline tone-${verdictTone}`}>
            {isConversation ? 'This conversation check' : 'This listening check'}
          </div>
          <div className="feedback-verdict-title">{verdictTitle}</div>
          <div className="feedback-score-inline">
            {isConversation ? 'Session score (weighted)' : 'Listening comprehension'}{' '}
            {noConversationInput ? 'pending' : notScored ? 'not scored' : `${gistPct}%`}
          </div>
        </div>

        <div className="feedback-section-k">Dimensions (CEFR-weighted)</div>
        <div className="dimfb-list">
          {payload.dimensions.map((d) => (
            <div key={d.dimension} className={`dimfb-row dimfb-${d.tone}`}>
              <div className="dimfb-top">
                <div className="dimfb-name-wrap">
                  <div className="dimfb-name">{feedbackDimensionLabel(d.dimension)}</div>
                  {payload.mode === 'listening' && d.dimension !== 'ListeningComprehension' && (
                    <div className="dimfb-mode-hint">not assessed in this listening card</div>
                  )}
                </div>
                <div className={`dimfb-pill dimfb-pill-${d.tone}`}>{toneLabel(d.tone)}</div>
              </div>
              <div className="dimfb-headline">{d.headline}</div>
              <div className="dimfb-detail">{d.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {showFooterAction && (
        <div className="feedback-actions">
          <button className="action-btn" onClick={onFinish}>
            Finish
          </button>
        </div>
      )}
    </>
  );
}

function ListenSession(props: {
  level: Level;
  duration: SessionDuration;
  onDone: (payload: {
    snapshot: string;
    nextTarget: string;
    attempts: Array<{ segmentId: string; attempt: string; score: number }>;
    feedback: { score: number; session: SessionFeedbackPayload };
  }) => void;
}) {
  const isQuickClipMode = isShortDuration(props.duration);
  const effectivePlaybackSec = isQuickClipMode ? durationSeconds(props.duration) : durationSeconds(props.duration);
  const effectiveLengthLabel = durationLabel(props.duration);
  const scenes = [
    { id: 'work', label: 'Work communication' },
    { id: 'life', label: 'Daily life' },
    { id: 'travel', label: 'Travel coordination' },
  ] as const;
  const [sceneIndex] = useState(() => Math.floor(Math.random() * scenes.length));
  const [phase, setPhase] = useState<'playing' | 'recall' | 'feedback'>('playing');
  const [remainingSec, setRemainingSec] = useState(effectivePlaybackSec);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [typeDraft, setTypeDraft] = useState('');
  const [feedback, setFeedback] = useState<{
    score: number;
    session: SessionFeedbackPayload;
  } | null>(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [hasVoiceAttempt, setHasVoiceAttempt] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [scriptText, setScriptText] = useState('');
  const [scriptTopic, setScriptTopic] = useState('');
  const [isPreparingClip, setIsPreparingClip] = useState(false);
  /** User must tap once before any playback — avoids autoplay blocks (Safari / iOS / Chrome). */
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [waitingForPlayTap, setWaitingForPlayTap] = useState(false);
  const clipPlaybackBusyRef = useRef(false);
  const attemptsRef = useRef<Array<{ segmentId: string; attempt: string; score: number }>>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const scene = scenes[sceneIndex];
  const scriptId = `${scene.id}-${props.level}-${props.duration}`;

  const sceneLibrary: Record<(typeof scenes)[number]['id'], string[]> = {
    work: [
      'Our payment migration is stable in staging, but checkout timeout still spikes at peak traffic.',
      'The team proposes shifting the rollout to Tuesday so we can test rollback behavior with support online.',
      'Sales needs a short customer-facing line by this afternoon to avoid overpromising the Friday launch.',
      'Product asks us to keep the release notes concise: decision, risk, and what users should expect next.',
      'Before the handoff, we need one owner for monitoring and one owner for stakeholder updates.',
    ],
    life: [
      'Your family changed the weekend plan because the weather warning now includes heavy rain on Saturday.',
      'You decide to leave earlier in the morning, buy supplies tonight, and keep one backup indoor activity.',
      'A friend asks whether the plan is still on, so you explain what changed and what time to reconfirm.',
      'You also need to message the host, mention dietary needs, and check if public transport is delayed.',
      'The final plan should stay simple: who brings what, where to meet, and what happens if rain continues.',
    ],
    travel: [
      'Your flight lands late, and the connection to the city train may close before you clear baggage claim.',
      'You consider two options: reserve a shuttle now or wait and take a taxi if delays increase.',
      'The hotel requests a confirmed arrival window, so you send an update with one primary and one backup time.',
      'You must also check transfer signs, keep your ticket details ready, and avoid changing platforms at the last minute.',
      'If anything fails, your fallback is clear: call the hotel desk first, then follow their late-arrival instructions.',
    ],
  };

  const fallbackParts = sceneLibrary[scene.id].slice(
    0,
    isQuickClipMode ? 1 : props.duration === 3 ? 2 : props.duration === 10 ? 3 : 5,
  );
  const fallbackScript = fallbackParts.join(' ');
  const script = scriptText || fallbackScript;
  const sceneLabel = scriptTopic || scene.label;

  useEffect(() => {
    setRemainingSec(effectivePlaybackSec);
  }, [effectivePlaybackSec, sceneIndex]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const ac = new AbortController();
    setIsPreparingClip(true);
    setWaitingForPlayTap(false);
    setPlaybackStarted(false);
    setScriptText('');
    setScriptTopic('');
    void (async () => {
      try {
        const r = await fetch('/api/listening/script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: props.level, duration: props.duration }),
          signal: ac.signal,
        });
        const j = (await r.json()) as { script?: string; topic?: string };
        if (!r.ok) throw new Error('script failed');
        const incoming = (j.script ?? '').trim();
        const firstSentence = incoming.split(/(?<=[.!?])\s+/).filter(Boolean)[0] ?? incoming;
        const clipped = isQuickClipMode
          ? firstSentence.split(/\s+/).slice(0, 20).join(' ').trim()
          : incoming;
        setScriptText(clipped);
        setScriptTopic((j.topic ?? '').trim());
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setScriptText('');
        setScriptTopic('');
      } finally {
        setIsPreparingClip(false);
      }
    })();
    return () => ac.abort();
  }, [phase, props.level, props.duration, scene.id, isQuickClipMode]);

  useEffect(() => {
    if (phase !== 'playing' || isPreparingClip || waitingForPlayTap || !playbackStarted) return;
    const timer = window.setInterval(() => {
      setRemainingSec((s) => {
        if (s <= 1) {
          window.clearInterval(timer);
          window.speechSynthesis?.cancel();
          setPhase('recall');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, isPreparingClip, waitingForPlayTap, playbackStarted]);

  async function startClipPlayback() {
    if (clipPlaybackBusyRef.current) return;
    clipPlaybackBusyRef.current = true;
    requestAudioPlaybackFromUserGesture();
    setWaitingForPlayTap(false);
    setPlaybackStarted(true);
    try {
      const ok = await speakText(script);
      if (!ok) {
        setPlaybackStarted(false);
        setWaitingForPlayTap(true);
      } else {
        setWaitingForPlayTap(false);
      }
    } finally {
      clipPlaybackBusyRef.current = false;
    }
  }

  function endListeningEarly() {
    stopAllPlayback();
    setPhase('recall');
    setConfirmStop(false);
  }

  async function beginVoiceCapture() {
    if (mediaRecorderRef.current || isRecording) return;
    try {
      setVoiceStatus('Listening...');
      setIsRecording(true);
      setIsTranscribing(false);
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start();
    } catch (error) {
      setIsRecording(false);
      throw error;
    }
  }

  async function stopVoiceCaptureAndTranscribe(opts?: { discard?: boolean }) {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    await new Promise<void>((resolve) => {
      mr.addEventListener('stop', () => resolve(), { once: true });
      mr.stop();
    });
    mr.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    setIsRecording(false);
    if (opts?.discard) {
      setVoiceStatus('');
      return;
    }
    setHasVoiceAttempt(true);
    setIsTranscribing(true);
    setVoiceStatus('Transcribing...');
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('audio', blob, 'listening-recall.webm');
      const tr = await fetch('/api/session/upload', { method: 'POST', body: fd });
      const trJson = (await tr.json()) as { text?: string; error?: string };
      if (!tr.ok) throw new Error(trJson.error ?? 'Transcription failed');
      const text = (trJson.text ?? '').trim();
      setVoiceDraft(text);
      setVoiceStatus(text ? 'Captured.' : 'No speech captured.');
    } finally {
      setIsTranscribing(false);
    }
  }

  function submitAttempt(attempt: string) {
    const clean = attempt.trim();
    if (!clean) return;
    const score = overlapScore(script, clean);
    const session = buildListeningFeedback(script, clean, score);
    setFeedback({ score, session });
    attemptsRef.current = [{ segmentId: scriptId, attempt: clean, score }];
    setPhase('feedback');
  }

  function finish() {
    const attempts = attemptsRef.current;
    const avg = attempts.length > 0 ? attempts.reduce((a, b) => a + b.score, 0) / attempts.length : 0;
    const finalFeedback = feedback ?? buildListeningFeedbackFromAttempts(attempts);
    props.onDone({
      snapshot:
        avg >= 0.45
          ? `You tracked the ${sceneLabel.toLowerCase()} clip with usable gist under ${durationLabel(props.duration)} load.`
          : `You caught parts of the ${sceneLabel.toLowerCase()} clip, but key constraints slipped under load.`,
      nextTarget: 'Next: summarize as decision + reason + next action in two sentences.',
      attempts,
      feedback: finalFeedback,
    });
  }

  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');

  async function switchToType() {
    if (isRecording) {
      await stopVoiceCaptureAndTranscribe({ discard: true }).catch(() => undefined);
    }
    setVoiceStatus('');
    setShowTextInput(true);
  }

  function switchToVoice() {
    setShowTextInput(false);
    setVoiceStatus('');
  }

  return (
    <div className="listen-action listen-redesign">
      {phase === 'playing' && (
        <div className={`listen-player-screen${confirmStop ? ' listen-player-screen--confirm' : ''}`}>
          <div className="listen-focus">
            You are listening to a {effectiveLengthLabel} clip ({sceneLabel.toLowerCase()}, {props.level}).
          </div>
          <div className="listen-orb-wrap">
            <div className="listen-orb">
              <span className="listen-orb-core" />
            </div>
          </div>
          <div className="listen-timer">{mm}:{ss}</div>
          {isPreparingClip && <div className="listen-voice-note">Preparing your clip...</div>}
          {!isPreparingClip && !playbackStarted && !waitingForPlayTap && (
            <div className="listen-voice-note" style={{ maxWidth: 320 }}>
              Tap once to start audio (required on many browsers).
              <div style={{ marginTop: 10 }}>
                <button type="button" className="action-btn" onClick={() => void startClipPlayback()}>
                  Play clip
                </button>
              </div>
            </div>
          )}
          {waitingForPlayTap && (
            <div className="listen-voice-note" style={{ maxWidth: 300 }}>
              Playback didn&apos;t start. Check volume or try again.
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    requestAudioPlaybackFromUserGesture();
                    void (async () => {
                      setWaitingForPlayTap(false);
                      setPlaybackStarted(true);
                      const ok = await speakText(script);
                      if (!ok) {
                        setPlaybackStarted(false);
                        setWaitingForPlayTap(true);
                      } else {
                        setWaitingForPlayTap(false);
                      }
                    })();
                  }}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {!confirmStop && (
            <button type="button" className="listen-stop-link" onClick={() => setConfirmStop(true)}>
              Stop early
            </button>
          )}
          {confirmStop && (
            <div
              className="listen-stop-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="listen-stop-title"
            >
              <button
                type="button"
                className="listen-stop-sheet-backdrop"
                aria-label="Dismiss"
                onClick={() => setConfirmStop(false)}
              />
              <div className="listen-stop-sheet-panel">
                <span className="listen-stop-sheet-kicker">Listening</span>
                <h2 id="listen-stop-title" className="listen-stop-sheet-title">
                  Stop before the clip ends?
                </h2>
                <p className="listen-stop-sheet-body">
                  Playback stops here. Next you&apos;ll summarize what you heard.
                </p>
                <div className="listen-stop-sheet-actions">
                  <button type="button" className="action-btn listen-stop-keep-primary" onClick={() => setConfirmStop(false)}>
                    Keep listening
                  </button>
                  <button type="button" className="ghost-btn listen-stop-end" onClick={endListeningEarly}>
                    End &amp; summarize
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'recall' && (
        <div className="listen-recall-screen">
          <div className="listen-recall-sheet">
            <span className="listen-recall-step">Summarize</span>
            <h2 className="listen-recall-title">What's the gist?</h2>
            <p className="listen-recall-lede">
              Paraphrase is fine — main points, not every word.
            </p>
            {!showTextInput && (
              <div className="listen-voice-shell">
                {voiceStatus && !isRecording && !isTranscribing && !voiceDraft && (
                  <div className="listen-voice-note">{voiceStatus}</div>
                )}
                {voiceDraft && <div className="listen-material">{voiceDraft}</div>}
                {!isRecording && !isTranscribing && voiceDraft.trim() && (
                  <button
                    type="button"
                    className="action-btn listen-voice-submit"
                    onClick={() => submitAttempt(voiceDraft)}
                  >
                    Submit
                  </button>
                )}

                <div className="listen-voice-dock">
                  <button
                    type="button"
                    className={`listen-mic-disc${isRecording ? ' recording' : ''}${isTranscribing ? ' busy' : ''}`}
                    disabled={isTranscribing}
                    onMouseDown={() => void beginVoiceCapture().catch((e) => setVoiceStatus(e instanceof Error ? e.message : 'Mic failed'))}
                    onMouseUp={() => void stopVoiceCaptureAndTranscribe().catch((e) => setVoiceStatus(e instanceof Error ? e.message : 'Transcribe failed'))}
                    onMouseLeave={() => void stopVoiceCaptureAndTranscribe().catch(() => undefined)}
                    onTouchStart={() => void beginVoiceCapture().catch((e) => setVoiceStatus(e instanceof Error ? e.message : 'Mic failed'))}
                    onTouchEnd={() => void stopVoiceCaptureAndTranscribe().catch((e) => setVoiceStatus(e instanceof Error ? e.message : 'Transcribe failed'))}
                    aria-label={isTranscribing ? 'Transcribing' : isRecording ? 'Release to transcribe' : 'Hold to answer'}
                  >
                    <span className="listen-mic-glyph" aria-hidden="true">
                      <span className="listen-mic-head" />
                      <span className="listen-mic-stem" />
                      <span className="listen-mic-base" />
                    </span>
                  </button>

                  <div className="listen-mic-caption" aria-hidden="true">
                    {isTranscribing ? 'Transcribing…' : isRecording ? 'Release to transcribe' : 'Hold to answer'}
                  </div>

                  <div className="listen-voice-actions">
                    {!isRecording && !isTranscribing && hasVoiceAttempt && !voiceDraft.trim() && (
                      <button
                        type="button"
                        className="ghost-btn listen-voice-retry"
                        onClick={() => {
                          setVoiceDraft('');
                          setVoiceStatus('');
                          setHasVoiceAttempt(false);
                        }}
                      >
                        Retry voice
                      </button>
                    )}
                  </div>

                  <button type="button" className="ghost-btn listen-text-toggle" onClick={() => void switchToType()}>
                    Type instead
                  </button>
                </div>
              </div>
            )}
            {showTextInput && (
              <div className="listen-type-shell">
                <div className="listen-voice-dock listen-type-dock">
                  <textarea
                    className="answer-area listen-recall-textarea"
                    value={typeDraft}
                    onChange={(e) => setTypeDraft(e.target.value)}
                    placeholder="Summarize in your own words..."
                    rows={4}
                  />
                  <div className="listen-type-actions">
                    <button type="button" className="ghost-btn listen-type-back" onClick={switchToVoice}>
                      Back to voice
                    </button>
                    <button className="action-btn listen-recall-submit" disabled={!typeDraft.trim()} onClick={() => submitAttempt(typeDraft)}>
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'feedback' && feedback && (
        <div className="listen-recall-screen listen-feedback-screen">
          <span className="listen-recall-step">Feedback</span>
          <ListeningFeedbackPanel
            payload={feedback.session}
            gistScore={feedback.score}
            onFinish={finish}
          />
        </div>
      )}
    </div>
  );
}

function ConversationSession(props: {
  level: Level;
  duration: SessionDuration;
  /** Prior session count for placement caps (use `growth.history.length`). */
  placementPriorScored: number;
  acquireMic?: () => Promise<MediaStream | null>;
  onDone: (payload: {
    snapshot: string;
    nextTarget: string;
    report: VoiceReport | null;
    transcript: string;
    naturalCoaching: NaturalCoachingItem[];
  }) => void;
}) {
  const [phase, setPhase] = useState<'conversation' | 'review'>('conversation');
  const [result, setResult] = useState<{
    report: VoiceReport | null;
    transcript: string;
    naturalCoaching: NaturalCoachingItem[];
  } | null>(null);

  function handleConversationDone(payload: {
    report: VoiceReport | null;
    transcript: string;
    naturalCoaching: NaturalCoachingItem[];
  }) {
    setResult({
      report: payload.report,
      transcript: payload.transcript,
      naturalCoaching: payload.naturalCoaching ?? [],
    });
    setPhase('review');
  }

  function finish() {
    if (!result) return;
    props.onDone({
      snapshot: result.report?.snapshot ?? 'Session complete.',
      nextTarget: result.report?.nextTarget ?? 'Next: answer with claim -> reason -> one concrete example.',
      report: result.report,
      transcript: result.transcript,
      naturalCoaching: result.naturalCoaching,
    });
  }

  return (
    <div className="listen-action listen-redesign">
      {phase === 'conversation' && (
        <VoicePathA
          level={props.level}
          duration={props.duration}
          placementPriorScored={props.placementPriorScored}
          acquireMic={props.acquireMic}
          onDone={handleConversationDone}
        />
      )}

      {phase === 'review' && result && (
        <div className="listen-recall-screen listen-feedback-screen">
          <ConversationTranscriptFeedbackBody
            transcript={result.transcript}
            naturalCoaching={result.naturalCoaching}
          />
          <div className="feedback-actions" style={{ marginTop: 18 }}>
            <button type="button" className="action-btn" onClick={finish}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function buildMonthWeeks(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const rows: (number | null)[][] = [];
  let cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) {
    cells.push(d);
    if (cells.length === 7) {
      rows.push(cells);
      cells = [];
    }
  }
  if (cells.length) {
    while (cells.length < 7) cells.push(null);
    rows.push(cells);
  }
  return rows;
}

function getCurrentMonthStats(history: HistoryEntryV1[]) {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const monthLabel = MONTH_LABELS[mo] ?? '---';

  const byDay = new Map<number, { min: number; pts: number }>();
  let monthMin = 0;
  let monthPts = 0;

  for (const h of history) {
    const d = new Date(h.at);
    if (d.getFullYear() !== y || d.getMonth() !== mo) continue;
    const dom = d.getDate();
    const prev = byDay.get(dom) ?? { min: 0, pts: 0 };
    const addMin = h.minutes ?? 0;
    const addPts = h.overallDelta ?? 0;
    byDay.set(dom, { min: prev.min + addMin, pts: prev.pts + addPts });
    monthMin += addMin;
    monthPts += addPts;
  }
  return {
    year: y,
    month: mo,
    monthLabel,
    byDay,
    monthMin,
    monthPts: Math.round(monthPts * 10) / 10,
  };
}

function formatMonthDelta(value: number) {
  return value === 0 ? '±0.0' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatSessionDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatModeLabel(mode: 'listening' | 'conversation') {
  return mode === 'listening' ? 'Listening' : 'Conversation';
}

function GrowthMonthCalendar(props: { stats: ReturnType<typeof getCurrentMonthStats> }) {
  const { stats } = props;

  const weeks = buildMonthWeeks(stats.year, stats.month);
  const weekdayNarrow = WEEKDAY_LABELS;

  return (
    <div className="growth-cal">
      <div className="growth-cal-title">
        {stats.year} {stats.monthLabel} · {stats.monthMin}m
      </div>
      <div className="growth-cal-weekdays" aria-hidden="true">
        {weekdayNarrow.map((w, i) => (
          <span key={i} className="growth-cal-wd">
            {w}
          </span>
        ))}
      </div>
      <div className="growth-cal-grid">
        {weeks.map((row, wi) => (
          <div key={wi} className="growth-cal-row">
            {row.map((day, di) => {
              const cell = day !== null ? stats.byDay.get(day) : undefined;
              const min = cell?.min ?? 0;
              const pts = cell?.pts ?? 0;
              const ptsLabel = pts === 0 ? '0.0' : `${pts > 0 ? '+' : ''}${pts.toFixed(1)}`;
              return (
                <div
                  key={di}
                  className={`growth-cal-cell${day === null ? ' is-empty' : ''}${min > 0 ? ' has-time' : ''}`}
                  title={day === null ? undefined : `${stats.monthLabel} ${day}: ${min}m, Δ ${ptsLabel}`}
                >
                  {day !== null && (
                    <>
                      <span className="growth-cal-dom">{day}</span>
                      {min > 0 && <span className="growth-cal-check">✓</span>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionEvidencePreview(props: { entry: SessionCardPayload }) {
  const { entry } = props;
  if (entry.mode === 'conversation' && entry.report?.evidence && entry.report.evidence.length > 0) {
    const e = entry.report.evidence[0];
    return (
      <div className="session-evidence-inline">
        <span className="session-evidence-dim">{feedbackDimensionLabel(e.dimension)}</span>
        <span className="session-evidence-text">"{e.quote}"</span>
      </div>
    );
  }

  if (entry.mode === 'listening' && entry.listening?.attempts?.[0]) {
    const a = entry.listening.attempts[0];
    return (
      <div className="session-evidence-inline">
        <span className="session-evidence-dim">{a.segmentId}</span>
        <span className="session-evidence-text">
          "{a.attempt.slice(0, 96)}{a.attempt.length > 96 ? '…' : ''}"
        </span>
      </div>
    );
  }

  return null;
}

function SessionCardExtension(props: { entry: SessionCardPayload }) {
  const { entry } = props;
  const feedback = feedbackFromSessionCard(entry);
  return (
    <>
      {feedback && (
        <div className="dimfb-list" style={{ marginTop: 14 }}>
          {feedback.session.dimensions.map((d) => (
            <div key={d.dimension} className={`dimfb-row dimfb-${d.tone}`}>
              <div className="dimfb-top">
                <div className="dimfb-name-wrap">
                  <div className="dimfb-name">{feedbackDimensionLabel(d.dimension)}</div>
                </div>
                <div className={`dimfb-pill dimfb-pill-${d.tone}`}>{d.tone === 'na' ? 'Not assessed' : 'Signal'}</div>
              </div>
              <div className="dimfb-headline">{d.headline}</div>
              <div className="dimfb-detail">{d.detail}</div>
            </div>
          ))}
        </div>
      )}
      <SessionEvidencePreview entry={entry} />
      {entry.report?.note && <div className="session-card-note">{entry.report.note}</div>}
      {entry.report?.parseError && <div className="session-card-note">{entry.report.parseError}</div>}
    </>
  );
}

function transcriptPreviewSnippet(transcript: string, max: number) {
  const t = String(transcript ?? '').trim();
  if (!t) return '';
  const firstLine = t.split('\n').find((line) => line.trim())?.trim() ?? t;
  return clipText(firstLine, max);
}

function HistoryListRow(props: { entry: HistoryEntryV1; onOpen: () => void }) {
  const { entry, onOpen } = props;
  if (entry.mode === 'conversation') {
    const preview =
      transcriptPreviewSnippet(entry.transcript ?? '', 180) || clipText(entry.snapshot, 180) || 'Conversation';
    return (
      <div className="history-row-card">
        <button type="button" className="history-row-tap" onClick={onOpen} aria-label="View transcript">
          <div className="history-row-top">
            <span className="history-row-mode">
              {formatModeLabel(entry.mode)} · {formatSessionDate(entry.at)}
            </span>
            <span className="history-row-open" aria-hidden>
              ›
            </span>
          </div>
          {entry.minutes != null && entry.minutes > 0 ? (
            <div className="history-row-meta">{entry.minutes} min</div>
          ) : null}
          <div className="history-row-transcript-preview">{preview}</div>
        </button>
      </div>
    );
  }

  return (
    <div className="history-row-card">
      <button type="button" className="history-row-tap" onClick={onOpen} aria-label="View session summary">
        <div className="history-row-top">
          <span className="history-row-mode">
            {formatModeLabel(entry.mode)} · {formatSessionDate(entry.at)}
          </span>
          <span className="history-row-open" aria-hidden>
            ›
          </span>
        </div>
        {entry.minutes != null && entry.minutes > 0 ? (
          <div className="history-row-meta">{entry.minutes} min</div>
        ) : null}
        <div className="history-row-transcript-preview">{clipText(entry.snapshot, 180)}</div>
      </button>
    </div>
  );
}

function HistorySessionDetailBody(props: { entry: HistoryEntryV1 }) {
  const { entry } = props;

  if (entry.mode === 'conversation') {
    const tr = String(entry.transcript ?? '').trim();
    const hasCoaching = (entry.naturalCoaching?.length ?? 0) > 0;
    if (tr || hasCoaching) {
      return (
        <div className="history-detail-inner">
          <ConversationTranscriptFeedbackBody
            transcript={entry.transcript ?? ''}
            naturalCoaching={entry.naturalCoaching ?? []}
          />
        </div>
      );
    }
    return (
      <div className="history-detail-inner history-detail-fallback">
        {entry.snapshot ? (
          <div>
            <div className="feedback-section-k">Summary</div>
            <p className="report-snapshot" style={{ marginTop: 8, marginBottom: 0 }}>
              {entry.snapshot}
            </p>
          </div>
        ) : null}
        {entry.nextTarget ? (
          <div className="history-next" style={{ marginTop: 12 }}>
            → {entry.nextTarget}
          </div>
        ) : null}
        <SessionCardExtension entry={entry} />
      </div>
    );
  }

  return (
    <div className="history-detail-inner history-detail-fallback">
      {entry.snapshot ? (
        <div>
          <div className="feedback-section-k">Summary</div>
          <p className="report-snapshot" style={{ marginTop: 8, marginBottom: 0 }}>
            {entry.snapshot}
          </p>
        </div>
      ) : null}
      {entry.nextTarget ? (
        <div className="history-next" style={{ marginTop: 12 }}>
          → {entry.nextTarget}
        </div>
      ) : null}
      <SessionCardExtension entry={entry} />
    </div>
  );
}

function historySheetCloseMs() {
  if (typeof window === 'undefined' || !window.matchMedia) return 320;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 40 : 320;
}

function HistorySessionSheet(props: { entry: HistoryEntryV1; onClose: () => void }) {
  const { entry, onClose } = props;
  const [dragY, setDragY] = useState(0);
  const [handleDragging, setHandleDragging] = useState(false);
  const [exiting, setExiting] = useState(false);
  const dragYRef = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const exitStarted = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (exitStarted.current) return;
    exitStarted.current = true;
    setExiting(true);
    setDragY(0);
    dragging.current = false;
    setHandleDragging(false);
    const ms = historySheetCloseMs();
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, ms);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [requestClose]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (exitStarted.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    dragYRef.current = 0;
    setDragY(0);
    dragging.current = true;
    setHandleDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || exitStarted.current) return;
    const dy = e.clientY - startY.current;
    const y = Math.max(0, dy);
    dragYRef.current = y;
    setDragY(y);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    setHandleDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (exitStarted.current) return;
    if (dragYRef.current > 100) {
      requestClose();
      return;
    }
    setDragY(0);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    dragging.current = false;
    setHandleDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!exitStarted.current) setDragY(0);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`session-sheet-backdrop${exiting ? ' session-sheet-backdrop--exiting' : ''}`}
      role="presentation"
      onClick={requestClose}
    >
      <div
        className={`session-sheet${exiting ? ' session-sheet--exiting' : ''}`}
        style={
          !exiting && dragY > 0
            ? {
                transform: `translate3d(0, ${dragY}px, 0)`,
                transition: handleDragging ? 'none' : 'transform 220ms var(--ease)',
              }
            : undefined
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-sheet-heading"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div
          className="session-sheet-chrome"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <div className="session-sheet-handle" aria-hidden="true" />
          <div className="session-sheet-header">
            <div className="session-sheet-header-text">
              <div className="session-sheet-kicker">{formatModeLabel(entry.mode)}</div>
              <h2 className="session-sheet-title" id="session-sheet-heading">
                {formatSessionDate(entry.at)}
              </h2>
            </div>
            <button
              type="button"
              className="session-sheet-close"
              onClick={requestClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close"
            >
              <span className="session-sheet-close-glyph" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </div>
        <div className="session-sheet-body">
          <div className="session-sheet-body-inner">
            <HistorySessionDetailBody entry={entry} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GrowthView(props: { growth: GrowthStateV1 }) {
  const { growth } = props;
  const dims = growth.dimensions;
  const dimMax = 5;
  const monthStats = getCurrentMonthStats(growth.history);
  const monthDeltaLabel = formatMonthDelta(monthStats.monthPts);
  const historyDesc = [...growth.history].reverse();
  const [sheetEntry, setSheetEntry] = useState<HistoryEntryV1 | null>(null);

  return (
    <div className="page">
      <div className="growth-hero growth-hero-split">
        <div className="growth-hero-score">
          <div className="growth-level">{growth.overall.toFixed(1)}</div>
          <div className="growth-level-label">Overall level · 1.0 – 5.0 scale</div>
          <div className="growth-level-delta">
            This month Δ overall <span className="growth-level-delta-val">{monthDeltaLabel}</span>
          </div>
        </div>
        <GrowthMonthCalendar stats={monthStats} />
      </div>

      <div className="dims">
        {(Object.keys(dims) as Dimension[]).map((d) => (
          <div key={d} className="dim-row">
            <div className="dim-name">{DIMENSION_LABEL[d]}</div>
            <div className="dim-track">
              <div className="dim-fill" style={{ width: `${(dims[d] / dimMax) * 100}%` }} />
            </div>
            <div className="dim-val">{dims[d].toFixed(1)}</div>
          </div>
        ))}
      </div>

      {historyDesc.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 24 }}>
            History
          </div>
          <div className="history-list">
            {historyDesc.map((h) => (
              <HistoryListRow key={h.id} entry={h} onOpen={() => setSheetEntry(h)} />
            ))}
          </div>
          {sheetEntry && (
            <HistorySessionSheet
              key={sheetEntry.id}
              entry={sheetEntry}
              onClose={() => setSheetEntry(null)}
            />
          )}
        </>
      )}

      {historyDesc.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 14, paddingTop: 8 }}>
          No sessions recorded yet.
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  const [flow, setFlow] = useState<Flow>('idle');
  const [growth, setGrowth] = useState<GrowthStateV1>(() => {
    if (USE_SERVER_AUTH) return defaultGrowth();
    const s = getSession();
    return s ? loadGrowthForUser(s.email) : defaultGrowth();
  });
  const [lastSession, setLastSession] = useState<SessionCardPayload | null>(() => {
    if (USE_SERVER_AUTH) return null;
    const s = getSession();
    return s ? loadLastSessionForUser(s.email) : null;
  });
  /** After GET /api/me/state succeeds when using server auth (avoids PUT before hydrate). */
  const [serverStateReady, setServerStateReady] = useState(!USE_SERVER_AUTH);
  const level = levelFromScore(growth.overall);
  const monthStats = getCurrentMonthStats(growth.history);
  const [duration, setDuration] = useState<SessionDuration>(3);
  /** Mic request from the same user gesture as “Conversation”; consumed once in VoicePathA, or released on leave. */
  const convoMicPreflightRef = useRef<Promise<MediaStream | null> | null>(null);
  const serverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acquireConversationMic = useCallback(async (): Promise<MediaStream | null> => {
    const p = convoMicPreflightRef.current;
    if (p) {
      convoMicPreflightRef.current = null;
      return await p;
    }
    if (!navigator.mediaDevices?.getUserMedia) return null;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (flow === 'conversation') return;
    const p = convoMicPreflightRef.current;
    if (p) {
      void p.then((s) => s?.getTracks().forEach((t) => t.stop()));
    }
    convoMicPreflightRef.current = null;
  }, [flow]);

  useLayoutEffect(() => {
    if (!user) {
      if (USE_SERVER_AUTH) setServerStateReady(false);
      return;
    }
    if (!USE_SERVER_AUTH) {
      setGrowth(loadGrowthForUser(user.email));
      setLastSession(loadLastSessionForUser(user.email));
      setServerStateReady(true);
      return;
    }
    setServerStateReady(false);
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/me/state', { credentials: 'include' });
        if (cancelled) return;
        if (!r.ok) {
          setGrowth(defaultGrowth());
          setLastSession(null);
          return;
        }
        const data = (await r.json()) as { growth?: unknown; lastSession?: unknown };
        setGrowth(data.growth != null ? coerceGrowthFromServer(data.growth) : defaultGrowth());
        setLastSession(
          data.lastSession != null ? coerceLastSessionFromServer(data.lastSession) : null,
        );
      } catch {
        if (!cancelled) {
          setGrowth(defaultGrowth());
          setLastSession(null);
        }
      } finally {
        if (!cancelled) setServerStateReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || USE_SERVER_AUTH) return;
    saveGrowthForUser(user.email, growth);
  }, [user, growth]);

  useEffect(() => {
    if (!user || USE_SERVER_AUTH) return;
    saveLastSessionForUser(user.email, lastSession);
  }, [user, lastSession]);

  useEffect(() => {
    if (!user || !USE_SERVER_AUTH || !serverStateReady) return;
    if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    serverSaveTimerRef.current = setTimeout(() => {
      serverSaveTimerRef.current = null;
      void fetch('/api/me/state', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ growth, lastSession }),
      });
    }, 450);
    return () => {
      if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    };
  }, [user, growth, lastSession, serverStateReady]);
  useEffect(() => {
    if (!user) setTab('home');
  }, [user]);

  const inSession = flow !== 'idle';

  if (!user) {
    return (
      <div className="shell">
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className="shell">
      {/* Content */}
      {tab === 'home' && flow === 'idle' && (
        <div className="page">
          <div className="growth-hero growth-hero-split">
            <div className="growth-hero-score">
              <div className="growth-level">{growth.overall.toFixed(1)}</div>
              <div className="growth-level-label">Overall level · 1.0 – 5.0 scale</div>
              <div className="growth-level-delta">
                This month Δ overall{' '}
                <span className="growth-level-delta-val">{formatMonthDelta(monthStats.monthPts)}</span>
              </div>
            </div>
            <GrowthMonthCalendar stats={monthStats} />
          </div>

          <div className="duration-wrap">
            <div className="duration-label">Length</div>
            <div className="duration-row" role="radiogroup" aria-label="Session length">
              {([3, 10, 20] as const).map((d) => (
                <button
                  key={d}
                  className={`dur-btn${duration === d ? ' on' : ''}`}
                  onClick={() => setDuration(d)}
                  aria-pressed={duration === d}
                >
                  {`${d}m`}
                </button>
              ))}
            </div>
          </div>
          <div className="home-paths">
            {SHOW_LISTENING_ON_HOME ? (
            <button
              className="path-btn path-btn--listening"
              onClick={() => {
                requestAudioPlaybackFromUserGesture();
                setFlow('listening');
              }}
            >
              <div className="path-main">
                <div className="path-btn-title">Listening</div>
                <div className="path-btn-sub">Hear a short clip, then summarize the key meaning.</div>
              </div>
              <div className="path-visual listen-visual" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            </button>
            ) : null}
            <button
              className="path-btn path-btn--conversation"
              onClick={() => {
                // Same user gesture: unlock audio, start mic (Promise), go straight to session — one loading surface.
                requestAudioPlaybackFromUserGesture();
                if (navigator.mediaDevices?.getUserMedia) {
                  convoMicPreflightRef.current = navigator.mediaDevices
                    .getUserMedia({
                      audio: {
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                      },
                    })
                    .then((s) => s)
                    .catch(() => null);
                } else {
                  convoMicPreflightRef.current = Promise.resolve(null);
                }
                setFlow('conversation');
              }}
            >
              <div className="path-main">
                <div className="path-btn-title">Start conversation now!</div>
                <div className="path-btn-sub">
                  One tap connects your mic: live voice turns with the AI, then structured feedback when the session
                  ends.
                </div>
              </div>
              <div className="path-visual convo-visual" aria-hidden="true">
                <span className="mic-head" />
                <span className="mic-stem" />
                <span className="mic-base" />
                <span className="mic-wave-left" />
                <span className="mic-wave-right" />
              </div>
            </button>
          </div>
        </div>
      )}

      {tab === 'home' && flow === 'listening' && (
        <div className="page page-session-enter">
          <div className="session-header">
            <button className="back-btn" onClick={() => setFlow('idle')}>←</button>
            <div className="session-title">Listening</div>
          </div>
          <ListenSession
            level={level}
            duration={duration}
            onDone={({ snapshot, nextTarget, attempts, feedback }) => {
              const avg = attempts.length
                ? attempts.reduce((a, b) => a + b.score, 0) / attempts.length
                : 0;
              const delta = avg >= 0.55 ? 0.1 : avg <= 0.25 ? -0.1 : 0;
              setGrowth((g) => {
                const next =
                  delta !== 0
                    ? applyDeltasStable(g, [{ dimension: 'ListeningComprehension', delta }])
                    : g;
                return appendSessionToGrowth(g, next, {
                  mode: 'listening',
                  snapshot,
                  nextTarget,
                  listening: { attempts },
                  feedback,
                  minutes: duration,
                });
              });
              setLastSession({ mode: 'listening', snapshot, nextTarget, listening: { attempts }, feedback });
              setFlow('idle');
              setTab('growth');
            }}
          />
        </div>
      )}

      {tab === 'home' && flow === 'conversation' && (
        <div className="page page-session-enter">
          <div className="session-header">
            <button className="back-btn" onClick={() => setFlow('idle')}>←</button>
            <div className="session-title">Conversation</div>
          </div>
          <ConversationSession
            level={level}
            duration={duration}
            placementPriorScored={growth.history.length}
            acquireMic={acquireConversationMic}
            onDone={({ report, snapshot, nextTarget, transcript, naturalCoaching }) => {
              const historyId = crypto.randomUUID();
              const at = new Date().toISOString();
              const card: SessionCardPayload & { minutes: number } = {
                mode: 'conversation',
                snapshot,
                nextTarget,
                report,
                minutes: duration,
                transcript,
                naturalCoaching,
              };
              const item: HistoryEntryV1 = {
                ...card,
                id: historyId,
                at,
                minutes: duration,
                overallDelta: 0,
              };
              setGrowth((g) => appendHistoryEntry(g, item));
              setLastSession({
                mode: 'conversation',
                snapshot,
                nextTarget,
                report,
                transcript,
                naturalCoaching,
              });
              setFlow('idle');
              setTab('growth');
              window.setTimeout(() => {
                if (asyncConversationGrowthApplied.has(historyId)) return;
                asyncConversationGrowthApplied.add(historyId);
                if (asyncConversationGrowthApplied.size > 64) {
                  asyncConversationGrowthApplied.clear();
                  asyncConversationGrowthApplied.add(historyId);
                }
                setGrowth((g) => {
                  const deltas = conversationDeltasFromReport(report);
                  if (!deltas.length) {
                    return {
                      ...g,
                      history: g.history.map((h) => (h.id === historyId ? { ...h, overallDelta: 0 } : h)),
                    };
                  }
                  const next = applyDeltasStable(g, deltas);
                  const oa = overallDeltaBetween(g, next);
                  return {
                    ...next,
                    history: next.history.map((h) => (h.id === historyId ? { ...h, overallDelta: oa } : h)),
                  };
                });
              }, 0);
            }}
          />
        </div>
      )}

      {tab === 'growth' && (
        <GrowthView growth={growth} />
      )}

      {tab === 'account' && <AccountView />}

      {/* Bottom tab bar — hidden during active session */}
      {!inSession && (
        <nav className="tabbar" aria-label="Main">
          <button
            type="button"
            className={`tab${tab === 'home' ? ' active' : ''}`}
            onClick={() => setTab('home')}
            aria-label="Home"
            aria-current={tab === 'home' ? 'page' : undefined}
          >
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 20v-9.5zM9 21.5V12h6v9.5"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`tab${tab === 'growth' ? ' active' : ''}`}
            onClick={() => setTab('growth')}
            aria-label="Growth"
            aria-current={tab === 'growth' ? 'page' : undefined}
          >
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 18V14M12 18V6M19 18v-7"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`tab${tab === 'account' ? ' active' : ''}`}
            onClick={() => setTab('account')}
            aria-label="Account"
            aria-current={tab === 'account' ? 'page' : undefined}
          >
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
              />
            </svg>
          </button>
        </nav>
      )}
    </div>
  );
}
