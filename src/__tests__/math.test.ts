import { describe, it, expect } from 'vitest';
import {
  dotProduct, l2Norm, cosineSimilarity, cosineDistance,
  elementWiseMean, elementWiseVariance, reservoirSample,
} from '../math';

describe('dotProduct', () => {
  it('computes dot product of two vectors', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32); // 4+10+18
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(dotProduct([1, 0], [0, 1])).toBe(0);
  });
});

describe('l2Norm', () => {
  it('computes L2 norm', () => {
    expect(l2Norm([3, 4])).toBeCloseTo(5, 10);
  });
  it('returns 0 for zero vector', () => {
    expect(l2Norm([0, 0, 0])).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });
  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
  it('handles single-element vectors', () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1, 10);
  });
});

describe('cosineDistance', () => {
  it('returns 0 for identical vectors', () => {
    expect(cosineDistance([1, 2], [1, 2])).toBeCloseTo(0, 10);
  });
  it('returns 1 for orthogonal vectors', () => {
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1, 10);
  });
  it('returns 2 for opposite vectors', () => {
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 10);
  });
  it('is clamped to [0, 2]', () => {
    const d = cosineDistance([1, 0], [-1, 0]);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(2);
  });
});

describe('elementWiseMean', () => {
  it('computes centroid of 3 vectors in 2D', () => {
    const mean = elementWiseMean([[1, 2], [3, 4], [5, 6]]);
    expect(mean[0]).toBeCloseTo(3, 10); // (1+3+5)/3
    expect(mean[1]).toBeCloseTo(4, 10); // (2+4+6)/3
  });
  it('returns the vector itself for a single input', () => {
    expect(elementWiseMean([[7, 8, 9]])).toEqual([7, 8, 9]);
  });
});

describe('elementWiseVariance', () => {
  it('returns zero variance for identical vectors', () => {
    const mean = [1, 2];
    const variance = elementWiseVariance([[1, 2], [1, 2], [1, 2]], mean);
    expect(variance[0]).toBeCloseTo(0, 10);
    expect(variance[1]).toBeCloseTo(0, 10);
  });
  it('computes correct variance', () => {
    const vectors = [[0, 0], [2, 4]];
    const mean = elementWiseMean(vectors);
    const variance = elementWiseVariance(vectors, mean);
    // mean=[1,2], diffs=[(-1,-2),(1,2)], var=[(1+1)/2, (4+4)/2]=[1,4]
    expect(variance[0]).toBeCloseTo(1, 10);
    expect(variance[1]).toBeCloseTo(4, 10);
  });
});

describe('reservoirSample', () => {
  it('returns k items from a larger array', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sample = reservoirSample(items, 3);
    expect(sample).toHaveLength(3);
    for (const s of sample) {
      expect(items).toContain(s);
    }
  });
  it('returns entire array when k >= length', () => {
    const items = [1, 2, 3];
    const sample = reservoirSample(items, 5);
    expect(sample).toHaveLength(3);
  });
  it('returns empty for k=0', () => {
    expect(reservoirSample([1, 2, 3], 0)).toHaveLength(0);
  });
});
