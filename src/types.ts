import type { DriftError } from './errors';

// ── Embed Function ─────────────────────────────────────────────────────

/**
 * A function that embeds an array of texts and returns an array of vectors.
 * The returned array must have the same length and order as the input array.
 */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

// ── Drift Severity ─────────────────────────────────────────────────────

export type DriftSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

// ── Method Result ──────────────────────────────────────────────────────

export interface MethodResult {
  /** Drift score for this method, in [0, 1]. */
  score: number;

  /** Whether this method was run. False when method is disabled or data was unavailable. */
  computed: boolean;

  /** Human-readable interpretation of this method's result. */
  interpretation: string;

  /** Method-specific details. */
  details?: Record<string, unknown>;
}

// ── Thresholds ─────────────────────────────────────────────────────────

export interface MethodThresholds {
  composite: number;
  canary: number;
  centroid: number;
  pairwise: number;
  dimensionWise: number;
  mmd: number;
}

export interface MethodWeights {
  canary: number;
  centroid: number;
  pairwise: number;
  dimensionWise: number;
  mmd: number;
}

// ── Snapshot ───────────────────────────────────────────────────────────

export interface Snapshot {
  /** Unique identifier for this snapshot, UUID v4. */
  id: string;

  /** ISO 8601 timestamp of when this snapshot was created. */
  createdAt: string;

  /** The embedding model that produced these vectors. */
  modelId: string;

  /** The number of dimensions in each embedding vector. */
  dimensionality: number;

  /** The number of embeddings this snapshot was computed from. */
  sampleCount: number;

  /** Element-wise mean of all embedding vectors. Length: dimensionality. */
  centroid: number[];

  /** Per-dimension variance. Length: dimensionality. */
  variance: number[];

  /** Mean pairwise cosine similarity across randomly sampled pairs. */
  meanPairwiseSimilarity: number;

  /** Standard deviation of pairwise cosine similarities. */
  stdPairwiseSimilarity: number;

  /**
   * Histogram of pairwise cosine similarities.
   * 20 bins from -1.0 to 1.0, each bin stores the fraction of pairs in that range.
   */
  similarityHistogram: number[];

  /**
   * A random sample of the original embedding vectors.
   * Used for dimension-wise KS statistics and MMD computation.
   */
  sampleVectors: number[][];

  /**
   * Embeddings of canary texts under this snapshot's model.
   * Present when the monitor has canaryTexts configured.
   */
  canaryEmbeddings?: number[][];

  /** Caller-provided metadata. Passed through without modification. */
  metadata?: Record<string, unknown>;
}

// ── Snapshot Options ───────────────────────────────────────────────────

export interface SnapshotOptions {
  /** Number of vectors to store as sample for KS/MMD computation. Default: 50. */
  sampleSize?: number;

  /**
   * Whether to include canary embeddings in this snapshot.
   * Requires that embedFn is provided in these options or at monitor creation.
   * Default: false.
   */
  includeCanaries?: boolean;

  /** Embed function used to compute canary embeddings when includeCanaries is true. */
  embedFn?: EmbedFn;

  /** Maximum number of pairwise similarity pairs to sample. Default: 500. */
  pairwiseSamplePairs?: number;

  /** Caller-provided metadata to attach to the snapshot. Default: {}. */
  metadata?: Record<string, unknown>;
}

// ── Check Options ──────────────────────────────────────────────────────

export interface CheckOptions {
  /** Options for the new snapshot creation. */
  snapshotOptions?: SnapshotOptions;
}

// ── Drift Report ───────────────────────────────────────────────────────

export interface DriftReport {
  /** Unique identifier for this report, UUID v4. */
  id: string;

  /** ISO 8601 timestamp of when this report was generated. */
  createdAt: string;

  /** The two snapshot IDs being compared. */
  snapshotIds: [string, string];

  /** The model IDs of the two snapshots. */
  modelIds: [string, string];

  /** True if the model changed between the two snapshots. */
  modelChanged: boolean;

  /** Per-method drift results. */
  methods: {
    canary: MethodResult;
    centroid: MethodResult;
    pairwise: MethodResult;
    dimensionWise: MethodResult;
    mmd: MethodResult;
  };

  /** Composite drift score (weighted average of method scores), in [0, 1]. */
  composite: {
    score: number;
    severity: DriftSeverity;
    /** Method weights used in the composite calculation. */
    weights: MethodWeights;
  };

  /** True if this report triggered an alert (score >= threshold or severity >= alertSeverity). */
  alerted: boolean;

  /** Human-readable summary of the drift report. */
  summary: string;

  /** Time taken to compute this report, in milliseconds. */
  durationMs: number;
}

// ── Canary Report ──────────────────────────────────────────────────────

export interface CanaryReport {
  /** Unique identifier for this report, UUID v4. */
  id: string;

  /** ISO 8601 timestamp. */
  createdAt: string;

  /** The number of canary texts compared. */
  canaryCount: number;

  /** Mean cosine similarity between new and reference canary embeddings. */
  meanSimilarity: number;

  /** Minimum cosine similarity across all canary pairs. */
  minSimilarity: number;

  /** Per-canary cosine similarities, in canary corpus order. */
  perCanarySimilarities: number[];

  /** Drift score for this canary check (1 - meanSimilarity). */
  driftScore: number;

  /**
   * True if the model appears to have changed (meanSimilarity < canaryThreshold).
   * Always false if this is the initial baseline establishment.
   */
  modelChanged: boolean;

  /**
   * True if this call established the initial canary baseline rather than
   * comparing to an existing one. driftScore will be 0.
   */
  isInitialBaseline: boolean;

  /** True if this report triggered an alert. */
  alerted: boolean;

  /** The model ID configured on the monitor at the time of this check. */
  modelId: string;

  /** Time taken to embed canary texts and compute the report, in milliseconds. */
  durationMs: number;
}

// ── Monitor Options ────────────────────────────────────────────────────

export interface DriftMonitorOptions {
  /**
   * The embedding model identifier for new snapshots.
   * Required.
   */
  modelId: string;

  /**
   * Additional canary texts to use for model fingerprinting.
   * Default: [] (use only built-in canaries).
   */
  canaryTexts?: string[];

  /**
   * If true, replaces the built-in canary corpus with the provided canaryTexts entirely.
   * Default: false.
   */
  replaceDefaultCanaries?: boolean;

  /**
   * Cosine similarity threshold below which the canary check declares a model change.
   * Default: 0.95.
   */
  canaryThreshold?: number;

  /**
   * The drift severity level at which the onDrift callback is invoked.
   * Default: 'high'.
   */
  alertSeverity?: DriftSeverity;

  /**
   * Per-method score thresholds that trigger an alert independently of severity.
   * Default: {} (no per-method overrides; severity alone controls alerts).
   */
  thresholds?: Partial<MethodThresholds>;

  /**
   * Callback invoked when an alert fires.
   * Default: undefined (no callback).
   */
  onDrift?: (report: DriftReport | CanaryReport) => void | Promise<void>;

  /**
   * Method weights for composite drift score computation.
   * Default: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 }
   */
  methodWeights?: Partial<MethodWeights>;

  /**
   * Which drift detection methods to run in compare().
   * Default: all methods enabled.
   */
  enabledMethods?: {
    centroid?: boolean;
    pairwise?: boolean;
    dimensionWise?: boolean;
    mmd?: boolean;
  };

  /**
   * Number of random Fourier features for MMD approximation.
   * Default: 100.
   */
  mmdRandomFeatures?: number;

  /**
   * Number of random pairs to sample for pairwise similarity estimation.
   * Default: 500.
   */
  pairwiseSamplePairs?: number;
}

// ── DriftMonitor Interface ─────────────────────────────────────────────

export interface DriftMonitor {
  snapshot(embeddings: number[][], options?: SnapshotOptions): Snapshot;
  compare(snapshotA: Snapshot, snapshotB: Snapshot): DriftReport;
  setBaseline(snapshot: Snapshot): void;
  check(embeddings: number[][], options?: CheckOptions): DriftReport;
  checkCanaries(embedFn: EmbedFn): Promise<CanaryReport>;
  setCanaryBaseline(canaryEmbeddings: number[][]): void;
  alert(report: DriftReport | CanaryReport): boolean;
  saveSnapshot(snapshot: Snapshot, filePath: string): void;
  loadSnapshot(filePath: string): Snapshot;
  /** Returns the current baseline snapshot, or undefined if none is set. */
  getBaseline(): Snapshot | undefined;
  /** Returns the canary texts configured on this monitor (built-in + custom). */
  getCanaryTexts(): string[];
}

// Re-export DriftError type for convenience
export type { DriftError };
