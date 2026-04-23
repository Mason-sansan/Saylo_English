/**
 * CEFR-aligned session dimensions and weights (content / fluency / grammar / vocabulary / interaction).
 * Session score (0–1) = Σ weight × dimension signal; growth levels (1.0–5.0) use the same keys.
 */

export type Dimension =
  | 'ListeningComprehension'
  | 'OralFluency'
  | 'GrammarAccuracy'
  | 'VocabularyRange'
  | 'InteractionQuality';

export const ALL_DIMENSIONS: readonly Dimension[] = [
  'ListeningComprehension',
  'OralFluency',
  'GrammarAccuracy',
  'VocabularyRange',
  'InteractionQuality',
] as const;

/** Matches §3.3 example weights: content 30%, fluency 25%, grammar 20%, vocabulary 15%, interaction 10%. */
export const CEFR_SESSION_WEIGHTS: Record<Dimension, number> = {
  ListeningComprehension: 0.3,
  OralFluency: 0.25,
  GrammarAccuracy: 0.2,
  VocabularyRange: 0.15,
  InteractionQuality: 0.1,
};

/** Short labels for UI (English). */
export const DIMENSION_LABEL: Record<Dimension, string> = {
  ListeningComprehension: 'Listening comprehension',
  OralFluency: 'Oral fluency',
  GrammarAccuracy: 'Grammar accuracy',
  VocabularyRange: 'Vocabulary range',
  InteractionQuality: 'Interaction quality',
};

const LEGACY_DIMENSION_MAP: Record<string, Dimension> = {
  Comprehension: 'ListeningComprehension',
  ListeningComprehension: 'ListeningComprehension',
  OralFluency: 'OralFluency',
  Fluency: 'OralFluency',
  ResponseFit: 'InteractionQuality',
  InteractionQuality: 'InteractionQuality',
  Interaction: 'InteractionQuality',
  VocabularyUse: 'VocabularyRange',
  VocabularyRange: 'VocabularyRange',
  Vocabulary: 'VocabularyRange',
  SentenceControl: 'GrammarAccuracy',
  GrammarAccuracy: 'GrammarAccuracy',
  Grammar: 'GrammarAccuracy',
};

export function normalizeReportDimension(raw: string): Dimension | null {
  const k = String(raw ?? '').trim();
  return LEGACY_DIMENSION_MAP[k] ?? null;
}
