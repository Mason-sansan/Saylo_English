import type { Evidence, ListenPrompt, Phase, SessionConfig, SessionOutput } from './types';
import { defaultListenSegments, defaultTalkTurns } from './material';
import { buildSessionOutput, conciseGist, oneHint, overlapScore, quickCorrections } from './coach';

export type ListenStepState =
  | { kind: 'awaiting_attempt' }
  | { kind: 'feedback'; overlap: number; hint?: string; gist?: string; corrections?: never };

export type TalkStepState =
  | { kind: 'awaiting_answer' }
  | { kind: 'feedback'; followUp?: string; corrections?: Array<{ from: string; to: string }> };

export type SessionState = {
  phase: Phase;
  config: SessionConfig;

  listenIndex: number;
  listenStep: ListenStepState;
  talkIndex: number;
  talkStep: TalkStepState;

  evidence: Evidence;
  output?: SessionOutput;
};

export function initialSessionState(): SessionState {
  return {
    phase: 'setup',
    config: { mode: 'mix', level: 'B1', topic: 'Work update', minutes: 8, listenPrompt: 'paraphrase' },
    listenIndex: 0,
    listenStep: { kind: 'awaiting_attempt' },
    talkIndex: 0,
    talkStep: { kind: 'awaiting_answer' },
    evidence: { listen: [], talk: [] },
  };
}

export function getListenSegment(state: SessionState) {
  return defaultListenSegments[state.listenIndex] ?? null;
}

export function getTalkTurn(state: SessionState) {
  return defaultTalkTurns[state.talkIndex] ?? null;
}

export function startSession(state: SessionState): SessionState {
  return {
    ...state,
    phase: 'listen',
    listenIndex: 0,
    listenStep: { kind: 'awaiting_attempt' },
    talkIndex: 0,
    talkStep: { kind: 'awaiting_answer' },
    evidence: { listen: [], talk: [] },
    output: undefined,
  };
}

export function setConfig(state: SessionState, patch: Partial<SessionConfig>): SessionState {
  return { ...state, config: { ...state.config, ...patch } };
}

export function submitListenAttempt(state: SessionState, attempt: string): SessionState {
  const seg = getListenSegment(state);
  if (!seg) return state;

  const score = overlapScore(seg.text, attempt);
  const usedHint = score < 0.35;
  const hint = usedHint ? oneHint(seg.text, state.config.listenPrompt) : undefined;

  return {
    ...state,
    listenStep: { kind: 'feedback', overlap: score, hint, gist: score < 0.2 ? conciseGist(seg.text) : undefined },
    evidence: {
      ...state.evidence,
      listen: [
        ...state.evidence.listen,
        { segmentId: seg.id, prompt: state.config.listenPrompt as ListenPrompt, attempt, overlapScore: score, usedHint },
      ],
    },
  };
}

export function nextFromListen(state: SessionState): SessionState {
  const nextIndex = state.listenIndex + 1;
  if (nextIndex < defaultListenSegments.length) {
    return { ...state, listenIndex: nextIndex, listenStep: { kind: 'awaiting_attempt' } };
  }
  return { ...state, phase: 'talk', talkIndex: 0, talkStep: { kind: 'awaiting_answer' } };
}

export function submitTalkAnswer(state: SessionState, answer: string): SessionState {
  const turn = getTalkTurn(state);
  if (!turn) return state;

  const fixes = quickCorrections(answer);
  const shouldShowCorrections = state.evidence.talk.length % 2 === 1 && fixes.length > 0;

  return {
    ...state,
    talkStep: {
      kind: 'feedback',
      followUp: turn.followUp,
      corrections: shouldShowCorrections ? fixes : undefined,
    },
    evidence: {
      ...state.evidence,
      talk: [...state.evidence.talk, { turnId: turn.id, question: turn.question, answer }],
    },
  };
}

export function nextFromTalk(state: SessionState): SessionState {
  const nextIndex = state.talkIndex + 1;
  if (nextIndex < defaultTalkTurns.length) {
    return { ...state, talkIndex: nextIndex, talkStep: { kind: 'awaiting_answer' } };
  }
  const output = buildSessionOutput(state.config, state.evidence);
  return { ...state, phase: 'close', output };
}

export function resetToSetup(state: SessionState): SessionState {
  const base = initialSessionState();
  return { ...base, config: state.config };
}

