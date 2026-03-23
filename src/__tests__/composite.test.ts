import { describe, it, expect } from 'vitest';
import { computeComposite, scoreSeverity, DEFAULT_METHOD_WEIGHTS } from '../composite';
import type { MethodResult } from '../types';

function makeResult(score: number, computed = true): MethodResult {
  return { score, computed, interpretation: '', details: {} };
}

describe('scoreSeverity', () => {
  it('returns none for score < 0.05', () => {
    expect(scoreSeverity(0.03, false)).toBe('none');
  });
  it('returns low for score 0.05-0.19', () => {
    expect(scoreSeverity(0.10, false)).toBe('low');
  });
  it('returns medium for score 0.20-0.39', () => {
    expect(scoreSeverity(0.30, false)).toBe('medium');
  });
  it('returns high for score 0.40-0.69', () => {
    expect(scoreSeverity(0.50, false)).toBe('high');
  });
  it('returns critical for score >= 0.70', () => {
    expect(scoreSeverity(0.80, false)).toBe('critical');
  });
  it('returns critical when modelChanged is true regardless of score', () => {
    expect(scoreSeverity(0.01, true)).toBe('critical');
  });
});

describe('computeComposite', () => {
  it('computes weighted average with default weights', () => {
    const methods = {
      canary: makeResult(0.1),
      centroid: makeResult(0.2),
      pairwise: makeResult(0.3),
      dimensionWise: makeResult(0.4),
      mmd: makeResult(0.5),
    };
    const { score } = computeComposite(methods, DEFAULT_METHOD_WEIGHTS);
    // Manual: 0.35*0.1 + 0.15*0.2 + 0.20*0.3 + 0.15*0.4 + 0.15*0.5
    // = 0.035 + 0.03 + 0.06 + 0.06 + 0.075 = 0.26
    expect(score).toBeCloseTo(0.26, 2);
  });

  it('renormalizes weights when a method is not computed', () => {
    const methods = {
      canary: makeResult(0, false),     // not computed
      centroid: makeResult(0.5),
      pairwise: makeResult(0.5),
      dimensionWise: makeResult(0.5),
      mmd: makeResult(0.5),
    };
    const { score, effectiveWeights } = computeComposite(methods, DEFAULT_METHOD_WEIGHTS);
    expect(effectiveWeights.canary).toBe(0);
    expect(score).toBeCloseTo(0.5, 2); // all active methods have 0.5
  });

  it('returns 0 when no methods are computed', () => {
    const methods = {
      canary: makeResult(0, false),
      centroid: makeResult(0, false),
      pairwise: makeResult(0, false),
      dimensionWise: makeResult(0, false),
      mmd: makeResult(0, false),
    };
    const { score } = computeComposite(methods, DEFAULT_METHOD_WEIGHTS);
    expect(score).toBe(0);
  });

  it('clamps score to [0, 1]', () => {
    const methods = {
      canary: makeResult(1.0),
      centroid: makeResult(1.0),
      pairwise: makeResult(1.0),
      dimensionWise: makeResult(1.0),
      mmd: makeResult(1.0),
    };
    const { score } = computeComposite(methods, DEFAULT_METHOD_WEIGHTS);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
