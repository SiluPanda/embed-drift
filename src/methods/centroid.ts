import type { MethodResult, Snapshot } from '../types';
import { cosineDistance, cosineSimilarity } from '../math';

/** Compute centroid drift between two snapshots. */
export function computeCentroidDrift(snapshotA: Snapshot, snapshotB: Snapshot): MethodResult {
  const rawDistance = cosineDistance(snapshotA.centroid, snapshotB.centroid);
  // Cosine distance is [0, 2]; normalise to [0, 1] by clamping at 1.0
  const score = Math.min(1, rawDistance);
  const sim = cosineSimilarity(snapshotA.centroid, snapshotB.centroid);

  let interpretation: string;
  if (score < 0.05) {
    interpretation = 'Centroids are nearly identical — no meaningful centroid shift.';
  } else if (score < 0.20) {
    interpretation = 'Low centroid drift — minor distribution shift.';
  } else if (score < 0.40) {
    interpretation = 'Moderate centroid drift — distribution has shifted significantly.';
  } else {
    interpretation = 'High centroid drift — distribution center has moved substantially.';
  }

  return {
    score,
    computed: true,
    interpretation,
    details: {
      cosineDistance: rawDistance,
      cosineSimilarity: sim,
    },
  };
}
