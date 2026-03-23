import { describe, it, expect, vi } from 'vitest';
import { evaluateAlert, dispatchAlert } from '../alert';
import type { DriftReport, CanaryReport, MethodResult } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────

function makeMethodResult(overrides: Partial<MethodResult> = {}): MethodResult {
  return {
    score: 0,
    computed: true,
    interpretation: 'no drift',
    ...overrides,
  };
}

function makeDriftReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    id: 'report-1',
    createdAt: '2026-01-01T00:00:00Z',
    snapshotIds: ['snap-a', 'snap-b'],
    modelIds: ['model-a', 'model-a'],
    modelChanged: false,
    methods: {
      canary: makeMethodResult(),
      centroid: makeMethodResult(),
      pairwise: makeMethodResult(),
      dimensionWise: makeMethodResult(),
      mmd: makeMethodResult(),
    },
    composite: {
      score: 0.1,
      severity: 'low',
      weights: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 },
    },
    alerted: false,
    summary: 'no significant drift',
    durationMs: 42,
    ...overrides,
  };
}

function _makeCanaryReport(overrides: Partial<CanaryReport> = {}): CanaryReport {
  return {
    id: 'canary-1',
    createdAt: '2026-01-01T00:00:00Z',
    canaryCount: 5,
    meanSimilarity: 0.98,
    minSimilarity: 0.95,
    perCanarySimilarities: [0.98, 0.97, 0.99, 0.96, 0.95],
    driftScore: 0.02,
    modelChanged: false,
    isInitialBaseline: false,
    alerted: false,
    modelId: 'model-a',
    durationMs: 10,
    ...overrides,
  };
}

// ── evaluateAlert ─────────────────────────────────────────────────────

describe('evaluateAlert', () => {
  it('returns false when severity < alertSeverity', () => {
    const report = makeDriftReport({
      composite: {
        score: 0.1,
        severity: 'low',
        weights: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 },
      },
    });
    expect(evaluateAlert(report, 'high', {})).toBe(false);
  });

  it('returns true when severity >= alertSeverity', () => {
    const report = makeDriftReport({
      composite: {
        score: 0.8,
        severity: 'high',
        weights: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 },
      },
    });
    expect(evaluateAlert(report, 'medium', {})).toBe(true);
  });

  it('returns true when per-method score exceeds threshold', () => {
    const report = makeDriftReport({
      composite: {
        score: 0.1,
        severity: 'low',
        weights: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 },
      },
      methods: {
        canary: makeMethodResult(),
        centroid: makeMethodResult({ score: 0.9, computed: true }),
        pairwise: makeMethodResult(),
        dimensionWise: makeMethodResult(),
        mmd: makeMethodResult(),
      },
    });
    // Overall severity is 'low', alertSeverity is 'high' — severity alone would not fire.
    // But centroid score (0.9) exceeds per-method threshold (0.5).
    expect(evaluateAlert(report, 'high', { centroid: 0.5 })).toBe(true);
  });
});

// ── dispatchAlert ─────────────────────────────────────────────────────

describe('dispatchAlert', () => {
  it('calls onDrift when alert fires', () => {
    const report = makeDriftReport({
      composite: {
        score: 0.9,
        severity: 'critical',
        weights: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 },
      },
    });
    const onDrift = vi.fn();
    const fired = dispatchAlert(report, onDrift, 'medium', {});
    expect(fired).toBe(true);
    expect(onDrift).toHaveBeenCalledOnce();
    expect(onDrift).toHaveBeenCalledWith(report);
  });

  it('does NOT call onDrift when alert does not fire', () => {
    const report = makeDriftReport({
      composite: {
        score: 0.05,
        severity: 'none',
        weights: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 },
      },
    });
    const onDrift = vi.fn();
    const fired = dispatchAlert(report, onDrift, 'high', {});
    expect(fired).toBe(false);
    expect(onDrift).not.toHaveBeenCalled();
  });

  it('swallows async errors from onDrift', async () => {
    const report = makeDriftReport({
      composite: {
        score: 0.9,
        severity: 'critical',
        weights: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 },
      },
    });
    const onDrift = vi.fn(() => Promise.reject(new Error('boom')));
    // Should not throw
    expect(() => dispatchAlert(report, onDrift, 'low', {})).not.toThrow();
    expect(onDrift).toHaveBeenCalledOnce();
  });
});
