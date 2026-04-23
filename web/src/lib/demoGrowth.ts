/**
 * Sample growth + last session for dev preview (overall 4.2 band).
 * Requires `VITE_DEMO_SESSIONS=1` and explicit seeding: open `?useDemo=1` (signed in or next login) —
 * the app no longer overwrites new accounts with this data automatically.
 */

import type { Dimension } from './cefrDimensions';

export type VoiceReportDemo = {
  snapshot?: string;
  moved?: Array<{ dimension: string; delta: number; reason: string }>;
  held?: Array<{ dimension: string; reason: string }>;
  evidence?: Array<{ dimension: string; quote: string; note: string }>;
  nextTarget?: string;
  /** Matches server `report.placement` when enabled. */
  placement?: { priorScored: number; ordinal: number; netCap: number; phase: 'calibrating' | 'steady' };
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

export type HistoryEntryDemo = {
  id: string;
  at: string;
  mode: 'listening' | 'conversation';
  snapshot: string;
  nextTarget?: string;
  report?: VoiceReportDemo | null;
  listening?: { attempts: Array<{ segmentId: string; attempt: string; score: number }> };
  minutes?: number;
  overallDelta?: number;
  /** Optional: conversation transcript replay (matches post-session feedback UI). */
  transcript?: string;
  naturalCoaching?: Array<{ seq: number; rewrite?: string; note?: string; skip?: boolean; reason?: string }>;
};

export type GrowthStateV1 = {
  version: 2;
  overall: number;
  dimensions: Record<Dimension, number>;
  history: HistoryEntryDemo[];
};

export type LastSessionDemo = {
  mode: 'listening' | 'conversation';
  snapshot: string;
  nextTarget?: string;
  report?: VoiceReportDemo | null;
  listening?: { attempts: Array<{ segmentId: string; attempt: string; score: number }> };
  transcript?: string;
  naturalCoaching?: Array<{ seq: number; rewrite?: string; note?: string; skip?: boolean; reason?: string }>;
};

/** Local calendar days ago from today (demo history aligns with the real current month/day). */
function iso(daysAgo: number, hour: number, minute: number) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute, 0, 0);
  return d.toISOString();
}

const richReport: VoiceReportDemo = {
  snapshot:
    'Interaction quality is uneven under double-barrel prompts; grammar holds when you slow down.',
  moved: [
    {
      dimension: 'InteractionQuality',
      delta: 0.1,
      reason: 'Two complete answers to stacked questions in one turn.',
    },
    {
      dimension: 'ListeningComprehension',
      delta: 0,
      reason: 'No change: reformulation requests were already accurate.',
    },
  ],
  held: [
    {
      dimension: 'VocabularyRange',
      reason: 'Range unchanged; no sustained push past safe word choices.',
    },
  ],
  evidence: [
    {
      dimension: 'GrammarAccuracy',
      quote: 'I think yes, and also the budget, we should maybe cut something.',
      note: 'Two ideas in one line; split into two sentences for clarity.',
    },
    {
      dimension: 'InteractionQuality',
      quote: 'Both. We need faster review and also better docs.',
      note: 'Answers both parts but stays list-like; add one causal link.',
    },
    {
      dimension: 'ListeningComprehension',
      quote: 'You want two deliverables by Friday and one owner each.',
      note: 'Accurate replay of the prompt; good anchor for the reply.',
    },
  ],
  nextTarget: 'Answer in two sentences: claim + one concrete example.',
  audioMetrics: {
    speechSeconds: 38.2,
    wallSeconds: 118,
    userWords: 72,
    userTurns: 5,
    estimatedWpm: 113,
    activityRatio: 0.32,
    fillerCount: 4,
    fillerRate: 0.056,
  },
};

/** ~6 sessions: mixed modes, with optional stored summary cards (evidence / attempts). */
export function demoGrowthState(): GrowthStateV1 {
  const band = 4.2; // Weighted overall → C1 in `levelFromScore` (>4.0, ≤4.6)
  return {
    version: 2,
    overall: band,
    dimensions: {
      ListeningComprehension: band,
      OralFluency: band,
      GrammarAccuracy: band,
      VocabularyRange: band,
      InteractionQuality: band,
    },
    history: [
      {
        id: 'demo-h-1',
        at: iso(5, 8, 12),
        mode: 'listening',
        snapshot:
          'Main thread clear; you lose the second half when numbers and a deadline stack in one sentence.',
        nextTarget:
          'After each clip, restate numbers + deadline in one short phrase before adding detail.',
        listening: {
          attempts: [
            { segmentId: 's1', attempt: 'Cannot ship Friday; payment API still changing.', score: 0.52 },
            { segmentId: 's2', attempt: 'Move to Tuesday, test integration, rollback plan.', score: 0.48 },
          ],
        },
        minutes: 15,
        overallDelta: 0.1,
      },
      {
        id: 'demo-h-2',
        at: iso(4, 19, 40),
        mode: 'conversation',
        snapshot:
          'You answer on-topic, but replies stay thin when the prompt needs a reason, not a yes/no.',
        nextTarget: 'Lead with one reason, then one example. Stop at two sentences unless asked.',
        transcript:
          'Assistant: What would you change first—scope or timeline?\nUser: Probably scope, because we keep adding items without cutting anything.\nAssistant: Say that in one sentence for your lead.\nUser: We should cut scope first since the timeline is already fixed.',
        naturalCoaching: [
          { seq: 1, rewrite: 'We should cut scope first because the timeline is already fixed.', note: 'because + one clear reason' },
        ],
        report: {
          evidence: [
            {
              dimension: 'InteractionQuality',
              quote: 'Yes, we could.',
              note: 'No reason chain; add because + one concrete constraint.',
            },
          ],
        },
        minutes: 20,
        overallDelta: 0,
      },
      {
        id: 'demo-h-3',
        at: iso(3, 7, 5),
        mode: 'listening',
        snapshot:
          'You track a short update; stacked details (reason + next step) still slip under noise.',
        nextTarget: 'Answer with (decision) + (reason) + (next action) in two sentences.',
        listening: {
          attempts: [
            {
              segmentId: 's1',
              attempt: 'They cannot ship because of payment API changes.',
              score: 0.41,
            },
          ],
        },
        minutes: 10,
        overallDelta: -0.1,
      },
      {
        id: 'demo-h-4',
        at: iso(2, 12, 22),
        mode: 'conversation',
        snapshot:
          'Turn-taking is stable; precision drops when the question bundles two constraints.',
        nextTarget:
          'Split bundled questions: answer the first constraint, then ask to cover the second.',
        report: {
          moved: [
            { dimension: 'GrammarAccuracy', delta: 0.1, reason: 'Cleaner split across two turns.' },
          ],
          evidence: [
            {
              dimension: 'ListeningComprehension',
              quote: 'So you want both speed and quality?',
              note: 'Good check; follow with one prioritized answer.',
            },
          ],
        },
        minutes: 15,
        overallDelta: 0.1,
      },
      {
        id: 'demo-h-5',
        at: iso(1, 21, 8),
        mode: 'listening',
        snapshot:
          'Gist holds; you miss the contrast word that flips the speaker’s stance.',
        nextTarget: 'Listen for contrast markers (but, actually, instead) before summarizing.',
        listening: {
          attempts: [
            { segmentId: 's3', attempt: 'Tell support and sales; write status for channel.', score: 0.38 },
          ],
        },
        minutes: 10,
        overallDelta: 0,
      },
      {
        id: 'demo-h-6',
        at: iso(0, 9, 15),
        mode: 'conversation',
        snapshot:
          'Turn-taking is stable; precision drops when the question asks for two constraints at once.',
        nextTarget: 'Answer in two sentences: claim + one concrete example.',
        report: richReport,
        minutes: 20,
        overallDelta: 0.1,
      },
    ],
  };
}

/** Matches the latest history line + full summary card. */
export function demoLastSession(): LastSessionDemo {
  return {
    mode: 'conversation',
    snapshot:
      'Turn-taking is stable; precision drops when the question asks for two constraints at once.',
    nextTarget: 'Answer in two sentences: claim + one concrete example.',
    report: richReport,
  };
}
