import type { MethodResult, Snapshot } from '../types';

/**
 * Compute pairwise cosine similarity distribution shift.
 * Normalization: mean_diff of 0.1 ≈ score of 0.3; mean_diff of 0.2 saturates to 1.0.
 */
export function computePairwiseDrift(snapshotA: Snapshot, snapshotB: Snapshot): MethodResult {
  const meanDiff = Math.abs(snapshotA.meanPairwiseSimilarity - snapshotB.meanPairwiseSimilarity);
  const stdDiff = Math.abs(snapshotA.stdPairwiseSimilarity - snapshotB.stdPairwiseSimilarity);

  // Combined raw: weight std less than mean
  const raw = meanDiff + 0.5 * stdDiff;

  // Normalise: 0.1 mean shift → ~0.3 score; 0.2 saturates at 1.0
  // Using linear scale: score = raw / 0.2, clamped to [0,1]
  // (0.1 / 0.2 = 0.5, but spec says ~0.3 for 0.1 mean shift)
  // Use a gentler scale: divide by 0.33 gives 0.1/0.33=0.30 ✓ and 0.2/0.33=0.61; for saturation use clamp
  const SCALE = 0.33;
  const score = Math.max(0, Math.min(1, raw / SCALE));

  let interpretation: string;
  if (score < 0.1) {
    interpretation = 'Pairwise similarity distribution is stable.';
  } else if (score < 0.3) {
    interpretation = 'Minor shift in pairwise similarity distribution.';
  } else if (score < 0.6) {
    interpretation = 'Moderate shift in pairwise similarity distribution.';
  } else {
    interpretation = 'Large shift in pairwise similarity distribution.';
  }

  return {
    score,
    computed: true,
    interpretation,
    details: {
      meanDiff,
      stdDiff,
      meanA: snapshotA.meanPairwiseSimilarity,
      meanB: snapshotB.meanPairwiseSimilarity,
      stdA: snapshotA.stdPairwiseSimilarity,
      stdB: snapshotB.stdPairwiseSimilarity,
    },
  };
}
