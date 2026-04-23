/**
 * Curated conversation scenarios (JSON on disk). Server picks at random by CEFR level.
 * Client is unaware — same WebSocket URL as before.
 */

import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'conversation-scenes.json');

const VALID_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

/** @type {{ scenarios: unknown[] } | null} */
let cachedDoc = null;
/** @type {boolean} */
let loggedLoad = false;

function normLevel(l) {
  const x = String(l ?? 'B1')
    .trim()
    .toUpperCase();
  return VALID_LEVELS.has(x) ? x : 'B1';
}

/**
 * @param {unknown[]} pool
 */
function pickRandom(pool) {
  if (!pool.length) return null;
  const i = randomInt(0, pool.length);
  return pool[i];
}

/**
 * @param {Record<string, unknown>} s
 */
function sceneToPack(s) {
  const title = String(s.title ?? '').trim();
  const setting = String(s.setting ?? s.context ?? '').trim();
  const coachRole = String(s.coachRole ?? '').trim();
  const learnerRole = String(s.learnerRole ?? '').trim();
  const goals = Array.isArray(s.learnerGoals) ? s.learnerGoals.map((g) => String(g).trim()).filter(Boolean) : [];

  /** @type {string[]} */
  const openingCandidates = [];
  const main = String(s.firstLine ?? s.openingScript ?? '').trim();
  if (main) openingCandidates.push(main);
  if (Array.isArray(s.variants)) {
    for (const v of s.variants) {
      if (v && typeof v === 'object' && 'firstLine' in v) {
        const line = String(/** @type {{ firstLine?: string }} */ (v).firstLine ?? '').trim();
        if (line) openingCandidates.push(line);
      }
    }
  }
  const openings = openingCandidates.filter((t) => t.length >= 12);
  const openingScript = pickRandom(openings);
  if (!openingScript) return null;

  let context = setting;
  if (goals.length) {
    context = [setting, 'Learner goals:', ...goals.map((g) => `- ${g}`)].join('\n');
  }
  context = context.replace(/\s+/g, ' ').trim();
  if (context.length < 8) return null;
  if (title.length < 2 || coachRole.length < 2 || learnerRole.length < 2) return null;

  return {
    title: title.slice(0, 120),
    context: context.slice(0, 500),
    coachRole: coachRole.slice(0, 80),
    learnerRole: learnerRole.slice(0, 80),
    openingScript: openingScript.slice(0, 1400),
  };
}

async function loadDoc() {
  if (cachedDoc) return cachedDoc;
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const scenarios = Array.isArray(parsed?.scenarios) ? parsed.scenarios : [];
    cachedDoc = { scenarios };
    if (!loggedLoad) {
      loggedLoad = true;
      // eslint-disable-next-line no-console
      console.info(`[conversation] scene library loaded: ${scenarios.length} scenarios from ${DATA_FILE}`);
    }
    return cachedDoc;
  } catch (e) {
    cachedDoc = { scenarios: [] };
    if (!loggedLoad) {
      loggedLoad = true;
      // eslint-disable-next-line no-console
      console.warn('[conversation] scene library missing or invalid — using LLM / built-in fallback:', e?.message ?? e);
    }
    return cachedDoc;
  }
}

/**
 * Random pack for realtime opening. Prefers scenarios tagged with `level`; if none, uses entire library.
 * @param {string} requestedLevel
 * @returns {Promise<{ title: string, context: string, coachRole: string, learnerRole: string, openingScript: string } | null>}
 */
export async function pickPackFromLibrary(requestedLevel) {
  const level = normLevel(requestedLevel);
  const doc = await loadDoc();
  const raw = doc.scenarios.filter((x) => x && typeof x === 'object');
  /** @type {Record<string, unknown>[]} */
  const objects = /** @type {Record<string, unknown>[]} */ (raw);

  let pool = objects.filter((s) => normLevel(/** @type {string} */ (s.level)) === level);
  if (!pool.length) pool = objects;
  if (!pool.length) return null;

  const maxAttempts = Math.min(pool.length, 12);
  for (let i = 0; i < maxAttempts; i++) {
    const shuffledPick = pickRandom(pool);
    if (!shuffledPick) return null;
    const pack = sceneToPack(shuffledPick);
    if (pack) return pack;
  }
  // eslint-disable-next-line no-console
  console.warn('[conversation] scene library: no valid pack after tries', { level, poolSize: pool.length });
  return null;
}
