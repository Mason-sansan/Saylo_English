import type { Evidence, ListenPrompt, SessionConfig, SessionOutput } from './types';

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function keywords(text: string, max = 4) {
  const stop = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'to',
    'of',
    'in',
    'on',
    'for',
    'with',
    'we',
    'i',
    'you',
    'they',
    'it',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'can',
    "can't",
    'could',
    'should',
    'would',
    'still',
    'today',
    'this',
    'that',
    'so',
  ]);
  const words = normalize(text)
    .split(' ')
    .filter((w) => w.length >= 4 && !stop.has(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

export function overlapScore(segmentText: string, attempt: string) {
  const seg = new Set(keywords(segmentText, 8));
  if (seg.size === 0) return 0;
  const att = new Set(keywords(attempt, 16));
  let hit = 0;
  for (const w of att) if (seg.has(w)) hit += 1;
  return Math.max(0, Math.min(1, hit / Math.min(6, seg.size)));
}

export function oneHint(segmentText: string, prompt: ListenPrompt) {
  const ks = keywords(segmentText, 5);
  if (ks.length === 0) return 'Who did what to whom?';
  if (prompt === 'summary') return `Structure: ${ks[0]} → ${ks[1] ?? 'reason'}.`;
  return `Keyword: “${ks[0]}”.`;
}

export function conciseGist(segmentText: string) {
  const t = segmentText.trim();
  if (t.length <= 120) return t;
  return t.slice(0, 118).trimEnd() + '…';
}

export function quickCorrections(answer: string) {
  const a = normalize(answer);
  const fixes: Array<{ from: string; to: string }> = [];
  if (/\bi very\b/.test(a)) fixes.push({ from: 'I very …', to: 'I really … / I truly …' });
  if (/\bdiscuss about\b/.test(a)) fixes.push({ from: 'discuss about', to: 'discuss' });
  if (/\bexplain about\b/.test(a)) fixes.push({ from: 'explain about', to: 'explain' });
  if (/\bdepend of\b/.test(a)) fixes.push({ from: 'depend of', to: 'depend on' });
  return fixes.slice(0, 3);
}

function pickKeyExpressions(e: Evidence) {
  const phrases: string[] = [];
  for (const l of e.listen) {
    if (l.overlapScore >= 0.45) phrases.push('That’s too risky right now.');
  }
  for (const t of e.talk) {
    if (t.answer.toLowerCase().includes('rollback')) phrases.push('We’ll add a rollback plan.');
    if (t.answer.toLowerCase().includes('stakeholder')) phrases.push('For stakeholders, the key point is…');
  }
  const base = [
    'The main risk is breaking checkout.',
    'Let’s push it to Tuesday.',
    'We need time to test the integration.',
    'I’ll message support and sales.',
    'Here’s the short status update:',
  ];
  return uniq([...phrases, ...base]).slice(0, 5);
}

function frictionFromEvidence(e: Evidence) {
  const friction: string[] = [];
  const weakListen = e.listen.filter((x) => x.overlapScore < 0.35);
  if (weakListen.length >= 2) friction.push('Gist is unstable unless you anchor on key nouns (risk, checkout, integration).');
  if (e.listen.some((x) => x.usedHint)) friction.push('You rely on hints when details stack (reason + next step).');
  const shortTalk = e.talk.filter((t) => t.answer.trim().split(/\s+/).length < 12);
  if (shortTalk.length >= 2) friction.push('Answers stay too short under follow-ups (missing reason + one example).');
  return friction.slice(0, 3);
}

function upgradePath(e: Evidence) {
  const items: string[] = [];
  items.push('Next session: answer follow-ups with “claim → reason → one concrete example”.');
  if (e.listen.some((x) => x.overlapScore < 0.35)) {
    items.push('Listening: capture (risk) + (date) + (next step) before speaking.');
  }
  items.push('Use one repair line when unsure: “Let me restate to check I understood…”');
  return items.slice(0, 3);
}

function capabilityUpdate(e: Evidence) {
  const observed: string[] = [];
  const map: string[] = [];
  const notYet: string[] = [];

  const goodListen = e.listen.filter((x) => x.overlapScore >= 0.45).length;
  const okTalk = e.talk.filter((t) => t.answer.trim().split(/\s+/).length >= 12).length;

  if (goodListen >= 2) observed.push('You can capture gist across short segments without losing the main constraint.');
  else observed.push('You can attempt a gist, but key entities drift when the segment adds constraints.');

  if (okTalk >= 2) observed.push('You can answer follow-ups with at least one reason.');
  else observed.push('Under follow-ups, you default to single-sentence answers.');

  map.push('Can summarize a short update in 1–2 sentences.');
  if (goodListen >= 2) map.push('Can track a decision + reason across multiple sentences.');
  if (okTalk >= 2) map.push('Can stay coherent under one follow-up question.');
  map.push('Can ask for clarification when needed.');
  map.push('Can give a simple status update to a team.');

  if (goodListen < 3) notYet.push('Consistently capturing numbers/names/sequence without a hint.');
  if (okTalk < 3) notYet.push('Handling pushback (“why didn’t we know earlier?”) with a structured answer.');

  const nextEvidenceTarget =
    goodListen >= 2 && okTalk >= 2
      ? 'Prove: handle a follow-up + add one concrete example without slowing down.'
      : 'Prove: give a 2-sentence answer that includes (reason + example) on the first try.';

  return {
    observed: observed.slice(0, 4),
    map: uniq(map).slice(0, 10),
    notYetEvidenced: notYet.slice(0, 3),
    nextEvidenceTarget,
  };
}

export function buildSessionOutput(config: SessionConfig, evidence: Evidence): SessionOutput {
  const snapshotParts: string[] = [];
  snapshotParts.push('You can follow a short work update and respond in a structured way');
  snapshotParts.push(`at ${config.level} level`);
  const snapshot = snapshotParts.join(', ') + '.';

  const reflection = {
    snapshot,
    keyExpressions: pickKeyExpressions(evidence),
    frictionPoints: frictionFromEvidence(evidence),
    upgradePath: upgradePath(evidence),
  };

  const capability = capabilityUpdate(evidence);

  return { reflection, capability };
}

