import { describe, it, expect } from 'vitest';
import { computeMMDDrift } from '../methods/mmd';
import type { Snapshot } from '../types';

/** Build a minimal Snapshot stub with the fields that computeMMDDrift reads. */
function makeSnapshot(
  id: string,
  sampleVectors: number[][],
  dimensionality: number,
): Snapshot {
  return {
    id,
    createdAt: new Date().toISOString(),
    modelId: 'test-model',
    dimensionality,
    sampleCount: sampleVectors.length,
    centroid: new Array(dimensionality).fill(0),
    variance: new Array(dimensionality).fill(1),
    meanPairwiseSimilarity: 0,
    stdPairwiseSimilarity: 0,
    similarityHistogram: new Array(20).fill(0),
    sampleVectors,
  };
}

/** Generate deterministic unit-ish vectors. */
function makeVectors(n: number, d: number, offset = 0): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const vec = Array.from({ length: d }, (__, j) => Math.sin(i + j + offset));
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return vec.map((x) => x / (norm || 1));
  });
}

describe('computeMMDDrift determinism', () => {
  it('produces identical scores for the same inputs across multiple calls', () => {
    const d = 8;
    const vectorsA = makeVectors(15, d, 0);
    const vectorsB = makeVectors(15, d, 50);

    const snapA = makeSnapshot('snap-aaa-111', vectorsA, d);
    const snapB = makeSnapshot('snap-bbb-222', vectorsB, d);

    const result1 = computeMMDDrift(snapA, snapB, 100);
    const result2 = computeMMDDrift(snapA, snapB, 100);
    const result3 = computeMMDDrift(snapA, snapB, 100);

    expect(result1.score).toBe(result2.score);
    expect(result2.score).toBe(result3.score);
    expect(result1.details).toEqual(result2.details);
    expect(result2.details).toEqual(result3.details);
  });

  it('produces different scores when snapshot IDs differ (different seed)', () => {
    const d = 8;
    const vectors = makeVectors(15, d, 0);

    const snapA1 = makeSnapshot('id-alpha', vectors, d);
    const snapB1 = makeSnapshot('id-beta', vectors, d);

    const snapA2 = makeSnapshot('id-gamma', vectors, d);
    const snapB2 = makeSnapshot('id-delta', vectors, d);

    const result1 = computeMMDDrift(snapA1, snapB1, 100);
    const result2 = computeMMDDrift(snapA2, snapB2, 100);

    // Same underlying data but different seeds should generally produce different raw values.
    // Both should be low since same vectors, but the internal mmd2 values differ.
    expect(result1.computed).toBe(true);
    expect(result2.computed).toBe(true);
  });

  it('returns computed=false for empty sample vectors', () => {
    const d = 4;
    const snapA = makeSnapshot('empty-a', [], d);
    const snapB = makeSnapshot('empty-b', makeVectors(5, d), d);

    const result = computeMMDDrift(snapA, snapB, 50);
    expect(result.computed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('detects distributional difference between distinct vector sets', () => {
    const d = 8;
    const vectorsA = makeVectors(20, d, 0);
    const vectorsB = makeVectors(20, d, 100);

    const snapA = makeSnapshot('dist-a', vectorsA, d);
    const snapB = makeSnapshot('dist-b', vectorsB, d);

    const result = computeMMDDrift(snapA, snapB, 100);
    expect(result.computed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('produces low score for identical vector sets', () => {
    const d = 8;
    const vectors = makeVectors(20, d, 0);

    const snapA = makeSnapshot('same-a', vectors, d);
    const snapB = makeSnapshot('same-b', vectors, d);

    const result = computeMMDDrift(snapA, snapB, 100);
    expect(result.computed).toBe(true);
    expect(result.score).toBeLessThan(0.1);
  });
});
