import type { DriftSeverity, MethodResult, MethodWeights } from './types';

export const DEFAULT_METHOD_WEIGHTS: MethodWeights = {
  canary: 0.35,
  centroid: 0.15,
  pairwise: 0.20,
  dimensionWise: 0.15,
  mmd: 0.15,
};

/** Map a composite score to a severity band. */
export function scoreSeverity(score: number, modelChanged: boolean): DriftSeverity {
  if (modelChanged) return 'critical';
  if (score < 0.05) return 'none';
  if (score < 0.20) return 'low';
  if (score < 0.40) return 'medium';
  if (score < 0.70) return 'high';
  return 'critical';
}

interface Methods {
  canary: MethodResult;
  centroid: MethodResult;
  pairwise: MethodResult;
  dimensionWise: MethodResult;
  mmd: MethodResult;
}

/** Compute composite score with weight renormalization for disabled/unavailable methods. */
export function computeComposite(
  methods: Methods,
  weights: MethodWeights,
): { score: number; effectiveWeights: MethodWeights } {
  const entries: Array<{ key: keyof Methods; weight: number; score: number }> = [
    { key: 'canary', weight: weights.canary, score: methods.canary.score },
    { key: 'centroid', weight: weights.centroid, score: methods.centroid.score },
    { key: 'pairwise', weight: weights.pairwise, score: methods.pairwise.score },
    { key: 'dimensionWise', weight: weights.dimensionWise, score: methods.dimensionWise.score },
    { key: 'mmd', weight: weights.mmd, score: methods.mmd.score },
  ];

  // Filter to only computed methods
  const active = entries.filter((e) => methods[e.key].computed);

  const zeroWeights: MethodWeights = {
    canary: 0, centroid: 0, pairwise: 0, dimensionWise: 0, mmd: 0,
  };

  if (active.length === 0) {
    return { score: 0, effectiveWeights: zeroWeights };
  }

  const totalWeight = active.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight === 0) {
    return { score: 0, effectiveWeights: zeroWeights };
  }
  let compositeScore = 0;
  for (const e of active) {
    compositeScore += (e.weight / totalWeight) * e.score;
  }

  // Build effective weights (renormalised to sum to 1)
  const effectiveWeights: MethodWeights = {
    canary: 0,
    centroid: 0,
    pairwise: 0,
    dimensionWise: 0,
    mmd: 0,
  };
  for (const e of active) {
    effectiveWeights[e.key] = e.weight / totalWeight;
  }

  return { score: Math.min(1, Math.max(0, compositeScore)), effectiveWeights };
}
