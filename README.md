# embed-drift

Detect embedding model changes and distribution shifts before they silently degrade your retrieval quality.

[![npm version](https://img.shields.io/npm/v/embed-drift.svg)](https://www.npmjs.com/package/embed-drift)
[![license](https://img.shields.io/npm/l/embed-drift.svg)](https://github.com/SiluPanda/embed-drift/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/embed-drift.svg)](https://nodejs.org)

---

## Description

When an embedding model changes -- OpenAI's `text-embedding-ada-002` to `text-embedding-3-small`, a Cohere version bump, or any silent provider update -- the vectors already stored in your database become incompatible with newly produced vectors. Queries return wrong results. No error is thrown, no status code changes, no log line appears. The system looks healthy. The results are wrong.

`embed-drift` detects this failure before it reaches your users. It monitors embedding distributions over time through two complementary mechanisms:

**Canary-based detection** embeds a fixed set of reference texts, stores the resulting vectors, and later re-embeds the same texts to check whether the model has changed. This is cheap (embeds only 25 canary texts, not the entire corpus) and catches model changes on the very next check.

**Statistical snapshot comparison** captures the distribution of a sample of embedding vectors at time T -- centroid, per-dimension variance, pairwise similarity distribution, and more -- and compares that snapshot against a future sample. When the distributions have drifted beyond configurable thresholds, `embed-drift` computes a composite drift score, classifies severity, and fires alert callbacks.

Zero runtime dependencies. Pure TypeScript. All statistical computations are self-contained.

---

## Installation

```bash
npm install embed-drift
```

Requires Node.js 18 or later.

---

## Quick Start

```ts
import { createMonitor } from 'embed-drift';

// Create a drift monitor for your embedding model
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  alertSeverity: 'high',
  onDrift: (report) => {
    console.warn('Embedding drift detected:', report.summary);
  },
});

// Take a baseline snapshot from your current embeddings
const baseline = monitor.snapshot(baselineEmbeddings);
monitor.setBaseline(baseline);

// Later, check new embeddings against the baseline
const report = monitor.check(newEmbeddings);
console.log(report.composite.severity);
// 'none' | 'low' | 'medium' | 'high' | 'critical'

// Detect silent model changes using canary texts
const canaryReport = await monitor.checkCanaries(embedFn);
if (canaryReport.modelChanged) {
  console.error('Embedding model has changed!');
}
```

### Persisting Snapshots

```ts
// Save a snapshot to disk
monitor.saveSnapshot(baseline, './snapshots/baseline.json');

// Load it back later
const loaded = monitor.loadSnapshot('./snapshots/baseline.json');
monitor.setBaseline(loaded);
```

### CI/CD Gate

```ts
import { createMonitor } from 'embed-drift';

const monitor = createMonitor({ modelId: 'text-embedding-3-small' });
const baseline = monitor.loadSnapshot('./snapshots/production-baseline.json');
monitor.setBaseline(baseline);

const report = monitor.check(newEmbeddings);
if (report.composite.severity === 'high' || report.composite.severity === 'critical') {
  console.error('Drift too high -- block deployment until re-indexing is complete.');
  process.exit(1);
}
```

---

## Features

- **Canary-based model change detection** -- Embeds a fixed corpus of 25 diverse reference texts and compares their embeddings over time. Detects silent model swaps, version bumps, and provider changes within a single check cycle.

- **Five complementary drift detection methods** -- Centroid shift, pairwise cosine similarity distribution, dimension-wise statistics (Cohen's d + KS-like statistic), Maximum Mean Discrepancy (MMD) approximation with random Fourier features, and canary comparison. Each method produces a normalized score in [0, 1].

- **Composite drift scoring** -- Weighted average of all method scores with configurable per-method weights. Automatic weight renormalization when methods are disabled or data is unavailable.

- **Severity classification** -- Composite scores are classified into five actionable bands: `none`, `low`, `medium`, `high`, `critical`. Model changes always produce `critical` severity.

- **Configurable alerting** -- Set severity thresholds and per-method score thresholds. Register an `onDrift` callback to integrate with any monitoring system. Supports both synchronous and asynchronous callbacks.

- **Snapshot persistence** -- Save and load statistical snapshots as portable JSON files. Snapshots are compact (typically 10-900 KB depending on dimensionality and sample size) and work across processes, machines, and time.

- **Zero runtime dependencies** -- All statistical computations are self-contained TypeScript. No native modules, no WASM, no Python bridge.

- **Full TypeScript support** -- Complete type definitions for all exports. Strict mode compatible.

---

## API Reference

### Exports

```ts
import {
  createMonitor,
  DriftError,
  DEFAULT_CANARY_TEXTS,
} from 'embed-drift';

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
  DriftErrorCode,
} from 'embed-drift';
```

---

### `createMonitor(options: DriftMonitorOptions): DriftMonitor`

Creates a drift monitor instance. All drift detection state and configuration is encapsulated in the returned object.

**Options** (`DriftMonitorOptions`):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `modelId` | `string` | -- | **Required.** The embedding model identifier. |
| `canaryTexts` | `string[]` | `[]` | Additional canary texts to append to the built-in corpus. |
| `replaceDefaultCanaries` | `boolean` | `false` | If `true`, use only `canaryTexts` instead of built-in corpus + custom. |
| `canaryThreshold` | `number` | `0.95` | Mean cosine similarity below which `modelChanged` is declared. |
| `alertSeverity` | `DriftSeverity` | `'high'` | Minimum severity to fire the `onDrift` callback. |
| `thresholds` | `Partial<MethodThresholds>` | `{}` | Per-method score overrides that trigger an alert. |
| `onDrift` | `(report) => void \| Promise<void>` | `undefined` | Callback invoked when an alert fires. Async errors are swallowed. |
| `methodWeights` | `Partial<MethodWeights>` | see below | Weights for the composite drift score. |
| `enabledMethods` | `{ centroid?, pairwise?, dimensionWise?, mmd? }` | all `true` | Disable specific drift methods. |
| `mmdRandomFeatures` | `number` | `100` | Number of random Fourier features for MMD approximation. |
| `pairwiseSamplePairs` | `number` | `500` | Number of random pairs sampled for pairwise similarity estimation. |

Default composite weights:

```ts
{ canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 }
```

---

### `monitor.snapshot(embeddings, options?): Snapshot`

Computes a statistical snapshot of the provided embedding vectors.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `embeddings` | `number[][]` | At least 2 vectors of consistent dimensionality. |
| `options.sampleSize` | `number` | Number of vectors to store for KS/MMD computation. Default: `50`. |
| `options.metadata` | `Record<string, unknown>` | Caller-provided key-value metadata attached to the snapshot. |

**Returns:** A `Snapshot` object containing the model ID, centroid, per-dimension variance, pairwise similarity statistics, a 20-bin similarity histogram, and a random sample of vectors.

**Throws:**

- `DriftError('EMPTY_INPUT')` if fewer than 2 vectors are given.
- `DriftError('INCONSISTENT_DIMENSIONS')` if vectors have different lengths.

---

### `monitor.compare(snapshotA, snapshotB): DriftReport`

Compares two snapshots and returns a `DriftReport` with per-method drift scores, a composite score, and severity classification.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `snapshotA` | `Snapshot` | The reference (baseline) snapshot. |
| `snapshotB` | `Snapshot` | The new snapshot to compare against the baseline. |

**Returns:** A `DriftReport` with all per-method results, composite score, severity, alert status, and a human-readable summary.

**Throws:**

- `DriftError('INCOMPATIBLE_DIMENSIONS')` if the two snapshots have different dimensionalities.

When `snapshotA.modelId !== snapshotB.modelId`, the report sets `modelChanged: true` and severity to `critical`.

---

### `monitor.setBaseline(snapshot): void`

Stores a snapshot as the baseline for subsequent `check()` calls.

---

### `monitor.getBaseline(): Snapshot | undefined`

Returns the currently stored baseline snapshot, or `undefined` if none is set.

---

### `monitor.check(embeddings, options?): DriftReport`

Creates a new snapshot from `embeddings` and compares it against the stored baseline.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `embeddings` | `number[][]` | New embedding vectors to compare against the baseline. |
| `options.snapshotOptions` | `SnapshotOptions` | Options forwarded to snapshot creation. |

**Returns:** A `DriftReport`.

**Throws:**

- `DriftError('NO_BASELINE')` if no baseline has been set via `setBaseline()`.

---

### `monitor.checkCanaries(embedFn): Promise<CanaryReport>`

Embeds the configured canary texts using `embedFn` and compares against stored reference embeddings.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `embedFn` | `(texts: string[]) => Promise<number[][]>` | A function that embeds an array of texts and returns vectors. |

**Behavior:**

- On the **first call**, establishes the reference baseline. Returns a `CanaryReport` with `isInitialBaseline: true` and `driftScore: 0`.
- On **subsequent calls**, computes per-canary cosine similarities and returns `modelChanged: true` when the mean similarity falls below `canaryThreshold`.

**Returns:** A `CanaryReport`.

**Throws:**

- `DriftError('EMBED_FN_FAILED')` if `embedFn` throws.

---

### `monitor.setCanaryBaseline(canaryEmbeddings): void`

Explicitly sets the canary reference embeddings without calling `checkCanaries`. Useful for loading a persisted canary baseline.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `canaryEmbeddings` | `number[][]` | Pre-computed canary embeddings (one per canary text). |

**Throws:**

- `DriftError('EMPTY_INPUT')` if the array is empty.

---

### `monitor.getCanaryTexts(): string[]`

Returns the resolved canary text array (built-in + custom, or custom-only if `replaceDefaultCanaries: true`).

---

### `monitor.alert(report): boolean`

Evaluates a `DriftReport` or `CanaryReport` against configured thresholds and returns `true` if an alert should fire. Does **not** invoke the `onDrift` callback.

An alert fires if:
- The report severity meets or exceeds `alertSeverity`, OR
- Any per-method score exceeds its configured threshold in `thresholds`.

---

### `monitor.saveSnapshot(snapshot, filePath): void`

Writes a snapshot as pretty-printed JSON to the given file path.

---

### `monitor.loadSnapshot(filePath): Snapshot`

Reads and validates a snapshot from a JSON file. Validates all required fields and dimensional consistency.

**Throws:**

- `DriftError('INVALID_SNAPSHOT')` if the file is missing, not valid JSON, or fails schema validation.

---

### `DriftError`

Custom error class extending `Error` with a `code` property for programmatic error handling.

```ts
import { DriftError } from 'embed-drift';

try {
  monitor.check(embeddings);
} catch (err) {
  if (err instanceof DriftError) {
    console.error(`Drift error [${err.code}]: ${err.message}`);
  }
}
```

---

### `DEFAULT_CANARY_TEXTS`

A frozen array of 25 diverse English reference texts spanning technical documentation, scientific language, legal text, casual conversation, news, medical, creative writing, mathematical, instructional, and philosophical domains. Used as the default canary corpus for model fingerprinting.

```ts
import { DEFAULT_CANARY_TEXTS } from 'embed-drift';
console.log(DEFAULT_CANARY_TEXTS.length); // 25
```

---

## Configuration

### Composite Weights

The composite drift score is a weighted average of per-method scores. Weights are renormalized when methods are disabled or their data is unavailable.

```ts
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  methodWeights: {
    canary: 0.40,       // Increase canary influence
    centroid: 0.10,
    pairwise: 0.20,
    dimensionWise: 0.15,
    mmd: 0.15,
  },
});
```

### Disabling Methods

Disable individual drift detection methods when they are not needed:

```ts
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  enabledMethods: {
    mmd: false,           // Skip MMD computation
    dimensionWise: false,  // Skip dimension-wise analysis
  },
});
```

Disabled methods report `computed: false` and score `0`. Their weights are redistributed to the remaining active methods.

### Alert Thresholds

Alerts fire when severity meets or exceeds `alertSeverity`, or when any per-method score exceeds its configured threshold:

```ts
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  alertSeverity: 'high',
  thresholds: {
    composite: 0.40,
    canary: 0.05,
    centroid: 0.30,
  },
  onDrift: (report) => {
    // Send to your monitoring system
    webhook.post('/alerts/embedding-drift', report);
  },
});
```

### Custom Canary Texts

Add domain-specific canary texts for increased sensitivity:

```ts
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  canaryTexts: [
    'The plaintiff alleges breach of fiduciary duty under Section 14(a).',
    'Amortization of goodwill is calculated on a straight-line basis.',
  ],
});
// Uses all 25 default canaries + 2 custom = 27 total

const monitorCustomOnly = createMonitor({
  modelId: 'text-embedding-3-small',
  canaryTexts: ['My custom canary text.'],
  replaceDefaultCanaries: true,
});
// Uses only the 1 custom canary text
```

---

## Drift Detection Methods

`embed-drift` implements five complementary methods. Each produces a normalized score in [0, 1].

### Centroid Shift

Measures the cosine distance between the mean embedding vectors (centroids) of two snapshots. Detects global shifts in the embedding space. Computational cost: O(n * d) where n is the sample size and d is the dimensionality.

### Pairwise Cosine Similarity Distribution

Compares the distribution of pairwise cosine similarities between two snapshots. Captures changes in how embeddings are spread relative to each other -- how compact or diffuse the distribution is -- even when the centroid stays the same.

### Dimension-Wise Statistics

Analyzes per-dimension statistics using Cohen's d effect size and KS-like statistics across sample vectors. The Cohen's d score identifies which specific dimensions have shifted, while the KS statistic captures distributional shape changes (bimodality, heavy tails) that mean and variance alone do not surface. The two scores are blended equally.

### MMD (Maximum Mean Discrepancy)

Uses Maximum Mean Discrepancy with random Fourier features (random kitchen sinks approximation) to measure the distance between two embedding distributions in a kernel-induced feature space. The RBF kernel bandwidth is set via the median heuristic. Sensitive to all moments of the distribution difference. Configurable via `mmdRandomFeatures` (default: 100).

### Canary Texts

Embeds a fixed corpus of diverse reference texts and compares their embeddings over time. Detects silent model changes (provider swaps, version updates) by monitoring whether the same inputs produce the same outputs. The primary and cheapest signal for model change detection.

---

## Severity Bands

| Composite Score | Severity | Recommended Action |
|----------------|----------|-------------------|
| 0.00 -- 0.05 | `none` | No action needed. Distribution is stable. |
| 0.05 -- 0.20 | `low` | Monitor. Normal content variation. |
| 0.20 -- 0.40 | `medium` | Investigate. Consider partial re-indexing. |
| 0.40 -- 0.70 | `high` | Re-embed recommended. Significant drift detected. |
| 0.70 -- 1.00 | `critical` | Re-embed immediately. |

A confirmed model change (different model IDs or canary mean similarity below threshold) always produces `critical` severity regardless of the composite score.

---

## Error Handling

All errors thrown by `embed-drift` are instances of `DriftError` with a `code` property for programmatic handling:

| Code | When It Is Thrown |
|------|-------------------|
| `EMPTY_INPUT` | Embedding array has fewer than 2 vectors, or `setCanaryBaseline` receives an empty array. |
| `INCONSISTENT_DIMENSIONS` | Vectors in the input array have different dimensionalities. |
| `INCOMPATIBLE_DIMENSIONS` | Two snapshots being compared have different dimensionalities. |
| `NO_BASELINE` | `check()` called before `setBaseline()`. |
| `INVALID_SNAPSHOT` | Loaded snapshot file is missing, not valid JSON, or fails schema validation. |
| `NO_CANARY_BASELINE` | Canary comparison attempted without a reference baseline. |
| `EMBED_FN_FAILED` | The embedding function passed to `checkCanaries()` threw an error. |

```ts
import { DriftError } from 'embed-drift';

try {
  const report = monitor.check(newEmbeddings);
} catch (err) {
  if (err instanceof DriftError) {
    switch (err.code) {
      case 'NO_BASELINE':
        console.error('Set a baseline before calling check().');
        break;
      case 'INCOMPATIBLE_DIMENSIONS':
        console.error('Snapshot dimensions do not match.');
        break;
      default:
        console.error(`Unexpected drift error: ${err.code}`);
    }
  }
}
```

---

## Advanced Usage

### Scheduled Monitoring

Run periodic drift checks as part of a cron job or background worker:

```ts
import { createMonitor } from 'embed-drift';

const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  alertSeverity: 'medium',
  onDrift: async (report) => {
    await sendSlackAlert(`Embedding drift detected: ${report.summary}`);
  },
});

// Load the production baseline
const baseline = monitor.loadSnapshot('./snapshots/production-baseline.json');
monitor.setBaseline(baseline);

// Sample current embeddings from your vector database
const currentSample = await sampleFromVectorDB(1000);

// Check for drift
const report = monitor.check(currentSample);
console.log(`Severity: ${report.composite.severity}, Score: ${report.composite.score}`);
```

### Canary-Based Model Monitoring

Detect model changes with minimal API cost:

```ts
import { createMonitor } from 'embed-drift';

const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  canaryThreshold: 0.95,
  onDrift: (report) => {
    if ('modelChanged' in report && report.modelChanged) {
      triggerReindexingPipeline();
    }
  },
});

// On first run, establishes the canary baseline
const embedFn = async (texts: string[]) => {
  return openai.embeddings.create({ model: 'text-embedding-3-small', input: texts })
    .then(res => res.data.map(d => d.embedding));
};

const report = await monitor.checkCanaries(embedFn);
if (report.isInitialBaseline) {
  console.log('Canary baseline established.');
} else if (report.modelChanged) {
  console.error('Model changed! Drift score:', report.driftScore);
} else {
  console.log('Model unchanged. Mean similarity:', report.meanSimilarity);
}
```

### Comparing Two Snapshots Directly

Compare snapshots without managing baseline state:

```ts
const monitor = createMonitor({ modelId: 'text-embedding-3-small' });

const snapshotA = monitor.loadSnapshot('./snapshots/2025-01-baseline.json');
const snapshotB = monitor.loadSnapshot('./snapshots/2025-03-current.json');

const report = monitor.compare(snapshotA, snapshotB);

console.log('Composite score:', report.composite.score);
console.log('Severity:', report.composite.severity);
console.log('Centroid drift:', report.methods.centroid.score);
console.log('Pairwise drift:', report.methods.pairwise.score);
console.log('MMD drift:', report.methods.mmd.score);
console.log('Summary:', report.summary);
```

### Pre-Computing Canary Baselines

Load a previously saved canary baseline to avoid re-establishing on every restart:

```ts
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  replaceDefaultCanaries: true,
  canaryTexts: ['My domain-specific canary text.'],
});

// Load saved canary embeddings
const savedCanaries = JSON.parse(readFileSync('./canary-baseline.json', 'utf-8'));
monitor.setCanaryBaseline(savedCanaries);

// Now checkCanaries compares against the loaded baseline
const report = await monitor.checkCanaries(embedFn);
```

---

## Types

All types are exported for use in TypeScript projects:

### `Snapshot`

```ts
interface Snapshot {
  id: string;                         // UUID v4
  createdAt: string;                  // ISO 8601 timestamp
  modelId: string;                    // Embedding model identifier
  dimensionality: number;             // Vector dimensions
  sampleCount: number;                // Number of input vectors
  centroid: number[];                 // Element-wise mean vector
  variance: number[];                 // Per-dimension variance
  meanPairwiseSimilarity: number;     // Mean cosine similarity across sampled pairs
  stdPairwiseSimilarity: number;      // Std dev of pairwise cosine similarities
  similarityHistogram: number[];      // 20-bin histogram from -1.0 to 1.0
  sampleVectors: number[][];          // Random sample of vectors for KS/MMD
  canaryEmbeddings?: number[][];      // Canary text embeddings (optional)
  metadata?: Record<string, unknown>; // Caller-provided metadata (optional)
}
```

### `DriftReport`

```ts
interface DriftReport {
  id: string;
  createdAt: string;
  snapshotIds: [string, string];
  modelIds: [string, string];
  modelChanged: boolean;
  methods: {
    canary: MethodResult;
    centroid: MethodResult;
    pairwise: MethodResult;
    dimensionWise: MethodResult;
    mmd: MethodResult;
  };
  composite: {
    score: number;           // Weighted average in [0, 1]
    severity: DriftSeverity; // 'none' | 'low' | 'medium' | 'high' | 'critical'
    weights: MethodWeights;  // Effective weights used
  };
  alerted: boolean;
  summary: string;
  durationMs: number;
}
```

### `CanaryReport`

```ts
interface CanaryReport {
  id: string;
  createdAt: string;
  canaryCount: number;
  meanSimilarity: number;
  minSimilarity: number;
  perCanarySimilarities: number[];
  driftScore: number;          // 1 - meanSimilarity
  modelChanged: boolean;
  isInitialBaseline: boolean;
  alerted: boolean;
  modelId: string;
  durationMs: number;
}
```

### `MethodResult`

```ts
interface MethodResult {
  score: number;                       // Drift score in [0, 1]
  computed: boolean;                   // Whether this method was run
  interpretation: string;              // Human-readable interpretation
  details?: Record<string, unknown>;   // Method-specific details
}
```

### `EmbedFn`

```ts
type EmbedFn = (texts: string[]) => Promise<number[][]>;
```

### `DriftSeverity`

```ts
type DriftSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
```

### `DriftErrorCode`

```ts
type DriftErrorCode =
  | 'EMPTY_INPUT'
  | 'INCONSISTENT_DIMENSIONS'
  | 'INCOMPATIBLE_DIMENSIONS'
  | 'NO_BASELINE'
  | 'INVALID_SNAPSHOT'
  | 'NO_CANARY_BASELINE'
  | 'EMBED_FN_FAILED';
```

---

## License

MIT
