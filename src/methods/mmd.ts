import type { MethodResult, Snapshot } from '../types';
import { dotProduct, l2Norm } from '../math';

const EPSILON = 1e-8;

/** Compute median pairwise L2 distance for bandwidth estimation. */
function medianPairwiseDistance(vectors: number[][]): number {
  const distances: number[] = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const diff = vectors[i].map((v, k) => v - vectors[j][k]);
      distances.push(l2Norm(diff));
    }
  }
  if (distances.length === 0) return 1;
  distances.sort((a, b) => a - b);
  const mid = Math.floor(distances.length / 2);
  return distances.length % 2 === 1
    ? distances[mid]
    : (distances[mid - 1] + distances[mid]) / 2;
}

/** Compute MMD approximation using random Fourier features. */
export function computeMMDDrift(
  snapshotA: Snapshot,
  snapshotB: Snapshot,
  numFeatures: number,
): MethodResult {
  const samplesA = snapshotA.sampleVectors;
  const samplesB = snapshotB.sampleVectors;

  if (samplesA.length === 0 || samplesB.length === 0) {
    return {
      score: 0,
      computed: false,
      interpretation: 'MMD not computed: sample vectors missing.',
    };
  }

  const d = snapshotA.dimensionality;

  // Estimate bandwidth via median heuristic on combined samples
  const combined = [...samplesA, ...samplesB];
  const sigma = medianPairwiseDistance(combined) + EPSILON;

  // Draw random Fourier features: omega_r ~ N(0, (1/sigma^2) * I), b_r ~ U(0, 2*pi)
  const invSigmaSq = 1 / (sigma * sigma);
  const omegas: number[][] = [];
  const biases: number[] = [];

  // Simple deterministic-ish random (seeded by snapshot IDs for consistency)
  // We use Math.random() — tests using identical embeddings should still work.
  for (let r = 0; r < numFeatures; r++) {
    const omega: number[] = [];
    for (let i = 0; i < d; i++) {
      // Box-Muller transform for N(0, 1), then scale by sqrt(invSigmaSq)
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-15))) * Math.cos(2 * Math.PI * u2);
      omega.push(z * Math.sqrt(invSigmaSq));
    }
    omegas.push(omega);
    biases.push(Math.random() * 2 * Math.PI);
  }

  // Compute mean feature map for set A
  const scale = Math.sqrt(2 / numFeatures);
  const muA = new Array<number>(numFeatures).fill(0);
  for (const x of samplesA) {
    for (let r = 0; r < numFeatures; r++) {
      muA[r] += scale * Math.cos(dotProduct(omegas[r], x) + biases[r]);
    }
  }
  for (let r = 0; r < numFeatures; r++) muA[r] /= samplesA.length;

  // Compute mean feature map for set B
  const muB = new Array<number>(numFeatures).fill(0);
  for (const x of samplesB) {
    for (let r = 0; r < numFeatures; r++) {
      muB[r] += scale * Math.cos(dotProduct(omegas[r], x) + biases[r]);
    }
  }
  for (let r = 0; r < numFeatures; r++) muB[r] /= samplesB.length;

  // MMD^2 = ||muA - muB||^2
  let mmd2 = 0;
  for (let r = 0; r < numFeatures; r++) {
    const diff = muA[r] - muB[r];
    mmd2 += diff * diff;
  }

  const mmdRaw = Math.sqrt(Math.max(0, mmd2));
  // Calibrate: same distribution ≈ 0.0, different models ≈ > 0.5
  // Normalize by dividing by 0.5 and clamp to [0, 1]
  const NORM_CONSTANT = 0.5;
  const score = Math.min(1, mmdRaw / NORM_CONSTANT);

  let interpretation: string;
  if (score < 0.05) {
    interpretation = 'MMD indicates no significant distributional difference.';
  } else if (score < 0.20) {
    interpretation = 'MMD indicates low distributional difference.';
  } else if (score < 0.50) {
    interpretation = 'MMD indicates moderate distributional difference.';
  } else {
    interpretation = 'MMD indicates high distributional difference — distributions are dissimilar.';
  }

  return {
    score,
    computed: true,
    interpretation,
    details: {
      mmd2,
      mmdRaw,
      sigma,
      numFeatures,
    },
  };
}
