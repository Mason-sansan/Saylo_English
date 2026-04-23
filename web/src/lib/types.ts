export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type Mode = 'mix';

export type Phase = 'setup' | 'listen' | 'talk' | 'close';

export type ListenPrompt = 'paraphrase' | 'summary';

export type Evidence = {
  listen: Array<{
    segmentId: string;
    prompt: ListenPrompt;
    attempt: string;
    overlapScore: number; // 0..1 heuristic
    usedHint: boolean;
  }>;
  talk: Array<{
    turnId: string;
    question: string;
    answer: string;
  }>;
};

export type SessionConfig = {
  mode: Mode;
  level: Level;
  topic: string;
  minutes: 6 | 8 | 10;
  listenPrompt: ListenPrompt;
};

export type ListenSegment = {
  id: string;
  label: string; // "0:00–0:14"
  text: string; // MVP: text stands in for audio
  listenFor?: string;
};

export type TalkTurn = {
  id: string;
  question: string;
  followUp?: string;
};

export type SessionOutput = {
  reflection: {
    snapshot: string;
    keyExpressions: string[];
    frictionPoints: string[];
    upgradePath: string[];
  };
  capability: {
    observed: string[];
    map: string[];
    notYetEvidenced: string[];
    nextEvidenceTarget: string;
  };
};

