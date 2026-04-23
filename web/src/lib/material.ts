import type { ListenSegment, TalkTurn } from './types';

export const defaultListenSegments: ListenSegment[] = [
  {
    id: 's1',
    label: '0:00–0:14',
    listenFor: 'problem → constraint',
    text:
      "We can’t ship the update on Friday. The payment provider is still changing their API, and we can’t risk breaking checkout.",
  },
  {
    id: 's2',
    label: '0:14–0:28',
    listenFor: 'decision + reason',
    text:
      "Let’s push it to Tuesday. That gives us time to test the new integration and add a rollback plan.",
  },
  {
    id: 's3',
    label: '0:28–0:44',
    listenFor: 'stakeholders + next step',
    text:
      "I’ll message support and sales today so they don’t promise the feature. Can you draft a short status update for the team channel?",
  },
];

export const defaultTalkTurns: TalkTurn[] = [
  {
    id: 't1',
    question:
      "Quick check-in: what’s the main risk with shipping on Friday, in one sentence?",
    followUp: 'What would you do to reduce that risk if the date couldn’t move?',
  },
  {
    id: 't2',
    question: 'How would you explain the delay to a non-technical stakeholder?',
    followUp: 'What’s the one thing you want them to do differently this week?',
  },
  {
    id: 't3',
    question:
      "You’re asked: “Why didn’t we know earlier?” Give a calm, direct answer.",
    followUp: 'What’s the process change you’d propose to prevent this next time?',
  },
];

