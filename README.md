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
  // Factory (not yet implemented)
  // createMonitor,

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
