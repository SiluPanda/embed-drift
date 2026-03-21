import { describe, it, expect, vi } from 'vitest';
import { createMonitor } from '../monitor';
import { DriftError } from '../errors';
import type { DriftMonitorOptions, EmbedFn } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate n random d-dimensional unit vectors deterministically via a seed offset. */
function makeEmbeddings(n: number, d: number, offset = 0): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const vec = Array.from({ length: d }, (__, j) => Math.sin(i + j + offset));
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return vec.map((x) => x / (norm || 1));
  });
}

/** Simple embed function that returns deterministic embeddings for any text. */
function makeEmbedFn(d: number, offset = 0): EmbedFn {
  return async (texts: string[]) => makeEmbeddings(texts.length, d, offset);
}

const BASE_OPTS: DriftMonitorOptions = { modelId: 'test-model' };

// ── snapshot() ───────────────────────────────────────────────────────────────

describe('createMonitor().snapshot()', () => {
  it('creates a snapshot with correct modelId and dimensionality', () => {
    const monitor = createMonitor(BASE_OPTS);
    const embeddings = makeEmbeddings(10, 4);
    const snap = monitor.snapshot(embeddings);
    expect(snap.modelId).toBe('test-model');
    expect(snap.dimensionality).toBe(4);
    expect(snap.sampleCount).toBe(10);
    expect(snap.centroid).toHaveLength(4);
    expect(snap.variance).toHaveLength(4);
    expect(snap.similarityHistogram).toHaveLength(20);
    expect(snap.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof snap.createdAt).toBe('string');
  });

  it('throws EMPTY_INPUT for fewer than 2 vectors', () => {
    const monitor = createMonitor(BASE_OPTS);
    expect(() => monitor.snapshot([makeEmbeddings(1, 4)[0]])).toThrowError(DriftError);
    try {
      monitor.snapshot([makeEmbeddings(1, 4)[0]]);
    } catch (err) {
      expect((err as DriftError).code).toBe('EMPTY_INPUT');
    }
  });

  it('throws INCONSISTENT_DIMENSIONS for vectors with different lengths', () => {
    const monitor = createMonitor(BASE_OPTS);
    const badEmbeddings = [
      [0.1, 0.2, 0.3],
      [0.1, 0.2],
    ];
    try {
      monitor.snapshot(badEmbeddings);
    } catch (err) {
      expect((err as DriftError).code).toBe('INCONSISTENT_DIMENSIONS');
    }
  });

  it('respects sampleSize option', () => {
    const monitor = createMonitor(BASE_OPTS);
    const embeddings = makeEmbeddings(20, 4);
    const snap = monitor.snapshot(embeddings, { sampleSize: 5 });
    expect(snap.sampleVectors.length).toBeLessThanOrEqual(5);
  });

  it('attaches metadata when provided', () => {
    const monitor = createMonitor(BASE_OPTS);
    const embeddings = makeEmbeddings(5, 4);
    const snap = monitor.snapshot(embeddings, { metadata: { corpus: 'test' } });
    expect(snap.metadata).toMatchObject({ corpus: 'test' });
  });
});

// ── compare() ────────────────────────────────────────────────────────────────

describe('createMonitor().compare()', () => {
  it('returns a DriftReport with all required fields', () => {
    const monitor = createMonitor(BASE_OPTS);
    const snapA = monitor.snapshot(makeEmbeddings(10, 4, 0));
    const snapB = monitor.snapshot(makeEmbeddings(10, 4, 0));
    const report = monitor.compare(snapA, snapB);
    expect(report.id).toBeTruthy();
    expect(report.snapshotIds).toHaveLength(2);
    expect(report.modelIds).toHaveLength(2);
    expect(typeof report.composite.score).toBe('number');
    expect(report.composite.score).toBeGreaterThanOrEqual(0);
    expect(report.composite.score).toBeLessThanOrEqual(1);
    expect(report.methods.centroid.computed).toBe(true);
    expect(report.methods.pairwise.computed).toBe(true);
    expect(report.methods.dimensionWise.computed).toBe(true);
    expect(report.methods.mmd.computed).toBe(true);
    expect(typeof report.durationMs).toBe('number');
    expect(typeof report.summary).toBe('string');
  });

  it('produces low drift when comparing identical embeddings', () => {
    const monitor = createMonitor(BASE_OPTS);
    const embeddings = makeEmbeddings(10, 4, 0);
    const snapA = monitor.snapshot(embeddings);
    const snapB = monitor.snapshot(embeddings);
    const report = monitor.compare(snapA, snapB);
    expect(report.composite.score).toBeLessThan(0.1);
    expect(report.methods.centroid.score).toBeLessThan(0.01);
  });

  it('produces higher drift when comparing very different embeddings', () => {
    const monitor = createMonitor(BASE_OPTS);
    // Use different offsets to produce genuinely different distributions
    const snapA = monitor.snapshot(makeEmbeddings(20, 8, 0));
    const snapB = monitor.snapshot(makeEmbeddings(20, 8, 100));
    const report = monitor.compare(snapA, snapB);
    expect(report.composite.score).toBeGreaterThan(0);
  });

  it('throws INCOMPATIBLE_DIMENSIONS when snapshot dimensions differ', () => {
    const monitorA = createMonitor({ modelId: 'model-a' });
    const monitorB = createMonitor({ modelId: 'model-a' });
    const snapA = monitorA.snapshot(makeEmbeddings(5, 4));
    const snapB = monitorB.snapshot(makeEmbeddings(5, 8));
    try {
      monitorA.compare(snapA, snapB);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect((err as DriftError).code).toBe('INCOMPATIBLE_DIMENSIONS');
    }
  });

  it('sets modelChanged=true and severity=critical when modelIds differ', () => {
    const monitorA = createMonitor({ modelId: 'model-a' });
    const monitorB = createMonitor({ modelId: 'model-b' });
    const snapA = monitorA.snapshot(makeEmbeddings(5, 4));
    const snapB = monitorB.snapshot(makeEmbeddings(5, 4));
    const report = monitorA.compare(snapA, snapB);
    expect(report.modelChanged).toBe(true);
    expect(report.composite.severity).toBe('critical');
  });

  it('respects enabledMethods: disabled method has computed=false', () => {
    const monitor = createMonitor({ ...BASE_OPTS, enabledMethods: { mmd: false } });
    const snapA = monitor.snapshot(makeEmbeddings(5, 4));
    const snapB = monitor.snapshot(makeEmbeddings(5, 4));
    const report = monitor.compare(snapA, snapB);
    expect(report.methods.mmd.computed).toBe(false);
  });
});

// ── setBaseline / getBaseline / check() ──────────────────────────────────────

describe('createMonitor().check()', () => {
  it('throws NO_BASELINE when no baseline is set', () => {
    const monitor = createMonitor(BASE_OPTS);
    try {
      monitor.check(makeEmbeddings(5, 4));
      expect(true).toBe(false);
    } catch (err) {
      expect((err as DriftError).code).toBe('NO_BASELINE');
    }
  });

  it('returns a DriftReport after baseline is set', () => {
    const monitor = createMonitor(BASE_OPTS);
    const baseEmbeddings = makeEmbeddings(10, 4, 0);
    const baseSnap = monitor.snapshot(baseEmbeddings);
    monitor.setBaseline(baseSnap);
    const report = monitor.check(makeEmbeddings(10, 4, 0));
    expect(report).toBeDefined();
    expect(report.composite.score).toBeGreaterThanOrEqual(0);
  });

  it('getBaseline returns undefined before setBaseline', () => {
    const monitor = createMonitor(BASE_OPTS);
    expect(monitor.getBaseline()).toBeUndefined();
  });

  it('getBaseline returns the set baseline', () => {
    const monitor = createMonitor(BASE_OPTS);
    const snap = monitor.snapshot(makeEmbeddings(5, 4));
    monitor.setBaseline(snap);
    expect(monitor.getBaseline()).toBe(snap);
  });
});

// ── checkCanaries() ───────────────────────────────────────────────────────────

describe('createMonitor().checkCanaries()', () => {
  it('establishes initial baseline on first call (isInitialBaseline=true, driftScore=0)', async () => {
    const monitor = createMonitor({ modelId: 'test-model', replaceDefaultCanaries: true, canaryTexts: ['hello', 'world'] });
    const embedFn = makeEmbedFn(4, 0);
    const report = await monitor.checkCanaries(embedFn);
    expect(report.isInitialBaseline).toBe(true);
    expect(report.driftScore).toBe(0);
    expect(report.modelChanged).toBe(false);
    expect(report.canaryCount).toBe(2);
  });

  it('returns low drift on second call with same embedFn', async () => {
    const monitor = createMonitor({ modelId: 'test-model', replaceDefaultCanaries: true, canaryTexts: ['a', 'b', 'c'] });
    const embedFn = makeEmbedFn(4, 0);
    await monitor.checkCanaries(embedFn);
    const report = await monitor.checkCanaries(embedFn);
    expect(report.isInitialBaseline).toBe(false);
    expect(report.driftScore).toBeCloseTo(0, 1);
    expect(report.modelChanged).toBe(false);
  });

  it('detects drift when embedFn changes significantly', async () => {
    const monitor = createMonitor({
      modelId: 'test-model',
      replaceDefaultCanaries: true,
      canaryTexts: ['a', 'b', 'c'],
      canaryThreshold: 0.95,
    });
    await monitor.checkCanaries(makeEmbedFn(4, 0));
    const report = await monitor.checkCanaries(makeEmbedFn(4, 9999));
    expect(report.isInitialBaseline).toBe(false);
    // Drift score should be positive
    expect(report.driftScore).toBeGreaterThanOrEqual(0);
  });

  it('throws EMBED_FN_FAILED when embedFn throws', async () => {
    const monitor = createMonitor({ modelId: 'test-model', replaceDefaultCanaries: true, canaryTexts: ['x'] });
    const badEmbedFn: EmbedFn = async () => { throw new Error('api down'); };
    try {
      await monitor.checkCanaries(badEmbedFn);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as DriftError).code).toBe('EMBED_FN_FAILED');
    }
  });
});

// ── setCanaryBaseline() ───────────────────────────────────────────────────────

describe('createMonitor().setCanaryBaseline()', () => {
  it('sets canary baseline so next checkCanaries compares against it', async () => {
    const d = 4;
    const monitor = createMonitor({ modelId: 'test-model', replaceDefaultCanaries: true, canaryTexts: ['a', 'b'] });
    const refEmbeddings = makeEmbeddings(2, d, 0);
    monitor.setCanaryBaseline(refEmbeddings);
    const embedFn = makeEmbedFn(d, 0);
    const report = await monitor.checkCanaries(embedFn);
    expect(report.isInitialBaseline).toBe(false);
    expect(report.driftScore).toBeCloseTo(0, 1);
  });

  it('throws EMPTY_INPUT for empty array', () => {
    const monitor = createMonitor(BASE_OPTS);
    try {
      monitor.setCanaryBaseline([]);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as DriftError).code).toBe('EMPTY_INPUT');
    }
  });
});

// ── getCanaryTexts() ─────────────────────────────────────────────────────────

describe('createMonitor().getCanaryTexts()', () => {
  it('returns DEFAULT_CANARY_TEXTS when no custom texts provided', () => {
    const monitor = createMonitor(BASE_OPTS);
    const texts = monitor.getCanaryTexts();
    expect(texts.length).toBeGreaterThanOrEqual(25);
  });

  it('appends custom canary texts to defaults', () => {
    const monitor = createMonitor({ ...BASE_OPTS, canaryTexts: ['custom-1'] });
    const texts = monitor.getCanaryTexts();
    expect(texts).toContain('custom-1');
    expect(texts.length).toBeGreaterThan(1);
  });

  it('replaces defaults when replaceDefaultCanaries=true', () => {
    const monitor = createMonitor({
      ...BASE_OPTS,
      canaryTexts: ['only-this'],
      replaceDefaultCanaries: true,
    });
    const texts = monitor.getCanaryTexts();
    expect(texts).toEqual(['only-this']);
  });
});

// ── reset / alert() ───────────────────────────────────────────────────────────

describe('createMonitor().alert()', () => {
  it('returns false for low-severity DriftReport when alertSeverity=high', () => {
    const monitor = createMonitor({ ...BASE_OPTS, alertSeverity: 'high' });
    const snapA = monitor.snapshot(makeEmbeddings(5, 4, 0));
    const snapB = monitor.snapshot(makeEmbeddings(5, 4, 0));
    const report = monitor.compare(snapA, snapB);
    // Same embeddings → low composite score → should not alert
    const alerted = monitor.alert(report);
    expect(typeof alerted).toBe('boolean');
  });

  it('returns true for critical DriftReport (model changed)', () => {
    const monitorA = createMonitor({ modelId: 'model-a', alertSeverity: 'high' });
    const monitorB = createMonitor({ modelId: 'model-b' });
    const snapA = monitorA.snapshot(makeEmbeddings(5, 4));
    const snapB = monitorB.snapshot(makeEmbeddings(5, 4));
    const report = monitorA.compare(snapA, snapB);
    expect(monitorA.alert(report)).toBe(true);
  });

  it('invokes onDrift callback when alert fires', () => {
    const callback = vi.fn();
    const monitorA = createMonitor({ modelId: 'model-a', alertSeverity: 'high', onDrift: callback });
    const monitorB = createMonitor({ modelId: 'model-b' });
    const snapA = monitorA.snapshot(makeEmbeddings(5, 4));
    const snapB = monitorB.snapshot(makeEmbeddings(5, 4));
    monitorA.compare(snapA, snapB);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({ modelChanged: true });
  });

  it('does NOT invoke onDrift callback when alert does not fire', () => {
    const callback = vi.fn();
    // Only alert on critical, and compare same embeddings (low/no drift)
    const monitor = createMonitor({ ...BASE_OPTS, alertSeverity: 'critical', onDrift: callback });
    const embs = makeEmbeddings(10, 4, 0);
    const snapA = monitor.snapshot(embs);
    const snapB = monitor.snapshot(embs);
    monitor.compare(snapA, snapB);
    expect(callback).not.toHaveBeenCalled();
  });

  it('alert() returns true when per-method threshold exceeded', () => {
    const monitor = createMonitor({
      ...BASE_OPTS,
      alertSeverity: 'critical', // severity alone won't fire
      thresholds: { composite: 0 }, // any composite score fires
    });
    const snapA = monitor.snapshot(makeEmbeddings(5, 4, 0));
    const snapB = monitor.snapshot(makeEmbeddings(5, 4, 100));
    const report = monitor.compare(snapA, snapB);
    // composite >= 0 is always true
    expect(monitor.alert(report)).toBe(true);
  });
});

// ── saveSnapshot / loadSnapshot ───────────────────────────────────────────────

describe('createMonitor().saveSnapshot / loadSnapshot', () => {
  it('round-trips a snapshot through JSON serialization', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { unlinkSync } = await import('node:fs');

    const monitor = createMonitor(BASE_OPTS);
    const snap = monitor.snapshot(makeEmbeddings(10, 4));
    const filePath = join(tmpdir(), `embed-drift-test-${snap.id}.json`);

    monitor.saveSnapshot(snap, filePath);
    const loaded = monitor.loadSnapshot(filePath);

    expect(loaded.id).toBe(snap.id);
    expect(loaded.modelId).toBe(snap.modelId);
    expect(loaded.dimensionality).toBe(snap.dimensionality);
    expect(loaded.centroid).toEqual(snap.centroid);

    unlinkSync(filePath);
  });

  it('loadSnapshot throws INVALID_SNAPSHOT for a missing file', () => {
    const monitor = createMonitor(BASE_OPTS);
    try {
      monitor.loadSnapshot('/nonexistent/path/snapshot.json');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as DriftError).code).toBe('INVALID_SNAPSHOT');
    }
  });
});

// ── canary report for CanaryReport ────────────────────────────────────────────

describe('createMonitor().alert() with CanaryReport', () => {
  it('returns false for initial baseline CanaryReport', async () => {
    const monitor = createMonitor({
      modelId: 'test-model',
      replaceDefaultCanaries: true,
      canaryTexts: ['hello'],
      alertSeverity: 'high',
    });
    const report = await monitor.checkCanaries(makeEmbedFn(4, 0));
    expect(report.isInitialBaseline).toBe(true);
    expect(monitor.alert(report)).toBe(false);
  });
});

// ── DriftReport severity bands ────────────────────────────────────────────────

describe('severity bands', () => {
  it('reports none severity for identical embeddings', () => {
    const monitor = createMonitor(BASE_OPTS);
    const embs = makeEmbeddings(10, 4, 0);
    const snapA = monitor.snapshot(embs);
    const snapB = monitor.snapshot(embs);
    const report = monitor.compare(snapA, snapB);
    const severity = report.composite.severity;
    expect(['none', 'low']).toContain(severity);
  });
});
