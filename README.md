# embed-drift

Monitor embedding distribution shifts over time. Detect when your embedding model changes, degrades, or drifts by comparing statistical snapshots of embedding distributions.

## Installation

```bash
npm install embed-drift
```

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
console.log(report.composite.severity); // 'none' | 'low' | 'medium' | 'high' | 'critical'

// Detect silent model changes using canary texts
const canaryReport = await monitor.checkCanaries(embedFn);
if (canaryReport.modelChanged) {
  console.error('Embedding model has changed!');
}
```

## Available Exports

```ts
import {
  createMonitor,

  // Error class
  DriftError,

  // Constants
  DEFAULT_CANARY_TEXTS,
} from 'embed-drift';

// Types (import as type)
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

## API Reference

### `createMonitor(options: DriftMonitorOptions): DriftMonitor`

Creates a drift monitor instance. All drift detection state and configuration is encapsulated in the returned object.

**Options** (`DriftMonitorOptions`):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `modelId` | `string` | — | **Required.** The embedding model identifier. |
| `canaryTexts` | `string[]` | `[]` | Additional canary texts to append to (or replace) the built-in corpus. |
| `replaceDefaultCanaries` | `boolean` | `false` | If `true`, use only `canaryTexts` instead of built-in corpus + custom. |
| `canaryThreshold` | `number` | `0.95` | Mean cosine similarity below which `modelChanged` is declared. |
| `alertSeverity` | `DriftSeverity` | `'high'` | Minimum severity to fire the `onDrift` callback. |
| `thresholds` | `Partial<MethodThresholds>` | `{}` | Per-method score overrides that trigger an alert. |
| `onDrift` | `(report) => void \| Promise<void>` | — | Callback invoked when an alert fires. Async errors are swallowed. |
| `methodWeights` | `Partial<MethodWeights>` | see below | Weights for the composite drift score. |
| `enabledMethods` | `{centroid?,pairwise?,dimensionWise?,mmd?}` | all `true` | Disable specific drift methods. |
| `mmdRandomFeatures` | `number` | `100` | Number of random Fourier features for MMD approximation. |
| `pairwiseSamplePairs` | `number` | `500` | Number of random pairs sampled for pairwise similarity estimation. |

Default composite weights: `{ canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 }`.

---

### `monitor.snapshot(embeddings, options?): Snapshot`

Computes a statistical snapshot of the provided embedding vectors.

- `embeddings`: `number[][]` — at least 2 vectors of consistent dimensionality.
- `options.sampleSize`: number of vectors to store for KS/MMD (default: 50).
- `options.metadata`: caller-provided key-value metadata attached to the snapshot.

Throws `DriftError('EMPTY_INPUT')` if fewer than 2 vectors are given, `DriftError('INCONSISTENT_DIMENSIONS')` if vectors have different lengths.

---

### `monitor.compare(snapshotA, snapshotB): DriftReport`

Compares two snapshots and returns a `DriftReport` with per-method drift scores, a composite score, and severity classification.

Throws `DriftError('INCOMPATIBLE_DIMENSIONS')` if the two snapshots have different dimensionalities.

When `snapshotA.modelId !== snapshotB.modelId`, `report.modelChanged` is `true` and severity is `critical`.

---

### `monitor.setBaseline(snapshot): void`

Stores a snapshot as the baseline for subsequent `check()` calls.

---

### `monitor.getBaseline(): Snapshot | undefined`

Returns the currently stored baseline snapshot, or `undefined` if none is set.

---

### `monitor.check(embeddings, options?): DriftReport`

Creates a new snapshot from `embeddings` and compares it against the stored baseline. Throws `DriftError('NO_BASELINE')` if no baseline has been set.

---

### `monitor.checkCanaries(embedFn): Promise<CanaryReport>`

Embeds the configured canary texts using `embedFn` and compares against stored reference embeddings.

- On the **first call**, establishes the reference baseline: returns a `CanaryReport` with `isInitialBaseline: true` and `driftScore: 0`.
- On **subsequent calls**, computes per-canary cosine similarities and returns `modelChanged: true` when mean similarity falls below `canaryThreshold`.

Throws `DriftError('EMBED_FN_FAILED')` if `embedFn` throws.

---

### `monitor.setCanaryBaseline(canaryEmbeddings): void`

Explicitly sets the canary reference embeddings without calling `checkCanaries`. Useful for loading a persisted canary baseline.

---

### `monitor.getCanaryTexts(): string[]`

Returns the resolved canary text array (built-in + custom, or custom-only if `replaceDefaultCanaries: true`).

---

### `monitor.alert(report): boolean`

Evaluates a `DriftReport` or `CanaryReport` against configured thresholds and returns `true` if an alert should fire. Does **not** invoke `onDrift`.

---

### `monitor.saveSnapshot(snapshot, filePath): void`

Writes a snapshot as pretty-printed JSON to the given file path.

---

### `monitor.loadSnapshot(filePath): Snapshot`

Reads and validates a snapshot from a JSON file. Throws `DriftError('INVALID_SNAPSHOT')` if the file is missing, malformed, or fails schema validation.

## Drift Detection Methods

embed-drift uses five complementary methods to detect distribution shifts:

### Centroid Shift

Measures the cosine distance between the mean embedding vectors (centroids) of two snapshots. Detects global shifts in the embedding space.

### Cosine Similarity Distribution

Compares the distribution of pairwise cosine similarities between two snapshots. Captures changes in how embeddings are spread relative to each other, even when the centroid stays the same.

### Nearest Neighbor (Dimension-Wise Statistics)

Analyzes per-dimension statistics using Cohen's d effect size and KS-like statistics across sample vectors. Identifies which specific dimensions have shifted.

### Cluster Balance (MMD Approximation)

Uses Maximum Mean Discrepancy with random Fourier features to measure the distance between two embedding distributions in a kernel-induced feature space. Captures higher-order distributional differences.

### Canary Texts

Embeds a fixed corpus of diverse reference texts and compares their embeddings over time. Detects silent model changes (provider swaps, version updates) by monitoring whether the same inputs produce the same outputs.

## Error Handling

All errors thrown by embed-drift are instances of `DriftError` with a `code` property:

| Code | Description |
|------|-------------|
| `EMPTY_INPUT` | Embedding array is empty or has fewer than 2 vectors |
| `INCONSISTENT_DIMENSIONS` | Vectors in the input have different dimensionalities |
| `INCOMPATIBLE_DIMENSIONS` | Two snapshots have different dimensionalities |
| `NO_BASELINE` | `check()` called before `setBaseline()` |
| `INVALID_SNAPSHOT` | Loaded snapshot file is malformed or missing fields |
| `NO_CANARY_BASELINE` | Canary comparison attempted without a baseline |
| `EMBED_FN_FAILED` | The provided embedding function threw an error |

## License

MIT
