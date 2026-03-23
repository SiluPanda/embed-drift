import type { MethodResult, Snapshot } from '../types';

const EPSILON = 1e-8;

/** Compute dimension-wise drift (Cohen's d + KS-like statistic). */
export function computeDimensionWiseDrift(snapshotA: Snapshot, snapshotB: Snapshot): MethodResult {
  const d = snapshotA.dimensionality;

  // Cohen's d per dimension using centroid + variance
  let cohensTotal = 0;
  for (let i = 0; i < d; i++) {
    const meanDiff = snapshotA.centroid[i] - snapshotB.centroid[i];
    const varPooled = (snapshotA.variance[i] + snapshotB.variance[i]) / 2 + EPSILON;
    cohensTotal += Math.abs(meanDiff) / Math.sqrt(varPooled);
  }
  const meanCohensD = cohensTotal / d;
  // Normalise: Cohen's d of ~2.0 maps to score 1.0
  const cohensScore = Math.min(1, meanCohensD / 2.0);

  // KS-like statistic per dimension over sample vectors
  let ksTotal = 0;
  const samplesA = snapshotA.sampleVectors;
  const samplesB = snapshotB.sampleVectors;
  const nA = samplesA.length;
  const nB = samplesB.length;

  if (nA > 0 && nB > 0) {
    for (let i = 0; i < d; i++) {
      const colA = samplesA.map((v) => v[i]).sort((x, y) => x - y);
      const colB = samplesB.map((v) => v[i]).sort((x, y) => x - y);

      // Compute max CDF difference
      let jA = 0;
      let jB = 0;
      let maxDiff = 0;
      while (jA < nA || jB < nB) {
        const valA = jA < nA ? colA[jA] : Infinity;
        const valB = jB < nB ? colB[jB] : Infinity;
        const nextVal = Math.min(valA, valB);
        while (jA < nA && colA[jA] <= nextVal) jA++;
        while (jB < nB && colB[jB] <= nextVal) jB++;
        const diff = Math.abs(jA / nA - jB / nB);
        if (diff > maxDiff) maxDiff = diff;
      }
      ksTotal += maxDiff;
    }
  }

  const meanKS = nA > 0 && nB > 0 ? ksTotal / d : 0;
  // Blend Cohen's d score and KS score equally
  const score = Math.min(1, (cohensScore + meanKS) / 2);

  let interpretation: string;
  if (score < 0.05) {
    interpretation = 'No significant dimension-wise drift detected.';
  } else if (score < 0.20) {
    interpretation = 'Low dimension-wise drift — minor per-dimension shifts.';
  } else if (score < 0.40) {
    interpretation = 'Moderate dimension-wise drift — several dimensions have shifted.';
  } else {
    interpretation = 'High dimension-wise drift — widespread dimensional shift detected.';
  }

  return {
    score,
    computed: true,
    interpretation,
    details: {
      meanCohensD,
      cohensScore,
      meanKS,
      dimensionsAnalyzed: d,
    },
  };
}
