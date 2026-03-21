import { describe, it, expect } from 'vitest';
import type {
  EmbedFn,
  DriftSeverity,
  MethodResult,
  MethodThresholds,
  MethodWeights,
  SnapshotOptions,
  CheckOptions,
  Snapshot,
  DriftReport,
  CanaryReport,
  DriftMonitorOptions,
  DriftMonitor,
} from '../types';

// ---------------------------------------------------------------------------
// EmbedFn
// ---------------------------------------------------------------------------

describe('EmbedFn', () => {
  it('is a callable returning Promise<number[][]>', async () => {
    const embedFn: EmbedFn = async (_texts: string[]) => [[0.1, 0.2]];
    const result = await embedFn(['hello']);
    expect(Array.isArray(result)).toBe(true);
    expect(Array.isArray(result[0])).toBe(true);
    expect(typeof result[0][0]).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// DriftSeverity
// ---------------------------------------------------------------------------

describe('DriftSeverity', () => {
  it('covers all 5 severity levels', () => {
    const severities: DriftSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];
    expect(severities).toHaveLength(5);
    expect(severities).toContain('none');
    expect(severities).toContain('low');
    expect(severities).toContain('medium');
    expect(severities).toContain('high');
    expect(severities).toContain('critical');
  });
});

// ---------------------------------------------------------------------------
// MethodResult
// ---------------------------------------------------------------------------

describe('MethodResult', () => {
  it('accepts a valid MethodResult object', () => {
    const result: MethodResult = {
      score: 0.42,
      computed: true,
      interpretation: 'moderate drift detected',
    };
    expect(result.score).toBe(0.42);
    expect(result.computed).toBe(true);
    expect(result.interpretation).toBe('moderate drift detected');
  });

  it('accepts optional details field', () => {
    const result: MethodResult = {
      score: 0.1,
      computed: true,
      interpretation: 'low drift',
      details: { rawValue: 0.1 },
    };
    expect(result.details).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DriftMonitorOptions — modelId required, rest optional
// ---------------------------------------------------------------------------

describe('DriftMonitorOptions', () => {
  it('requires modelId and allows optional fields', () => {
    const opts: DriftMonitorOptions = { modelId: 'openai/text-embedding-3-small' };
    expect(opts.modelId).toBe('openai/text-embedding-3-small');
    expect(opts.canaryTexts).toBeUndefined();
    expect(opts.canaryThreshold).toBeUndefined();
    expect(opts.alertSeverity).toBeUndefined();
    expect(opts.thresholds).toBeUndefined();
    expect(opts.onDrift).toBeUndefined();
    expect(opts.methodWeights).toBeUndefined();
    expect(opts.enabledMethods).toBeUndefined();
  });

  it('accepts all optional fields', () => {
    const opts: DriftMonitorOptions = {
      modelId: 'cohere/embed-english-v3.0',
      canaryTexts: ['hello world'],
      replaceDefaultCanaries: false,
      canaryThreshold: 0.95,
      alertSeverity: 'high',
      thresholds: { composite: 0.4 },
      onDrift: (_report) => { /* no-op */ },
      methodWeights: { canary: 0.35 },
      enabledMethods: { centroid: true, mmd: false },
      mmdRandomFeatures: 100,
      pairwiseSamplePairs: 500,
    };
    expect(opts.modelId).toBe('cohere/embed-english-v3.0');
    expect(opts.canaryThreshold).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// DriftReport
// ---------------------------------------------------------------------------

describe('DriftReport', () => {
  it('has all required fields', () => {
    const weights: MethodWeights = { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 };
    const methodResult: MethodResult = { score: 0.1, computed: true, interpretation: 'low' };
    const report: DriftReport = {
      id: 'uuid-report-1',
      createdAt: new Date().toISOString(),
      snapshotIds: ['snap-a', 'snap-b'],
      modelIds: ['model-a', 'model-b'],
      modelChanged: false,
      methods: {
        canary: methodResult,
        centroid: methodResult,
        pairwise: methodResult,
        dimensionWise: methodResult,
        mmd: methodResult,
      },
      composite: { score: 0.1, severity: 'low', weights },
      alerted: false,
      summary: 'No significant drift detected.',
      durationMs: 42,
    };
    // Per SPEC: field is modelChanged (not 'drifted')
    expect(report.modelChanged).toBe(false);
    expect(report.composite.score).toBe(0.1);
    expect(report.composite.severity).toBe('low');
    expect(report.methods.canary.score).toBe(0.1);
    expect(report.snapshotIds).toHaveLength(2);
    expect(report.modelIds).toHaveLength(2);
    expect(report.alerted).toBe(false);
    expect(typeof report.summary).toBe('string');
    expect(typeof report.durationMs).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// CanaryReport
// ---------------------------------------------------------------------------

describe('CanaryReport', () => {
  it('has all required fields', () => {
    const report: CanaryReport = {
      id: 'uuid-canary-1',
      createdAt: new Date().toISOString(),
      canaryCount: 25,
      meanSimilarity: 0.997,
      minSimilarity: 0.990,
      perCanarySimilarities: Array(25).fill(0.997),
      driftScore: 0.003,
      modelChanged: false,
      isInitialBaseline: false,
      alerted: false,
      modelId: 'openai/text-embedding-3-small',
      durationMs: 150,
    };
    // Per SPEC: field is modelChanged (not 'changed') and driftScore (not 'maxShift')
    expect(report.modelChanged).toBe(false);
    expect(report.driftScore).toBe(0.003);
    expect(report.meanSimilarity).toBe(0.997);
    expect(report.minSimilarity).toBe(0.990);
    expect(Array.isArray(report.perCanarySimilarities)).toBe(true);
    expect(report.isInitialBaseline).toBe(false);
    expect(report.canaryCount).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// DriftMonitor — interface can be implemented by a mock
// ---------------------------------------------------------------------------

describe('DriftMonitor', () => {
  it('can be fully implemented by a mock object', async () => {
    const mockSnapshot: Snapshot = {
      id: 'snap-1',
      createdAt: new Date().toISOString(),
      modelId: 'test-model',
      dimensionality: 3,
      sampleCount: 10,
      centroid: [0.1, 0.2, 0.3],
      variance: [0.01, 0.02, 0.03],
      meanPairwiseSimilarity: 0.8,
      stdPairwiseSimilarity: 0.05,
      similarityHistogram: Array(20).fill(0.05),
      sampleVectors: [[0.1, 0.2, 0.3]],
    };

    const mockMonitor: DriftMonitor = {
      snapshot: (_embeddings, _options?) => mockSnapshot,
      compare: (_a, _b) => ({} as DriftReport),
      setBaseline: (_snapshot) => { /* no-op */ },
      check: (_embeddings, _options?) => ({} as DriftReport),
      checkCanaries: async (_embedFn) => ({} as CanaryReport),
      setCanaryBaseline: (_embeddings) => { /* no-op */ },
      alert: (_report) => false,
      saveSnapshot: (_snapshot, _filePath) => { /* no-op */ },
      loadSnapshot: (_filePath) => mockSnapshot,
      getBaseline: () => undefined,
      getCanaryTexts: () => [],
    };

    expect(mockMonitor.snapshot([[0.1, 0.2, 0.3]])).toEqual(mockSnapshot);
    expect(mockMonitor.getBaseline()).toBeUndefined();
    expect(mockMonitor.getCanaryTexts()).toEqual([]);
    expect(mockMonitor.alert({} as DriftReport)).toBe(false);

    const canaryResult = await mockMonitor.checkCanaries(async (_texts) => [[0.1, 0.2, 0.3]]);
    expect(canaryResult).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

describe('Snapshot', () => {
  it('has all required fields', () => {
    const snap: Snapshot = {
      id: 'snap-uuid',
      createdAt: '2026-03-21T00:00:00.000Z',
      modelId: 'openai/text-embedding-3-small',
      dimensionality: 1536,
      sampleCount: 100,
      centroid: [0.1],
      variance: [0.01],
      meanPairwiseSimilarity: 0.75,
      stdPairwiseSimilarity: 0.10,
      similarityHistogram: Array(20).fill(0.05),
      sampleVectors: [[0.1]],
    };
    expect(snap.id).toBe('snap-uuid');
    expect(snap.modelId).toBe('openai/text-embedding-3-small');
    expect(snap.dimensionality).toBe(1536);
    expect(snap.canaryEmbeddings).toBeUndefined();
    expect(snap.metadata).toBeUndefined();
  });

  it('accepts optional canaryEmbeddings and metadata', () => {
    const snap: Snapshot = {
      id: 'snap-uuid-2',
      createdAt: '2026-03-21T00:00:00.000Z',
      modelId: 'test-model',
      dimensionality: 3,
      sampleCount: 5,
      centroid: [0.1, 0.2, 0.3],
      variance: [0.01, 0.02, 0.03],
      meanPairwiseSimilarity: 0.8,
      stdPairwiseSimilarity: 0.05,
      similarityHistogram: Array(20).fill(0.05),
      sampleVectors: [[0.1, 0.2, 0.3]],
      canaryEmbeddings: [[0.1, 0.2, 0.3]],
      metadata: { corpusName: 'test-corpus' },
    };
    expect(snap.canaryEmbeddings).toHaveLength(1);
    expect(snap.metadata?.corpusName).toBe('test-corpus');
  });
});

// ---------------------------------------------------------------------------
// SnapshotOptions and CheckOptions
// ---------------------------------------------------------------------------

describe('SnapshotOptions', () => {
  it('all fields are optional', () => {
    const opts: SnapshotOptions = {};
    expect(opts.sampleSize).toBeUndefined();
    expect(opts.includeCanaries).toBeUndefined();
    expect(opts.embedFn).toBeUndefined();
    expect(opts.metadata).toBeUndefined();
  });
});

describe('CheckOptions', () => {
  it('snapshotOptions is optional', () => {
    const opts: CheckOptions = {};
    expect(opts.snapshotOptions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MethodThresholds and MethodWeights
// ---------------------------------------------------------------------------

describe('MethodThresholds', () => {
  it('has all method keys', () => {
    const t: MethodThresholds = {
      composite: 0.4,
      canary: 0.05,
      centroid: 0.3,
      pairwise: 0.25,
      dimensionWise: 0.35,
      mmd: 0.3,
    };
    expect(t.composite).toBe(0.4);
    expect(t.dimensionWise).toBe(0.35);
  });
});

describe('MethodWeights', () => {
  it('has all method keys', () => {
    const w: MethodWeights = {
      canary: 0.35,
      centroid: 0.15,
      pairwise: 0.20,
      dimensionWise: 0.15,
      mmd: 0.15,
    };
    const total = w.canary + w.centroid + w.pairwise + w.dimensionWise + w.mmd;
    expect(total).toBeCloseTo(1.0);
  });
});
