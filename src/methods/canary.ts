import type { MethodResult } from '../types';
import { cosineSimilarity } from '../math';

/**
 * Compare two sets of canary embeddings (new vs reference) and return a MethodResult.
 * @param newEmbeddings  Freshly-computed canary embeddings (one per canary text)
 * @param refEmbeddings  Previously-stored reference canary embeddings
 * @param threshold      Cosine similarity threshold below which modelChanged is true
 */
export function computeCanaryDrift(
  newEmbeddings: number[][],
  refEmbeddings: number[][],
  threshold: number,
): MethodResult & { modelChanged: boolean; perCanarySimilarities: number[]; meanSimilarity: number; minSimilarity: number } {
  const count = Math.min(newEmbeddings.length, refEmbeddings.length);
  const perCanarySimilarities: number[] = [];

  for (let i = 0; i < count; i++) {
    perCanarySimilarities.push(cosineSimilarity(newEmbeddings[i], refEmbeddings[i]));
  }

  const meanSimilarity =
    perCanarySimilarities.length > 0
      ? perCanarySimilarities.reduce((a, b) => a + b, 0) / perCanarySimilarities.length
      : 1;

  const minSimilarity =
    perCanarySimilarities.length > 0 ? Math.min(...perCanarySimilarities) : 1;

  const driftScore = Math.max(0, Math.min(1, 1 - meanSimilarity));
  const modelChanged = meanSimilarity < threshold;

  let interpretation: string;
  if (driftScore < 0.005) {
    interpretation = 'Canary embeddings are identical — model is unchanged.';
  } else if (driftScore < 0.05) {
    interpretation = 'Minor canary variation — model is likely unchanged.';
  } else {
    interpretation = `Significant canary drift (score=${driftScore.toFixed(3)}) — model has likely changed.`;
  }

  return {
    score: driftScore,
    computed: true,
    interpretation,
    details: {
      meanSimilarity,
      minSimilarity,
      perCanarySimilarities,
      threshold,
    },
    modelChanged,
    perCanarySimilarities,
    meanSimilarity,
    minSimilarity,
  };
}
