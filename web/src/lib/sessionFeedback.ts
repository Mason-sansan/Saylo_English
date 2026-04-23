import { overlapScore, quickCorrections } from './coach';
import type { Dimension } from './cefrDimensions';
export type { Dimension } from './cefrDimensions';

export type DimTone = 'good' | 'warn' | 'miss' | 'neutral' | 'na';

export type DimFeedback = {
  dimension: Dimension;
  tone: DimTone;
  /** One short headline the user can scan */
  headline: string;
  /** 1–2 sentences; plain language */
  detail: string;
};

type AnchorStatus = 'got' | 'vague' | 'missing';

/** C2 quick report cards (English), when server sends `report.quick`. */
export type QuickReportCardsPayload = {
  verdict: string;
  strengths: string[];
  gaps: string[];
  growth_tags?: { strong: string[]; focus: string[] };
  correction: {
    kind: string;
    subkind: string;
    original: string;
    better: string;
    why: string;
  };
  next_drill: {
    title: string;
    target_dimension: string;
    prompt: string;
    example_answer: string;
    success_check: string[];
  };
  meta?: { source?: string; latency_ms?: number; model?: string; language_gate?: string };
};

export type SessionFeedbackPayload = {
  mode: 'listening' | 'conversation';
  dimensions: DimFeedback[];
  /** Overall: what to do next (session-level) */
  summaryNext: string;
  /** Rich C2 UI when present */
  quickCards?: QuickReportCardsPayload | null;
  /** English-only practice: Chinese-dominant user turns → no level / Growth impact */
  scoringMode?: 'scored' | 'not_scored';
  notScoredReason?: string;
};

function normText(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(text: string) {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts[0] ?? text.trim();
}

function pickSentence(text: string, patterns: RegExp[]) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const s of sentences) {
    for (const p of patterns) {
      if (p.test(s)) return s;
    }
  }
  return '';
}

export function extractListeningAnchors(script: string) {
  const decision =
    pickSentence(script, [
      /\b(decide|decision|decided)\b/i,
      /\b(let's|lets)\b/i,
      /\b(move|shift|delay|postpone|rollout|release)\b/i,
      /\bpropose|plan\b/i,
    ]) || firstSentence(script);

  const reason =
    pickSentence(script, [
      /\b(because|since|due to|as a result|reason)\b/i,
      /\b(stable|spikes|warning|late|delays|changed|timeout)\b/i,
    ]) || '';

  const nextAction =
    pickSentence(script, [
      /\b(need to|must|should)\b/i,
      /\b(message|send|call|check|confirm|keep|avoid|monitor|notify)\b/i,
      /\b(today|before|this afternoon|now)\b/i,
    ]) || '';

  return { decision, reason, nextAction };
}

type AnchorKey = 'Decision' | 'Reason' | 'NextAction';

function anchorStatus(anchorText: string, attemptText: string): AnchorStatus {
  const a = normText(anchorText);
  const t = normText(attemptText);
  if (!a || !t) return 'missing';
  const s = overlapScore(a, t);
  if (s >= 0.35) return 'got';
  if (s >= 0.18) return 'vague';
  return 'missing';
}

function nextMoveFromStatuses(statuses: Record<AnchorKey, AnchorStatus>) {
  const missing = (k: AnchorKey) => statuses[k] === 'missing';
  const vague = (k: AnchorKey) => statuses[k] === 'vague';

  if (missing('NextAction') || vague('NextAction')) {
    return {
      title: 'Add the next action (verb-first).',
      template: 'Next, we will __.',
    };
  }
  if (missing('Reason') || vague('Reason')) {
    return {
      title: 'Add the reason in one clause.',
      template: 'The reason is that __.',
    };
  }
  if (missing('Decision') || vague('Decision')) {
    return {
      title: 'State the decision explicitly.',
      template: 'The decision is to __.',
    };
  }
  return {
    title: 'Compress to two sentences.',
    template: 'The decision is to __. Next, we will __.',
  };
}

function toneFromScore(score: number): DimTone {
  if (score >= 0.45) return 'good';
  if (score >= 0.25) return 'warn';
  return 'miss';
}

function listeningComprehensionCopy(args: {
  gistScore: number;
  statuses: Record<AnchorKey, AnchorStatus>;
  missCount: number;
  vagueCount: number;
}) {
  const { gistScore, statuses, missCount, vagueCount } = args;
  const tone = toneFromScore(gistScore);

  const missingList: string[] = [];
  if (statuses.Decision === 'missing') missingList.push('decision');
  if (statuses.Reason === 'missing') missingList.push('reason');
  if (statuses.NextAction === 'missing') missingList.push('next action');

  const vagueList: string[] = [];
  if (statuses.Decision === 'vague') vagueList.push('decision');
  if (statuses.Reason === 'vague') vagueList.push('reason');
  if (statuses.NextAction === 'vague') vagueList.push('next action');

  let headline = '';
  if (tone === 'good') headline = 'Main message is clear.';
  else if (tone === 'warn') headline = 'Main message is partly clear.';
  else headline = 'Main message needs more evidence.';

  const parts: string[] = [];
  if (missingList.length) {
    parts.push(`Your recap did not clearly include: ${missingList.join(', ')}.`);
  } else if (vagueList.length) {
    parts.push(`These parts are still broad: ${vagueList.join(', ')}. Add one concrete move, risk, or step.`);
  } else {
    parts.push('Core points are present. Tighten wording so a teammate can act immediately.');
  }

  if (missCount + vagueCount === 0) {
    parts.push('Keep using a two-sentence structure: decision -> reason or next step.');
  }

  return { tone, headline, detail: parts.join(' ') };
}

function listeningInteractionPlaceholderCopy(attempt: string) {
  void attempt;
  return {
    tone: 'na' as const,
    headline: 'Not assessed in this Listening card.',
    detail:
      'Interaction quality is assessed in Conversation sessions (relevance, follow-ups, turn-taking).',
  };
}

function listeningVocabularyCopy(attempt: string) {
  const fixes = quickCorrections(attempt);
  if (fixes.length > 0) {
    const f = fixes[0];
    return {
      tone: 'neutral' as const,
      headline: 'Vocabulary note (optional for Listening).',
      detail: `If you reuse this in Conversation, prefer: ${f.from} -> ${f.to}.`,
    };
  }
  return {
    tone: 'na' as const,
    headline: 'Not evaluated in this Listening card.',
    detail:
      'Vocabulary range is evaluated in Conversation sessions (collocation and precision under follow-up pressure).',
  };
}

function listeningSentenceControlCopy(attempt: string) {
  const sentences = attempt
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const words = attempt.trim().split(/\s+/).filter(Boolean);

  if (sentences.length >= 2 && words.length >= 14) {
    return {
      tone: 'neutral' as const,
      headline: 'Sentence shape is usable for recap.',
      detail: 'You split ideas into separate sentences, which is enough for this Listening response.',
    };
  }

  if (sentences.length <= 1 && words.length >= 8) {
    return {
      tone: 'neutral' as const,
      headline: 'Sentence shape can be clearer.',
      detail:
        'Two short sentences are easier to parse: (1) what changed/decided, (2) why or what happens next.',
    };
  }

  return {
    tone: 'na' as const,
    headline: 'Not evaluated in this Listening card.',
    detail:
      'Grammar accuracy is evaluated in Conversation sessions, where you sustain longer responses and handle follow-up turns.',
  };
}

function listeningFluencyPlaceholderCopy(attempt: string) {
  void attempt;
  return {
    tone: 'na' as const,
    headline: 'Not assessed in this Listening card.',
    detail:
      'Oral fluency is assessed in Conversation sessions (pace, continuity, and natural flow from audio + transcript).',
  };
}

export function buildListeningFeedback(script: string, attempt: string, gistScore: number): SessionFeedbackPayload {
  const anchors = extractListeningAnchors(script);
  const statuses: Record<AnchorKey, AnchorStatus> = {
    Decision: anchorStatus(anchors.decision, attempt),
    Reason: anchorStatus(anchors.reason, attempt),
    NextAction: anchorStatus(anchors.nextAction, attempt),
  };
  const missCount = (Object.values(statuses) as AnchorStatus[]).filter((s) => s === 'missing').length;
  const vagueCount = (Object.values(statuses) as AnchorStatus[]).filter((s) => s === 'vague').length;

  const comp = listeningComprehensionCopy({ gistScore, statuses, missCount, vagueCount });
  const move = nextMoveFromStatuses(statuses);

  const dimensions: DimFeedback[] = [
    {
      dimension: 'ListeningComprehension',
      tone: comp.tone,
      headline: comp.headline,
      detail: comp.detail,
    },
    {
      dimension: 'OralFluency',
      ...listeningFluencyPlaceholderCopy(attempt),
    },
    {
      dimension: 'GrammarAccuracy',
      ...listeningSentenceControlCopy(attempt),
    },
    {
      dimension: 'VocabularyRange',
      ...listeningVocabularyCopy(attempt),
    },
    {
      dimension: 'InteractionQuality',
      ...listeningInteractionPlaceholderCopy(attempt),
    },
  ];

  const summaryNext = `${move.title} Use: ${move.template}`;

  return { mode: 'listening', dimensions, summaryNext };
}
