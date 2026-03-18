# embed-drift -- Specification

## 1. Overview

`embed-drift` monitors embedding distribution shifts over time and alerts when a vector index needs to be re-embedded. It detects two distinct phenomena that both manifest as silent retrieval quality degradation: **model drift** (the embedding model was updated or replaced, so existing index vectors and new query vectors come from different distributions) and **content drift** (the statistical properties of a corpus' embedding distribution have shifted, indicating the corpus now represents a meaningfully different population than when the index was last built).

The gap this package fills is specific, well-defined, and currently unfilled. When an embedding model changes -- OpenAI's `text-embedding-ada-002` to `text-embedding-3-small`, Cohere's `embed-english-v2.0` to `embed-english-v3.0`, or any model version bump -- the vectors already stored in your vector database become incompatible with vectors produced by the new model. A query embedded with `text-embedding-3-small` searched against an index built with `ada-002` returns garbage results: not an error, not a warning, just silently degraded retrieval. The geometric spaces are different. The numbers are meaningless when compared across models. There is no exception, no status code, no log line. The system appears to work. The results are wrong.

This is the hardest category of production bug to detect: the silent failure. Every RAG pipeline, every semantic search system, every embedding-based memory store is vulnerable. And today, in the npm ecosystem, there is no tool that addresses it. There are no packages that track which model produced an index, detect when the model has changed, compute statistical drift between old and new embedding distributions, or fire an alert before a model migration corrupts retrieval quality. Python has general-purpose data drift tools (Evidently AI, whylogs, NannyML) that operate on tabular feature distributions, but none of them are designed for the high-dimensional cosine-similarity geometry of embedding vectors, and none understand what an embedding model is or what a model change means. The npm ecosystem has nothing at all.

`embed-drift` provides a TypeScript/JavaScript library and a CLI for exactly this use case. It works through two complementary detection mechanisms:

**Canary-based detection** embeds a fixed set of reference texts (the "canary corpus") using the current model, stores the resulting vectors, and later re-embeds the same texts to check if the model has changed. If the re-embedded vectors differ significantly from the stored reference vectors, the model has changed. This is cheap (embeds only N canary texts, not the whole corpus), reliable (the texts are controlled), and catches model changes within the latency of the next canary check.

**Statistical snapshot comparison** captures the distribution of a sample of embedding vectors at time T -- their centroid, per-dimension variance, mean pairwise cosine similarity, and other statistics -- and compares that snapshot against the distribution at time T+1. If the distributions have drifted beyond configurable thresholds, `embed-drift` computes a drift score, classifies the severity, and fires configured alert callbacks.

Both mechanisms are composable: a production pipeline can maintain both a canary record (for fast model-change detection on every indexing run) and periodic full snapshots (for long-term content drift tracking).

`embed-drift` provides a programmatic TypeScript API and a CLI. The API returns structured `DriftReport` and `CanaryReport` objects with per-method drift scores, severity classifications, composite drift scores, and actionable alert flags. The CLI creates snapshots from JSON embedding files, compares two snapshots, re-runs canary checks, and writes reports as human-readable summaries or JSON.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createMonitor(options)` factory that returns a `DriftMonitor` instance encapsulating all drift detection state and configuration.
- Provide a `monitor.snapshot(embeddings, options?)` method that captures the statistical distribution of a set of embedding vectors as a `Snapshot` object.
- Provide a `monitor.compare(snapshotA, snapshotB)` method that computes a `DriftReport` quantifying the distribution shift between two snapshots, with per-method drift scores and a composite score.
- Provide a `monitor.check(newEmbeddings)` method that compares a new set of embeddings against the stored baseline snapshot, returning a `DriftReport` without requiring the caller to manage snapshots explicitly.
- Provide a `monitor.checkCanaries(embedFn)` method that re-embeds the configured canary texts using the provided embed function, compares the results to stored reference embeddings, and returns a `CanaryReport` indicating whether the model has changed.
- Provide a `monitor.alert(report)` method that returns `true` when a drift report crosses configured thresholds.
- Implement the full catalog of drift detection methods: canary comparison, centroid drift, pairwise similarity shift, dimension-wise statistics (mean, variance, KS-like statistic), and Maximum Mean Discrepancy (MMD) approximation.
- Compute a composite drift score in [0, 1] and classify severity into `none`, `low`, `medium`, `high`, `critical` bands.
- Support configurable thresholds per method and for the composite score.
- Support alerting via `onDrift` callback hooks, allowing integration with any monitoring system.
- Persist snapshots as portable JSON to any writable location: filesystem path or caller-managed string serialization.
- Provide a CLI (`embed-drift`) for snapshot creation, comparison, canary checking, and report printing.
- Integrate with `embed-cache` (detect when the cache is stale after model change), `embed-cluster` (detect cluster-level drift), and `model-price-registry` (log model metadata alongside snapshots).
- Zero mandatory runtime dependencies. All statistical computations are self-contained TypeScript. No native modules, no WASM, no Python bridge.
- Target Node.js 18 and above.

### Non-Goals

- **Not an embedding provider.** `embed-drift` does not call any embedding API. It operates on embedding vectors that the caller has already obtained, and accepts an `embedFn` for canary checking. Bring your own OpenAI client, Cohere client, or local model.
- **Not a vector database.** `embed-drift` does not store or index embedding vectors for similarity search. It stores snapshot statistics (centroid, variance, sample vectors) and canary reference embeddings -- compact summaries, not the full index. Use Pinecone, Weaviate, Qdrant, or Vectra for vector storage and retrieval.
- **Not a continuous monitoring daemon.** `embed-drift` performs point-in-time checks and returns. For continuous monitoring, wrap it in a cron job, scheduled worker, or background task that calls `monitor.check()` or `monitor.checkCanaries()` on a timer.
- **Not a general-purpose data drift framework.** `embed-drift` is designed specifically for embedding vector distributions with cosine-similarity geometry. It is not a tabular data drift tool and does not implement drift tests for scalar features, categorical variables, or non-embedding numeric distributions. Use Evidently AI or NannyML for tabular drift.
- **Not a retrieval quality evaluator.** `embed-drift` detects statistical distribution shifts. It does not measure retrieval precision, recall, NDCG, or MRR. Detecting that the distribution has shifted is a proxy signal for retrieval quality degradation -- it is not a direct measurement of it. Use `rag-eval-node-ts` for retrieval quality evaluation.
- **Not a model migration tool.** `embed-drift` detects that migration is needed and alerts. It does not automate the re-embedding process, coordinate the migration across shards, or manage the transition between old and new vectors. It answers the question "do we need to re-embed?" -- not "re-embed for us."
- **Not a statistical test suite.** The implemented drift metrics are chosen for practical utility in the embedding use case, not mathematical completeness. `embed-drift` implements approximations (e.g., bootstrapped MMD, dimension-wise summary statistics rather than full multivariate KS tests) calibrated for speed and interpretability in production pipelines.

---

## 3. Target Users and Use Cases

### RAG Pipeline Operators

Teams running Retrieval-Augmented Generation pipelines with an embedding model at the ingestion layer and a vector database for retrieval. The pipeline runs continuously or on a schedule: new documents are chunked, embedded, and indexed. When an embedding model is upgraded, all existing vectors in the index become incompatible. Without `embed-drift`, the operator learns about this problem from user complaints about degraded answers -- days or weeks after the model change. With `embed-drift`, a canary check runs on every indexing cycle and fires an alert the first time the model change is detected, before any degraded results reach users.

### Vector Index Administrators

Teams responsible for maintaining the health of a production vector database. The index was built at some point in the past and re-indexing is expensive (terabytes of text, hours of embedding API calls, significant cost). `embed-drift` enables a periodic "distribution health check": take a snapshot of a sample of current embeddings, compare to the baseline snapshot taken when the index was last built. If drift exceeds a threshold, schedule a re-indexing run before retrieval quality degrades further.

### AI Infrastructure Engineers

Engineers building internal embedding infrastructure that multiple teams depend on. They manage the embedding model version used by the infrastructure. When they update the model, downstream teams' vector databases all become stale simultaneously. `embed-drift` integrates with their deployment pipeline: a pre-deployment canary check confirms that the new model's embeddings are materially different from the current reference, gating the deployment with a human decision or automated re-indexing trigger.

### Production ML Platform Teams

Teams building MLOps tooling for AI applications. Data drift is a standard concern in supervised ML (training-serving skew, covariate shift), but embedding-based systems have not had purpose-built drift detection. `embed-drift` gives ML platform teams the same operational instrumentation for embedding-based systems that they have for traditional ML models: a drift score, severity classification, alert thresholds, and a historical trail of snapshots.

### CI/CD Pipeline Integrators

Development teams that want to gate deployments of new embedding models on a passing drift check. In their CI pipeline, before rolling out a new model: embed the canary corpus with both the old model and the new model, compare the embeddings with `embed-drift`, and fail the deployment if the drift score indicates the vectors are materially different -- requiring a re-indexing run before the deployment proceeds.

### Scheduled Monitoring Operators

Teams that run a nightly or weekly job to verify that their production embedding distribution has not drifted from the baseline. Even without a model change, the distribution of content being indexed can shift over time (new product lines, new customers, seasonal content variation). `embed-drift`'s snapshot comparison quantifies how much the content distribution has shifted, informing decisions about when to rebuild the index.

---

## 4. Core Concepts

### Embedding Distribution

An embedding distribution is the statistical population from which a set of embedding vectors is drawn. When you embed a corpus of documents, each document produces a vector. Across a large corpus, these vectors form a cloud in high-dimensional space with a characteristic shape: a centroid (the mean vector), a spread (the variance per dimension and the pairwise cosine similarity distribution), and a geometry (the cluster structure, the density profile).

Two sets of embeddings have the same distribution if they are drawn from the same statistical population -- same model, same type of content, same language. They have different distributions if either the model or the content population has changed substantially.

### Model Change and the Silent Failure

When an embedding model changes, the mapping from text to vector changes. The relationship is not a linear transformation, a rotation, or a simple scaling -- it is an entirely different function. A document that had vector A under the old model has vector B under the new model, where A and B may be far apart in cosine distance. Query vectors computed with the new model are not comparable to document vectors computed with the old model. Retrieval returns the wrong results.

This failure is silent because the system does not know it is comparing incompatible vectors. The vector database receives a query vector and performs its nearest-neighbor search, returning the geometrically nearest vectors -- which happen to be the wrong documents. The application receives results. The API returns 200. Only the results are wrong.

### Snapshot

A snapshot is a compact statistical summary of an embedding distribution, captured at a specific point in time. It is not a copy of all the vectors -- it is a set of statistics sufficient to detect distribution shifts when compared to a future snapshot.

A snapshot contains:
- **Model ID**: The embedding model that produced the vectors. The single most important piece of metadata -- if two snapshots have different model IDs, the comparison immediately flags a model change.
- **Timestamp**: ISO 8601 creation time.
- **Dimensionality**: The number of dimensions in each embedding vector.
- **Sample size**: The number of vectors this snapshot was computed from.
- **Centroid**: The mean vector across all sample embeddings. An n-dimensional float array.
- **Variance**: Per-dimension variance. An n-dimensional float array.
- **Mean pairwise cosine similarity**: The average cosine similarity between randomly sampled pairs from the set. A scalar.
- **Cosine similarity histogram**: A histogram of pairwise cosine similarities (e.g., 20 buckets from -1 to 1), representing the distribution shape.
- **Sample vectors**: A small random sample of actual embedding vectors (default: 50), stored for MMD computation and KS test approximation when comparing two snapshots.
- **Canary embeddings**: Optional. The embeddings of the configured canary texts under this snapshot's model.
- **Metadata**: Caller-provided key-value pairs (e.g., corpus name, index version, deployment ID).

Snapshots are serialized to JSON and are portable across processes, machines, and time.

### Canary Texts

Canary texts are a fixed set of reference sentences, chosen to be stable and diverse. They serve as a model fingerprint: embed the same texts with two different models (or the same model at two different times) and compare the resulting vectors. If the vectors are very different, the model has changed. If they are nearly identical, the model has not changed.

The term comes from the canary-in-a-coal-mine metaphor: the canaries detect a hazard (model change) before it causes broader harm (degraded retrieval).

Canary texts must be:
- **Stable**: The texts should never change. They are reference constants. A change in the canary text invalidates the comparison.
- **Diverse**: Texts from different domains (technical, conversational, scientific, formal, informal) ensure the canary corpus covers different parts of the semantic space. A model change that only affects one semantic domain will still be detected.
- **Representative**: Texts should be the kind of content the embedding model is typically applied to -- short-to-medium sentences in the model's primary language.

`embed-drift` ships with a built-in set of 25 English canary texts spanning technical documentation, casual conversation, scientific language, legal text, and creative writing. Callers can augment or replace this set with domain-specific texts.

### Drift Score

A drift score is a normalized measure of distribution shift in [0, 1]:
- **0.0**: No detectable drift. The two distributions are statistically indistinguishable by the methods tested.
- **1.0**: Complete drift. The distributions are as different as two random distributions would be expected to be under this metric.

Drift scores are computed per-method and combined into a composite drift score. The composite uses configurable method weights (default: equal weighting). Per-method scores allow operators to understand which aspect of the distribution has shifted most.

### Model Fingerprint

A model fingerprint is the set of canary embeddings produced by a specific model version. It is computed by embedding all canary texts with the model and storing the resulting vectors. The fingerprint is included in a snapshot and can be compared to a future fingerprint to determine whether the model has changed.

Two model fingerprints match if the mean cosine similarity between corresponding canary embeddings is above a threshold (default: 0.995 -- very high, because embeddings from the same model on the same text should be nearly identical). A mismatch below this threshold indicates the model has changed.

### Drift Severity

Drift severity classifies the composite drift score into actionable bands:

| Score | Severity | Recommended Action |
|---|---|---|
| 0.00 -- 0.05 | `none` | No action needed. Distribution is stable. |
| 0.05 -- 0.20 | `low` | Monitor. Normal content variation. No re-embedding needed. |
| 0.20 -- 0.40 | `medium` | Investigate. Content distribution has shifted. Consider partial re-indexing. |
| 0.40 -- 0.70 | `high` | Re-embed recommended. Significant drift detected. Schedule re-indexing. |
| 0.70 -- 1.00 | `critical` | Re-embed immediately. Model may have changed or corpus is fundamentally different. |

Model change (detected via canary check) always produces `critical` severity regardless of the composite statistical score, because a model change makes the existing index completely invalid.

### Alert

An alert is a notification that drift has exceeded a configured threshold. Alerts fire via callbacks registered on the `DriftMonitor`: `onDrift(report)` is called whenever `monitor.check()` or `monitor.checkCanaries()` produces a report whose severity meets or exceeds the configured `alertSeverity` threshold. The callback receives the full `DriftReport` or `CanaryReport` and can log, send a webhook, emit a metric, or trigger a re-indexing job.

---

## 5. Drift Detection Methods

`embed-drift` implements five drift detection methods. Each produces a normalized score in [0, 1]. They are complementary: some are cheap and good at model change detection, others are more expensive but better at detecting subtle content distribution shifts.

### Method 1: Canary-Based Detection

**Algorithm**: Embed a fixed set of reference texts ("canaries") with the current model. Store the resulting vectors as the reference fingerprint. Later, re-embed the same canary texts. Compute the mean cosine similarity between the new embeddings and the stored reference embeddings, corresponding text by text. If the mean cosine similarity is below the threshold (default: 0.995), declare a model change.

**Score computation**:
```
canary_similarity[i] = cosine_similarity(new_canary[i], reference_canary[i])
mean_canary_similarity = mean(canary_similarity)
canary_drift_score = 1 - mean_canary_similarity
```

A drift score of 0 means the model is identical. A drift score of 0.005 (mean similarity 0.995) is the `none/low` boundary. A drift score above 0.05 (mean similarity below 0.95) is very strong evidence that the model has changed.

**When to use**: Always. Canary checking is the primary, cheapest, and most reliable signal for model change detection. It should run on every pipeline execution where embedding is performed -- the cost is embedding N canary texts (typically 10-25), which is negligible.

**Computational cost**: O(N * d) where N is the number of canary texts and d is the embedding dimensionality. For N = 25 and d = 1536, this is 38,400 floating-point operations -- effectively instantaneous. The embedding API cost is N tokens (one batch call for all canaries).

**Sensitivity**: Very high for model changes. Near-zero false positive rate for unchanged models (embedding the same text with the same model produces the same vector, up to floating-point rounding). Not sensitive to content distribution drift (since canaries are fixed, not drawn from the corpus).

### Method 2: Centroid Drift

**Algorithm**: Compute the centroid (mean vector) of a sample of embedding vectors from set A and from set B. Compute the cosine distance between the two centroids.

**Score computation**:
```
centroid_A = mean(embeddings_A)   // element-wise mean
centroid_B = mean(embeddings_B)
centroid_drift_score = cosine_distance(centroid_A, centroid_B)
                     = 1 - cosine_similarity(centroid_A, centroid_B)
```

The centroid represents the "center of gravity" of the distribution. If the two corpora cover different topics (e.g., the reference was a legal document corpus and the new corpus includes medical texts), their centroids will be far apart. If the corpora are topically similar but the model has changed, the centroid direction in embedding space may differ even if the topics are the same.

**When to use**: Centroid drift is cheap to compute and easy to interpret. It is the first check after canary detection. High centroid drift indicates that the average semantic content has shifted significantly. Low centroid drift does not rule out more subtle distribution changes (a distribution can shift while keeping its mean approximately constant if different parts of the distribution shift in different directions).

**Computational cost**: O(n * d) where n is the sample size and d is the dimensionality. Linear in both sample size and dimensionality. For n = 1000 and d = 1536, this is 1.5 million operations per set -- fast.

**Sensitivity**: Good for large topical shifts and for model changes that produce different average embedding directions. Less sensitive to variance changes, tail shifts, and distributional changes that preserve the mean.

### Method 3: Pairwise Cosine Similarity Distribution Shift

**Algorithm**: Sample M pairs of embeddings from set A and M pairs from set B. Compute the cosine similarity for each pair. This produces two distributions of pairwise similarities. Compare the distributions by their mean and variance.

**Score computation**:
```
similarities_A = [cosine_sim(a_i, a_j) for M random pairs (i,j) from A]
similarities_B = [cosine_sim(b_i, b_j) for M random pairs (i,j) from B]

mean_diff = |mean(similarities_A) - mean(similarities_B)|
std_diff  = |std(similarities_A)  - std(similarities_B)|

pairwise_drift_score = normalize(mean_diff + 0.5 * std_diff)
```

Normalization maps the combined difference to [0, 1] using an empirically calibrated scale (a mean shift of 0.1 in cosine similarity corresponds to approximately 0.3 in drift score; a full shift of 0.2 saturates the score at 1.0).

The pairwise similarity distribution captures the "spread" of the distribution: how similar are embeddings to each other on average? A tightly clustered corpus (high mean pairwise similarity) will produce a narrow distribution centered near 1. A diverse corpus (low mean pairwise similarity) will produce a broader distribution centered lower. A model change often shifts both the mean and variance of this distribution significantly.

**When to use**: Pairwise similarity shift is especially good at detecting changes in the "shape" of the distribution -- how compact or diffuse it is. It catches model changes that centroid drift might miss (if the new model happens to produce centroids in the same direction, but with different spread). It is also the primary signal for content distribution drift: if new content is more (or less) homogeneous than old content, this score will reflect it.

**Computational cost**: O(M * d) for M sampled pairs. M defaults to 500. For d = 1536, this is 768,000 operations per set -- fast. M can be tuned up for higher statistical power at the cost of more computation.

**Sensitivity**: Moderate to high. The sample size M controls the statistical precision of the comparison. For M = 500, the standard error of the estimated mean is approximately `std / sqrt(M) ≈ 0.01`, meaning shifts in mean pairwise similarity of 0.02 or larger are reliably detected. For subtle content drift (mean shift < 0.01), M > 2000 may be needed for reliable detection.

### Method 4: Dimension-Wise Statistics

**Algorithm**: For each embedding dimension d_i (i = 1..D):
1. Compute `mean_A[i]` and `mean_B[i]`, the per-dimension means in sets A and B.
2. Compute `var_A[i]` and `var_B[i]`, the per-dimension variances in sets A and B.
3. Compute a per-dimension shift score combining normalized mean difference and variance ratio.

**Score computation**:
```
for each dimension i:
  mean_diff[i]  = (mean_A[i] - mean_B[i])^2
  var_ratio[i]  = max(var_A[i], var_B[i]) / (min(var_A[i], var_B[i]) + epsilon)
  dim_score[i]  = mean_diff[i] / var_pooled[i]  (Cohen's d per dimension)

dimension_drift_score = mean(dim_score) / normalization_constant
```

The normalization constant is calibrated such that a drift score of 0 means no dimension has shifted and a score of 1 means the average dimension shift corresponds to a full Cohen's d of approximately 2.0 (a very large distributional shift).

Additionally, a simplified KS-like statistic is computed per dimension using the sample vectors stored in the snapshots: for each dimension, the samples from A and B are sorted and the maximum absolute difference between their empirical CDFs is computed. The mean across dimensions of these per-dimension KS statistics provides a summary score for distributional shape differences within each dimension.

**When to use**: Dimension-wise analysis is complementary to centroid drift and pairwise similarity. It is particularly good at detecting sparse shifts: if only a subset of dimensions has drifted (because the model update primarily affected certain semantic directions), the per-dimension analysis surfaces this, while aggregate scores might average it out. The KS statistics are especially good at detecting distributional shape changes (bimodality, heavy tails) that mean and variance alone do not capture.

**Computational cost**: O(n * D) for n sample vectors and D dimensions. The dominant cost is computing per-dimension statistics over the stored sample. For n = 50 sample vectors and D = 1536 dimensions, this is 76,800 operations -- fast. The KS per-dimension computation is O(n log n) for sorting, totaling O(D * n log n). For D = 1536 and n = 50, this is 1536 * 50 * log(50) ≈ 470,000 operations -- still fast.

**Sensitivity**: Good at detecting systematic shifts across many dimensions (model change) and sparse shifts in specific dimensions (content specialization). Less sensitive to global scale changes that affect all dimensions equally (which centroid drift and pairwise similarity catch better).

### Method 5: Maximum Mean Discrepancy (MMD) Approximation

**Algorithm**: MMD is a kernel-based two-sample statistical test that measures whether two sets of samples are drawn from the same distribution. The exact MMD requires O(n^2) kernel evaluations. `embed-drift` implements an approximation using random Fourier features (a.k.a. the random kitchen sinks approximation), which computes an unbiased estimate of MMD in O(n * R) time for R random features.

**MMD definition**:
```
MMD^2(P, Q) = E_{x,x'~P}[k(x,x')] - 2*E_{x~P,y~Q}[k(x,y)] + E_{y,y'~Q}[k(y,y')]
```

where k is a kernel function. `embed-drift` uses the RBF (radial basis function) kernel with bandwidth σ set to the median pairwise distance between the sample embeddings (the "median heuristic").

**Random Fourier Feature approximation**:
1. Draw R random frequency vectors ω_r from the spectral distribution of the RBF kernel: `ω_r ~ N(0, (1/σ^2) * I)`.
2. For each embedding x, compute R-dimensional feature map: `φ(x) = sqrt(2/R) * cos(ω^T * x + b)` where b is drawn uniformly from [0, 2π].
3. Compute the mean feature vectors for sets A and B: `μ_A = mean(φ(x) for x in A)`, `μ_B = mean(φ(x) for x in B)`.
4. The approximated MMD^2 is `||μ_A - μ_B||^2`.

The drift score is the square root of the approximated MMD^2, clipped to [0, 1]:
```
mmd_drift_score = clip(sqrt(approximated_MMD^2) / normalization_constant, 0, 1)
```

The normalization constant is calibrated empirically: for embedding vectors from the same model and similar content, approximated MMD is typically < 0.01; for embedding vectors from completely different models, it is typically > 0.5.

**When to use**: MMD is the gold standard for two-sample distribution testing when the sample sizes are moderate (50-500 per set). It is theoretically grounded and sensitive to all moments of the distribution difference (mean, variance, skewness, multimodal structure, etc.), not just the ones that centroid drift or pairwise similarity capture. Use it as the final arbiter when other scores are ambiguous.

**Computational cost**: O(n * R * d) for n sample vectors, R random features, and d dimensions. Default R = 100. For n = 50, R = 100, d = 1536, this is 7.68 million operations -- fast. For larger samples, cost scales linearly. The bandwidth σ computation (median pairwise distance) is O(n^2 * d) but is computed once per comparison and cached; for n = 50 this is 50^2 * 1536 ≈ 3.8 million operations.

**Sensitivity**: High, when sample sizes are sufficient. For n = 50 sample vectors per snapshot, the power of the MMD test to detect a distribution shift corresponding to a Cohen's d of 0.5 is approximately 60-70%. For n = 100, power rises to approximately 85%. For n = 200, power exceeds 95%. Default sample size is 50; increase via `sampleSize` option for higher statistical power.

---

## 6. Snapshots

### What a Snapshot Captures

A snapshot is a compact, portable record of an embedding distribution's statistical state at a point in time. It stores enough information to:
1. Identify which model produced the embeddings (model ID, dimensionality).
2. Detect centroid drift (centroid vector).
3. Detect pairwise similarity shift (mean and standard deviation of pairwise cosine similarity across the sample).
4. Support dimension-wise comparison (per-dimension mean and variance arrays, sample vectors for KS statistics).
5. Support MMD computation (sample vectors).
6. Detect model changes (canary embeddings, if configured).

### Snapshot Schema

```typescript
interface Snapshot {
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
   * Length: min(sampleSize, sampleCount). Each entry: number[] of length dimensionality.
   */
  sampleVectors: number[][];

  /**
   * Embeddings of canary texts under this snapshot's model.
   * Present when the monitor has canaryTexts configured.
   * The canary texts are stored in the monitor config, not in the snapshot.
   * Length: number of canary texts. Each entry: number[] of length dimensionality.
   */
  canaryEmbeddings?: number[][];

  /**
   * Caller-provided metadata. Passed through without modification.
   * Examples: { corpusName: 'product-docs', indexVersion: '42', environment: 'production' }
   */
  metadata?: Record<string, unknown>;
}
```

### Creating a Snapshot

`monitor.snapshot(embeddings, options?)` accepts an array of embedding vectors and returns a `Snapshot`. The method:

1. Validates input: all vectors must have the same dimensionality, there must be at least 2 vectors.
2. Computes the centroid: element-wise mean of all input vectors.
3. Computes per-dimension variance.
4. Randomly samples M pairs from the input vectors (M = min(500, n*(n-1)/2)) and computes the cosine similarity for each pair. Records mean, standard deviation, and histogram.
5. Randomly samples `sampleSize` vectors (default: 50) from the input for storage as `sampleVectors`. Uses reservoir sampling to ensure a uniform random sample regardless of input size.
6. Assigns a UUID, timestamps, and attaches the model ID from the monitor's configuration and any caller-provided metadata.

The centroid, variance, and pairwise statistics are computed over all input vectors. The sample vectors are a random subsample -- they are used only for KS and MMD computation, which benefit from a representative sample but do not require all vectors.

Snapshot creation is synchronous and completes in O(n * d) time for n input vectors and d dimensions. For n = 10,000 and d = 1536, this takes approximately 1-3 seconds on a 2024 M3 MacBook Pro.

### Comparing Two Snapshots

`monitor.compare(snapshotA, snapshotB)` computes a `DriftReport` by applying each configured drift detection method to the two snapshots. The comparison:

1. **Model ID check**: If `snapshotA.modelId !== snapshotB.modelId`, the report immediately records `modelChanged: true` and sets severity to `critical`. All other scores are still computed (for informational purposes) but the model change flag takes precedence.
2. **Dimensionality check**: If the dimensionalities differ, the comparison cannot proceed. A `DriftError` is thrown with code `INCOMPATIBLE_DIMENSIONS`.
3. **Canary comparison**: If both snapshots have `canaryEmbeddings`, compute per-canary cosine similarities and the mean. Record the canary score.
4. **Centroid drift**: Compute cosine distance between `snapshotA.centroid` and `snapshotB.centroid`.
5. **Pairwise similarity shift**: Compare `meanPairwiseSimilarity` and `stdPairwiseSimilarity` between the two snapshots. Compute the normalized difference.
6. **Dimension-wise statistics**: Compute per-dimension mean differences (from `centroid`) and variance ratios (from `variance`). Compute per-dimension KS statistics using `sampleVectors`.
7. **MMD**: Compute the random Fourier feature approximation of MMD using `snapshotA.sampleVectors` and `snapshotB.sampleVectors`.
8. **Composite score**: Weighted average of all method scores. Compute severity from the composite score.
9. **Alert decision**: Compare composite score to configured thresholds. If threshold exceeded, call `onDrift` callback if configured.

### Snapshot Storage

`embed-drift` does not mandate a storage backend. Snapshots are plain JSON objects. The caller serializes and stores them:

```typescript
import { writeFileSync, readFileSync } from 'node:fs';

// Save
const snapshot = monitor.snapshot(embeddings);
writeFileSync('./snapshots/baseline.json', JSON.stringify(snapshot, null, 2));

// Load
const baseline = JSON.parse(readFileSync('./snapshots/baseline.json', 'utf8'));
const report = monitor.compare(baseline, currentSnapshot);
```

For teams that prefer an abstraction, `monitor.saveSnapshot(snapshot, path)` and `monitor.loadSnapshot(path)` are provided as convenience methods that read and write JSON to the filesystem using Node.js `fs` APIs. Both are synchronous.

Snapshots are typically 10-100 KB in size, depending on dimensionality and sample size. A 1536-dimensional snapshot with 50 sample vectors and 25 canary embeddings is approximately:
- Centroid: 1536 floats × 8 bytes ≈ 12 KB
- Variance: 1536 floats × 8 bytes ≈ 12 KB
- 50 sample vectors: 50 × 1536 × 8 bytes ≈ 600 KB
- 25 canary embeddings: 25 × 1536 × 8 bytes ≈ 300 KB
- Total (uncompressed JSON): approximately 900 KB

For large dimensionalities (3072 dimensions), snapshots approximately double in size. Compressing with gzip reduces size by approximately 60-70% for float arrays in JSON.

---

## 7. Canary Texts

### Built-In Default Canary Corpus

`embed-drift` ships with a built-in set of 25 diverse English texts covering different domains and registers. These texts are frozen -- they never change across package versions. Any change to a canary text would invalidate comparisons against stored reference embeddings.

The built-in canary corpus:

```typescript
const DEFAULT_CANARY_TEXTS = [
  // Technical documentation
  "The function accepts an array of strings and returns a promise that resolves to an array of embedding vectors.",
  "Configure the retry policy with an exponential backoff strategy and a maximum of five attempts.",
  "The database schema uses a composite primary key consisting of the tenant identifier and the record timestamp.",

  // Scientific language
  "Quantum entanglement allows two particles to maintain correlated states regardless of the spatial distance separating them.",
  "The activation function introduces nonlinearity into the neural network, enabling it to approximate complex functions.",
  "Mitochondria are membrane-bound organelles that generate most of the cell's supply of adenosine triphosphate.",

  // Legal / formal
  "The parties agree that any dispute arising under this agreement shall be resolved by binding arbitration.",
  "Notwithstanding any other provision of this contract, the limitation of liability clause shall survive termination.",
  "The indemnification obligation extends to all reasonable attorneys' fees and court costs incurred by the indemnified party.",

  // Casual conversation
  "Hey, are you free for lunch tomorrow? I was thinking we could try that new Italian place downtown.",
  "I can't believe how fast the weekend went. I feel like I barely had time to relax before it was Monday again.",
  "Did you see the game last night? That last-minute goal was absolutely wild.",

  // News / journalism
  "The central bank raised interest rates by a quarter point in response to persistent inflationary pressures.",
  "The company announced a strategic partnership that is expected to expand its presence in emerging markets.",
  "Investigators are examining the circumstances surrounding the incident, according to a spokesperson.",

  // Medical / clinical
  "The patient presented with acute onset dyspnea and bilateral lower extremity edema consistent with heart failure.",
  "Administer a loading dose of intravenous antibiotics prior to initiating oral maintenance therapy.",
  "The randomized controlled trial demonstrated a statistically significant reduction in the primary endpoint.",

  // Creative writing
  "The lighthouse beam swept across the fog, momentarily illuminating the restless surface of the dark water below.",
  "She hesitated at the door, her hand hovering over the handle, before finally stepping into the unknown.",

  // Mathematical / logical
  "For all epsilon greater than zero, there exists a delta such that the absolute difference is bounded.",
  "The algorithm terminates in polynomial time when the input graph is acyclic and the edge weights are non-negative.",

  // Instructions / how-to
  "Preheat the oven to 375 degrees Fahrenheit and line a baking sheet with parchment paper.",
  "Before submitting the pull request, ensure that all unit tests pass and the linter reports no errors.",

  // Philosophy / abstract
  "The nature of consciousness remains one of the most profound and unresolved questions in contemporary philosophy of mind.",
];
```

### Custom Canary Texts

Callers can provide additional or replacement canary texts via `createMonitor({ canaryTexts: [...] })`. When `canaryTexts` is provided:
- If `replaceDefaultCanaries: false` (default), the custom texts are **appended** to the default set.
- If `replaceDefaultCanaries: true`, the custom texts **replace** the default set entirely.

Domain-specific canary texts increase sensitivity for model changes that primarily affect domain-specific vocabulary. For a legal document RAG pipeline, adding 5-10 legal-domain canary texts ensures the fingerprint covers that semantic region.

### How Many Canaries Are Needed

The default 25 canaries is sufficient for detecting virtually any model change. Empirically:
- A model change that affects all semantic domains (e.g., a completely different architecture) is detected with even 3-5 diverse canaries.
- A model change that only affects one semantic domain (hypothetical) would require canaries in that domain.
- 25 diverse canaries across 8 domains provides robust coverage.

Increasing canary count beyond 25 provides diminishing returns for model change detection. For content drift detection, canaries are not the right tool (use snapshot comparison instead). The recommended range is 15-50 canary texts.

### Canary Embedding Comparison

When `monitor.checkCanaries(embedFn)` is called:
1. All canary texts are embedded in a single batch call: `const newEmbeddings = await embedFn(canaryTexts)`.
2. For each canary text i, compute `cosine_similarity(newEmbeddings[i], referenceEmbeddings[i])`.
3. Compute the mean and minimum of these per-canary similarities.
4. The mean similarity is the primary signal. The minimum similarity identifies the individual canary that has drifted most -- useful for diagnosing which semantic domain is most affected.
5. The result is a `CanaryReport` with the mean similarity, minimum similarity, per-canary similarities, a `modelChanged` boolean (true if mean similarity < `canaryThreshold`), and the drift score.

The `referenceEmbeddings` are read from the stored baseline snapshot's `canaryEmbeddings` field. If no baseline snapshot is set (no call to `monitor.setBaseline(snapshot)` has been made), the canary check creates a new baseline by embedding the canary texts and storing them -- subsequent calls compare against this baseline.

---

## 8. Drift Score and Severity

### Per-Method Scores

Each drift detection method produces a score in [0, 1]. The scores are independent and normalized to the same scale despite measuring fundamentally different things. The normalization approach for each method:

| Method | Score = 0 | Score = 1 | Normalization basis |
|---|---|---|---|
| Canary | Mean similarity = 1.0 (identical model) | Mean similarity = 0.0 (no correlation) | `1 - mean_canary_similarity` |
| Centroid | Cosine distance = 0 (same direction) | Cosine distance = 1 (orthogonal) | Cosine distance directly |
| Pairwise similarity | Same distribution | Distributions shifted by 0.2+ in mean | Linear interpolation, clamped |
| Dimension-wise | Cohen's d = 0 per dimension | Cohen's d = 2.0 per dimension | `min(mean_cohens_d / 2.0, 1.0)` |
| MMD | MMD^2 ≈ 0 (same distribution) | MMD^2 at expected value for fully different distributions | `min(sqrt(MMD^2) / calibration_constant, 1.0)` |

### Composite Drift Score

The composite drift score is a weighted average of the per-method scores:

```
composite_score = sum(weight[method] * score[method]) / sum(weight[method])
```

Default weights:
- Canary: 0.35 (highest weight -- the most reliable signal for model change)
- Centroid: 0.15
- Pairwise similarity: 0.20
- Dimension-wise: 0.15
- MMD: 0.15

If canary embeddings are not present in one or both snapshots, the canary method is excluded and weights are renormalized. If the caller disables specific methods, their weights are redistributed proportionally.

### Severity Bands

```typescript
type DriftSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

function classifySeverity(score: number, modelChanged: boolean): DriftSeverity {
  if (modelChanged) return 'critical';
  if (score < 0.05) return 'none';
  if (score < 0.20) return 'low';
  if (score < 0.40) return 'medium';
  if (score < 0.70) return 'high';
  return 'critical';
}
```

`modelChanged` is set to `true` when:
- The two snapshots have different model IDs, OR
- The canary mean similarity falls below the `canaryThreshold` (default: 0.95).

A `modelChanged: true` always produces `severity: 'critical'`, regardless of the composite score. This is intentional: any confirmed model change requires immediate re-embedding.

### Threshold Configuration

Callers configure alert thresholds at the monitor level:

```typescript
const monitor = createMonitor({
  alertSeverity: 'high',      // alert when severity >= 'high'
  thresholds: {
    composite: 0.40,          // alert when composite score >= 0.40
    canary: 0.05,             // alert when canary drift score >= 0.05
    centroid: 0.30,           // alert when centroid drift score >= 0.30
    pairwise: 0.25,           // alert when pairwise drift score >= 0.25
    dimensionWise: 0.35,      // alert when dimension-wise drift score >= 0.35
    mmd: 0.30,                // alert when MMD drift score >= 0.30
  },
});
```

An alert fires if: `severity >= alertSeverity` OR any per-method score exceeds its configured threshold. Both conditions trigger the `onDrift` callback.

---

## 9. API Surface

### Installation

```bash
npm install embed-drift
```

### Factory: `createMonitor`

```typescript
import { createMonitor } from 'embed-drift';

const monitor = createMonitor({
  modelId: 'openai/text-embedding-3-small',
  canaryTexts: [], // optional: extra canary texts to append to built-ins
});
```

**Signature:**
```typescript
function createMonitor(options: DriftMonitorOptions): DriftMonitor;
```

### `monitor.snapshot`

Captures the distribution of a set of embedding vectors as a `Snapshot`.

```typescript
const snap = monitor.snapshot(embeddings);
// snap.modelId === 'openai/text-embedding-3-small'
// snap.centroid is the mean vector
// snap.sampleVectors is a random subset
```

**Signature:**
```typescript
snapshot(
  embeddings: number[][],
  options?: SnapshotOptions,
): Snapshot;
```

**Options:**
```typescript
interface SnapshotOptions {
  /** Number of vectors to store as sample for KS/MMD computation. Default: 50. */
  sampleSize?: number;

  /** Whether to include canary embeddings in this snapshot.
   *  Requires that embedFn is provided in these options or at monitor creation.
   *  Default: false. */
  includeCanaries?: boolean;

  /** Embed function used to compute canary embeddings when includeCanaries is true. */
  embedFn?: EmbedFn;

  /** Caller-provided metadata to attach to the snapshot. Default: {}. */
  metadata?: Record<string, unknown>;
}
```

**Throws** `DriftError` if:
- Input array is empty or contains fewer than 2 vectors.
- Embedding vectors have inconsistent dimensionality.
- `includeCanaries: true` is set but no `embedFn` is available.

### `monitor.compare`

Computes a `DriftReport` quantifying the distribution shift between two snapshots.

```typescript
const report = monitor.compare(baselineSnapshot, currentSnapshot);
console.log(report.composite.score);    // 0.42
console.log(report.composite.severity); // 'high'
console.log(report.modelChanged);       // false
console.log(monitor.alert(report));     // true (if score >= configured threshold)
```

**Signature:**
```typescript
compare(snapshotA: Snapshot, snapshotB: Snapshot): DriftReport;
```

**Throws** `DriftError` with code `INCOMPATIBLE_DIMENSIONS` if the two snapshots have different embedding dimensionalities.

### `monitor.setBaseline`

Stores a snapshot as the baseline for subsequent `monitor.check()` calls.

```typescript
monitor.setBaseline(snapshot);
```

**Signature:**
```typescript
setBaseline(snapshot: Snapshot): void;
```

The baseline is stored in memory. For persistence across process restarts, serialize the snapshot with `JSON.stringify` and reload it with `monitor.setBaseline(JSON.parse(saved))`.

### `monitor.check`

Compares a new set of embeddings against the stored baseline snapshot. Convenience wrapper around `snapshot` + `compare`.

```typescript
const report = await monitor.check(newEmbeddings);
// Internally: creates a snapshot of newEmbeddings, compares to baseline
```

**Signature:**
```typescript
check(
  embeddings: number[][],
  options?: CheckOptions,
): DriftReport;
```

**Options:**
```typescript
interface CheckOptions {
  /** Options for the new snapshot creation. */
  snapshotOptions?: SnapshotOptions;
}
```

**Throws** `DriftError` with code `NO_BASELINE` if `monitor.setBaseline()` has not been called.

### `monitor.checkCanaries`

Re-embeds the canary texts using the provided embed function and compares against the stored canary reference embeddings.

```typescript
const canaryReport = await monitor.checkCanaries(async (texts) => {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return resp.data.map(d => d.embedding);
});

console.log(canaryReport.meanSimilarity);  // 0.997 (same model)
console.log(canaryReport.modelChanged);    // false
console.log(canaryReport.driftScore);      // 0.003
```

**Signature:**
```typescript
checkCanaries(embedFn: EmbedFn): Promise<CanaryReport>;
```

If no canary reference embeddings exist (first call), the method embeds the canary texts, stores the result as the reference, and returns a `CanaryReport` with `isInitialBaseline: true` and `driftScore: 0`.

### `monitor.setCanaryBaseline`

Explicitly sets the canary reference embeddings without calling `checkCanaries`. Useful for loading a pre-computed canary baseline from a stored snapshot.

```typescript
// Load canary reference from a stored snapshot
const stored = JSON.parse(readFileSync('./baseline.json', 'utf8'));
monitor.setCanaryBaseline(stored.canaryEmbeddings);
```

**Signature:**
```typescript
setCanaryBaseline(canaryEmbeddings: number[][]): void;
```

### `monitor.alert`

Returns `true` if the drift report exceeds configured alert thresholds.

```typescript
const shouldAlert = monitor.alert(report);
if (shouldAlert) {
  console.log('Drift detected! Re-embedding required.');
}
```

**Signature:**
```typescript
alert(report: DriftReport | CanaryReport): boolean;
```

### `monitor.saveSnapshot` / `monitor.loadSnapshot`

Convenience methods for filesystem serialization.

```typescript
monitor.saveSnapshot(snapshot, './snapshots/baseline-2026-03-18.json');
const loaded = monitor.loadSnapshot('./snapshots/baseline-2026-03-18.json');
```

**Signatures:**
```typescript
saveSnapshot(snapshot: Snapshot, filePath: string): void;
loadSnapshot(filePath: string): Snapshot;
```

Both use Node.js synchronous `fs` APIs. `saveSnapshot` writes pretty-printed JSON. `loadSnapshot` reads and parses JSON, validates the snapshot schema, and throws `DriftError` with code `INVALID_SNAPSHOT` if the file does not conform.

---

### Type Definitions

```typescript
// ── Embed Function ────────────────────────────────────────────────────

/**
 * A function that embeds an array of texts and returns an array of vectors.
 * The returned array must have the same length and order as the input array.
 */
type EmbedFn = (texts: string[]) => Promise<number[][]>;

// ── Monitor Options ───────────────────────────────────────────────────

interface DriftMonitorOptions {
  /**
   * The embedding model identifier for new snapshots.
   * Included in every snapshot created by this monitor.
   * Examples: 'text-embedding-3-small', 'openai/text-embedding-3-large', 'cohere/embed-english-v3.0'
   * Required.
   */
  modelId: string;

  /**
   * Additional canary texts to use for model fingerprinting.
   * Appended to the built-in default canary corpus unless replaceDefaultCanaries is true.
   * Default: [] (use only built-in canaries).
   */
  canaryTexts?: string[];

  /**
   * If true, replaces the built-in canary corpus with the provided canaryTexts entirely.
   * If false (default), canaryTexts are appended to the built-in set.
   * Default: false.
   */
  replaceDefaultCanaries?: boolean;

  /**
   * Cosine similarity threshold below which the canary check declares a model change.
   * A mean canary cosine similarity below this value → modelChanged: true.
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
   * An alert fires if severity >= alertSeverity OR any per-method score exceeds its threshold.
   * Default: {} (no per-method overrides; severity alone controls alerts).
   */
  thresholds?: Partial<MethodThresholds>;

  /**
   * Callback invoked when an alert fires (severity >= alertSeverity or a per-method threshold exceeded).
   * Receives the full DriftReport or CanaryReport.
   * Default: undefined (no callback).
   */
  onDrift?: (report: DriftReport | CanaryReport) => void | Promise<void>;

  /**
   * Method weights for composite drift score computation.
   * Weights are normalized to sum to 1 after excluding disabled methods.
   * Default: { canary: 0.35, centroid: 0.15, pairwise: 0.20, dimensionWise: 0.15, mmd: 0.15 }
   */
  methodWeights?: Partial<MethodWeights>;

  /**
   * Which drift detection methods to run in compare().
   * Disabling methods reduces computation. Canary is controlled separately by canaryTexts presence.
   * Default: all methods enabled.
   */
  enabledMethods?: {
    centroid?: boolean;         // default: true
    pairwise?: boolean;         // default: true
    dimensionWise?: boolean;    // default: true
    mmd?: boolean;              // default: true
  };

  /**
   * Number of random Fourier features for MMD approximation.
   * Higher values → more accurate approximation, more computation.
   * Default: 100.
   */
  mmdRandomFeatures?: number;

  /**
   * Number of random pairs to sample for pairwise similarity estimation.
   * Higher values → better statistical estimates, more computation.
   * Default: 500.
   */
  pairwiseSamplePairs?: number;
}

// ── Thresholds ────────────────────────────────────────────────────────

interface MethodThresholds {
  composite: number;
  canary: number;
  centroid: number;
  pairwise: number;
  dimensionWise: number;
  mmd: number;
}

interface MethodWeights {
  canary: number;
  centroid: number;
  pairwise: number;
  dimensionWise: number;
  mmd: number;
}

// ── Drift Severity ────────────────────────────────────────────────────

type DriftSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

// ── Method Result ─────────────────────────────────────────────────────

interface MethodResult {
  /** Drift score for this method, in [0, 1]. */
  score: number;

  /** Whether this method was run. False when method is disabled or data was unavailable. */
  computed: boolean;

  /** Human-readable interpretation of this method's result. */
  interpretation: string;

  /** Method-specific details. */
  details?: Record<string, unknown>;
}

// ── Drift Report ──────────────────────────────────────────────────────

interface DriftReport {
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

// ── Canary Report ─────────────────────────────────────────────────────

interface CanaryReport {
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

// ── DriftMonitor Interface ────────────────────────────────────────────

interface DriftMonitor {
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

// ── Error ─────────────────────────────────────────────────────────────

class DriftError extends Error {
  code:
    | 'EMPTY_INPUT'              // embeddings array is empty or has fewer than 2 vectors
    | 'INCONSISTENT_DIMENSIONS'  // vectors have different lengths
    | 'INCOMPATIBLE_DIMENSIONS'  // two snapshots have different dimensionalities
    | 'NO_BASELINE'              // monitor.check() called before setBaseline()
    | 'INVALID_SNAPSHOT'         // loaded snapshot fails schema validation
    | 'NO_CANARY_BASELINE'       // canary check called before baseline is established and no embed fn available
    | 'EMBED_FN_FAILED';         // embed function threw during canary check
}
```

### Usage Examples

#### Model Migration Detection

```typescript
import { createMonitor } from 'embed-drift';
import OpenAI from 'openai';
import { readFileSync, writeFileSync } from 'node:fs';

const openai = new OpenAI();

// Create monitor for your current model
const monitor = createMonitor({
  modelId: 'openai/text-embedding-ada-002',
  alertSeverity: 'high',
  onDrift: (report) => {
    console.error('Embedding drift detected!', report);
    // Trigger re-indexing pipeline, send PagerDuty alert, etc.
  },
});

// Establish canary baseline when running on the old model
const embedFn = async (texts: string[]) => {
  const res = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: texts });
  return res.data.map(d => d.embedding);
};

// First run: establishes baseline
const baseline = await monitor.checkCanaries(embedFn);
writeFileSync('./canary-baseline.json', JSON.stringify(baseline));

// Later run: detect model change
// Now using the new model
const newEmbedFn = async (texts: string[]) => {
  const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: texts });
  return res.data.map(d => d.embedding);
};

// Load saved baseline canary embeddings
const saved = JSON.parse(readFileSync('./canary-baseline.json', 'utf8'));
monitor.setCanaryBaseline(saved.perCanarySimilarities); // load reference embeddings

const check = await monitor.checkCanaries(newEmbedFn);
// check.modelChanged === true
// check.driftScore   === ~0.42 (ada-002 vs text-embedding-3-small are very different)
// check.alerted      === true  (onDrift callback was called)
```

#### Snapshot-Based Distribution Monitoring

```typescript
import { createMonitor } from 'embed-drift';
import { readFileSync, writeFileSync } from 'node:fs';

const monitor = createMonitor({
  modelId: 'openai/text-embedding-3-small',
  alertSeverity: 'medium',
  onDrift: ({ composite, summary }) => {
    console.warn(`Drift alert: severity=${composite.severity}, score=${composite.score.toFixed(3)}`);
    console.warn(summary);
  },
});

// Weekly job: take snapshot of current corpus embeddings
const currentVectors: number[][] = await fetchCurrentCorpusEmbeddings();
const currentSnapshot = monitor.snapshot(currentVectors, {
  metadata: { weekOf: '2026-03-18', corpusSize: currentVectors.length },
});

// Compare to the baseline snapshot taken when the index was last built
const baselineSnapshot = monitor.loadSnapshot('./snapshots/index-built-2026-01-01.json');
const report = monitor.compare(baselineSnapshot, currentSnapshot);

console.log(`Composite drift score: ${report.composite.score.toFixed(3)}`);
console.log(`Severity: ${report.composite.severity}`);
console.log(`Centroid drift: ${report.methods.centroid.score.toFixed(3)}`);
console.log(`Pairwise similarity drift: ${report.methods.pairwise.score.toFixed(3)}`);

// Save current snapshot for future comparisons
monitor.saveSnapshot(currentSnapshot, './snapshots/weekly-2026-03-18.json');
```

#### CI/CD Pre-Deployment Gate

```typescript
import { createMonitor } from 'embed-drift';

// In CI: compare embeddings from old model and new model on the same sample corpus
const monitor = createMonitor({ modelId: 'openai/text-embedding-3-large' });

const sampleTexts = loadSampleCorpus(200); // 200 representative documents

const oldEmbeddings = await embedWithOldModel(sampleTexts);
const newEmbeddings = await embedWithNewModel(sampleTexts);

const oldSnapshot = monitor.snapshot(oldEmbeddings, { metadata: { model: 'ada-002' } });
// Re-create monitor with new model ID for the new snapshot
const newMonitor = createMonitor({ modelId: 'openai/text-embedding-3-large' });
const newSnapshot = newMonitor.snapshot(newEmbeddings);

const report = monitor.compare(oldSnapshot, newSnapshot);

if (report.composite.severity === 'critical' || report.composite.severity === 'high') {
  console.error('Model change requires full re-indexing before deployment.');
  console.error(`Drift score: ${report.composite.score.toFixed(3)}`);
  process.exit(1); // Fail CI gate
}

console.log('Drift within acceptable range. Deployment can proceed.');
process.exit(0);
```

#### Production Monitoring with `embed-cache` Integration

```typescript
import { createCache } from 'embed-cache';
import { createMonitor } from 'embed-drift';

const cache = createCache({
  model: 'text-embedding-3-small',
  embedder: openaiEmbedder,
  storage: { type: 'sqlite', path: './embeddings.db' },
});

const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  alertSeverity: 'high',
  onDrift: async (report) => {
    // When drift is detected, the embed-cache may contain stale entries
    // from the old model. Clear the cache and trigger re-indexing.
    if (report.modelChanged) {
      await cache.clear({ model: 'text-embedding-3-small' });
      console.error('Model changed. Cache cleared. Re-indexing required.');
    }
  },
});

// Check canaries on every pipeline run (cheap: only N canary texts)
const canaryCheck = await monitor.checkCanaries((texts) => cache.embedBatch(texts));
if (canaryCheck.modelChanged) {
  // Alert fired via onDrift callback above
  return;
}

// Proceed with normal pipeline operations
const vectors = await cache.embedBatch(newDocumentChunks);
```

---

## 10. Alerting

### Threshold-Based Alerts

An alert fires when either:
1. The overall drift severity meets or exceeds `alertSeverity` (default: `'high'`), OR
2. Any per-method score exceeds its configured method threshold in `thresholds`.

Both conditions trigger the same `onDrift` callback. The `report.alerted` field records whether the report crossed an alert threshold.

### The `onDrift` Callback

```typescript
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  alertSeverity: 'medium',
  onDrift: (report) => {
    // 'report' is either DriftReport or CanaryReport
    if ('modelChanged' in report && report.modelChanged) {
      sendPagerDutyAlert({ severity: 'critical', message: 'Embedding model changed' });
    } else {
      sendSlackNotification({
        channel: '#embedding-health',
        text: `Drift alert: score=${report.composite?.score.toFixed(3)}, severity=${report.composite?.severity}`,
      });
    }
  },
});
```

The callback may be synchronous or async. If async, `embed-drift` does not await it -- fire-and-forget. If the callback throws, the error is swallowed (to prevent alert failures from disrupting the main pipeline). Callers that need guaranteed delivery should handle errors inside the callback.

### Integration with Monitoring Systems

**Event emission**: Wrap alerts in an EventEmitter for pub/sub patterns:

```typescript
import { EventEmitter } from 'node:events';
const driftEvents = new EventEmitter();

const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  onDrift: (report) => driftEvents.emit('drift', report),
});

driftEvents.on('drift', async (report) => {
  await metrics.increment('embed_drift_alert', { severity: report.composite?.severity });
});
```

**Webhook**: POST the report to an external endpoint:

```typescript
onDrift: async (report) => {
  await fetch('https://alerts.internal/embed-drift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
},
```

**Structured logging**: Log as a JSON object for ingestion into a log aggregator:

```typescript
onDrift: (report) => {
  logger.warn({ event: 'embed_drift', ...report });
},
```

---

## 11. Configuration Reference

### `DriftMonitorOptions` Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `modelId` | `string` | required | Embedding model ID attached to all snapshots from this monitor |
| `canaryTexts` | `string[]` | `[]` | Additional canary texts appended to the built-in corpus |
| `replaceDefaultCanaries` | `boolean` | `false` | If true, custom canaryTexts replace the built-in corpus |
| `canaryThreshold` | `number` | `0.95` | Mean canary similarity below this → `modelChanged: true` |
| `alertSeverity` | `DriftSeverity` | `'high'` | Minimum severity to trigger `onDrift` callback |
| `thresholds.composite` | `number` | `undefined` | Composite score threshold for alert (overrides severity if set) |
| `thresholds.canary` | `number` | `undefined` | Per-method threshold for canary score |
| `thresholds.centroid` | `number` | `undefined` | Per-method threshold for centroid drift score |
| `thresholds.pairwise` | `number` | `undefined` | Per-method threshold for pairwise similarity drift score |
| `thresholds.dimensionWise` | `number` | `undefined` | Per-method threshold for dimension-wise drift score |
| `thresholds.mmd` | `number` | `undefined` | Per-method threshold for MMD drift score |
| `onDrift` | `(report) => void \| Promise<void>` | `undefined` | Callback invoked when an alert fires |
| `methodWeights.canary` | `number` | `0.35` | Weight for canary score in composite |
| `methodWeights.centroid` | `number` | `0.15` | Weight for centroid drift in composite |
| `methodWeights.pairwise` | `number` | `0.20` | Weight for pairwise similarity drift in composite |
| `methodWeights.dimensionWise` | `number` | `0.15` | Weight for dimension-wise drift in composite |
| `methodWeights.mmd` | `number` | `0.15` | Weight for MMD drift in composite |
| `enabledMethods.centroid` | `boolean` | `true` | Enable centroid drift method |
| `enabledMethods.pairwise` | `boolean` | `true` | Enable pairwise similarity method |
| `enabledMethods.dimensionWise` | `boolean` | `true` | Enable dimension-wise statistics method |
| `enabledMethods.mmd` | `boolean` | `true` | Enable MMD method |
| `mmdRandomFeatures` | `number` | `100` | Number of random Fourier features for MMD approximation |
| `pairwiseSamplePairs` | `number` | `500` | Number of random pairs for pairwise similarity estimation |

### `SnapshotOptions` Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `sampleSize` | `number` | `50` | Number of vectors to store as sample for KS/MMD comparison |
| `includeCanaries` | `boolean` | `false` | Embed and include canary embeddings in the snapshot |
| `embedFn` | `EmbedFn` | `undefined` | Embed function to use when `includeCanaries: true` |
| `metadata` | `Record<string, unknown>` | `{}` | Caller-provided metadata attached to the snapshot |

---

## 12. CLI

### Installation and Invocation

```bash
# Global install
npm install -g embed-drift
embed-drift snapshot --input embeddings.json --output baseline.json --model text-embedding-3-small

# npx (no install)
npx embed-drift compare --a baseline.json --b current.json

# Package script
# package.json: { "scripts": { "drift-check": "embed-drift compare --a baseline.json --b current.json" } }
npm run drift-check
```

### CLI Binary Name

`embed-drift`

### Commands

#### `embed-drift snapshot`

Creates a snapshot from a JSON file of embedding vectors.

```
embed-drift snapshot [options]

Options:
  --input  <path>     Path to JSON file: number[][] (array of embedding vectors). Required.
  --output <path>     Path to write the snapshot JSON. Default: stdout.
  --model  <model>    Embedding model ID to record in the snapshot. Required.
  --sample-size <n>   Number of sample vectors to store. Default: 50.
  --metadata <json>   JSON string of metadata to attach. Default: {}.
  --format  <fmt>     Output format: json (default) | summary.
```

**Input format**: A JSON file containing an array of arrays of numbers:
```json
[[0.123, -0.456, 0.789, ...], [0.234, 0.567, -0.890, ...], ...]
```

**Human output** (`--format summary`):
```
embed-drift snapshot

  Model:       openai/text-embedding-3-small
  Vectors:     10,247
  Dimensions:  1536
  Centroid:    [0.012, -0.003, 0.007, ...]  (first 5 shown)
  Mean pairwise similarity: 0.423 (σ=0.112)
  Sample size: 50 vectors stored

  Snapshot saved to: ./snapshots/baseline.json
```

#### `embed-drift compare`

Compares two snapshots and prints a drift report.

```
embed-drift compare [options]

Options:
  --a <path>           Path to snapshot A (reference / older). Required.
  --b <path>           Path to snapshot B (current / newer). Required.
  --output <path>      Path to write the DriftReport JSON. Default: stdout for json format.
  --format <fmt>       Output format: summary (default) | json.
  --alert-severity <s> Severity threshold for non-zero exit code: none|low|medium|high|critical.
                       Default: high (exit code 1 when severity >= high).
  --no-canary          Skip canary comparison even if canary embeddings are present.
  --no-mmd             Skip MMD computation (faster for quick comparisons).
```

**Human output** (`--format summary`, default):
```
embed-drift compare

  Snapshot A:  baseline-2026-01-01.json  (model: openai/text-embedding-3-small)
  Snapshot B:  current-2026-03-18.json   (model: openai/text-embedding-3-small)
  Model changed: NO

  Drift scores:
    Canary:          0.003  (mean similarity: 0.997) ✓
    Centroid:        0.041  ✓
    Pairwise sim.:   0.087  ✓
    Dimension-wise:  0.102  ✓
    MMD:             0.076  ✓

  Composite score:   0.073
  Severity:          low

  Interpretation: Minor content distribution shift. Within normal variation.
  No re-embedding required.
```

**Alert output** (model changed):
```
embed-drift compare

  Snapshot A:  baseline-ada-002.json   (model: openai/text-embedding-ada-002)
  Snapshot B:  current-3-small.json    (model: openai/text-embedding-3-small)
  Model changed: YES  ← Model IDs differ

  Drift scores:
    Canary:          0.421  ← ABOVE THRESHOLD  (mean similarity: 0.579)
    Centroid:        0.612
    Pairwise sim.:   0.534
    Dimension-wise:  0.481
    MMD:             0.593

  Composite score:   0.528
  Severity:          CRITICAL

  Action required: Re-embed entire index with new model before deployment.
```

#### `embed-drift canary`

Embeds canary texts with a configured model and saves or compares the reference embeddings.

```
embed-drift canary [options]

Options:
  --action <act>       Action: establish | check. Required.
                       'establish': embed canaries, save as reference.
                       'check': re-embed canaries, compare to reference.
  --reference <path>   Path to the reference canary JSON (from a previous 'establish' run).
                       Required for 'check'. Output path for 'establish'.
  --model <model>      Model name for API call. Required.
  --provider <p>       Provider: openai (default) | cohere.
  --api-key <key>      API key (or set OPENAI_API_KEY / COHERE_API_KEY env var).
  --canary-texts <p>   Path to a JSON file of additional canary texts (string[]).
  --format <fmt>       Output format: summary (default) | json.
```

**`establish` output:**
```
embed-drift canary --action establish --reference ./canary-ref.json --model text-embedding-3-small

  Canary corpus: 25 built-in texts
  Model:         openai/text-embedding-3-small
  Embedding...   done (1 API call, 25 texts)

  Reference saved to: ./canary-ref.json
  Run 'embed-drift canary --action check --reference ./canary-ref.json --model <model>' to compare.
```

**`check` output (no change):**
```
embed-drift canary --action check --reference ./canary-ref.json --model text-embedding-3-small

  Canary corpus: 25 built-in texts
  Reference:     ./canary-ref.json
  Model:         openai/text-embedding-3-small

  Mean similarity: 0.9997  (range: 0.9993 -- 0.9999)
  Drift score:     0.0003
  Model changed:   NO

  Result: Model fingerprint matches reference. No action needed.
```

**`check` output (model changed):**
```
embed-drift canary --action check --reference ./canary-ref.json --model text-embedding-3-small

  Canary corpus:    25 built-in texts
  Reference model:  openai/text-embedding-ada-002
  Current model:    openai/text-embedding-3-small

  Mean similarity:  0.574  ← BELOW THRESHOLD (0.95)
  Drift score:      0.426
  Model changed:    YES

  ALERT: Model fingerprint mismatch. Existing vector index is incompatible.
  Action: Re-embed your index with the new model before resuming retrieval.

Exit code: 1
```

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | No significant drift detected. Distribution is stable or drift is below `--alert-severity`. |
| `1` | Drift detected at or above `--alert-severity`. Re-embedding may be required. |
| `2` | Configuration or usage error (missing required options, invalid flags, unreadable files). |
| `3` | Model change detected (highest urgency alert -- always exit code 3 when `modelChanged: true`). |

Exit code 3 is separate from 1 to allow shell scripts to branch specifically on confirmed model changes:
```bash
embed-drift compare --a baseline.json --b current.json
if [ $? -eq 3 ]; then
  echo "Model changed! Triggering re-indexing pipeline..."
  ./scripts/reindex.sh
fi
```

---

## 13. Integration

### Integration with `embed-cache`

`embed-cache` stores embedding vectors in a content-addressable cache keyed by `SHA-256(text + modelId)`. The model ID is part of the key -- so when the model changes, the new model's queries will miss the cache (different key namespace) and re-embed automatically. However, the old model's entries remain in storage, occupying space and potentially causing confusion.

`embed-drift` integrates with `embed-cache` in two ways:

**1. Use `embed-cache` as the embed function for canary checks**: The canary check re-embeds the canary corpus. Routing this through `embed-cache` means the canary embeddings are cached for free:

```typescript
import { createCache } from 'embed-cache';
import { createMonitor } from 'embed-drift';

const cache = createCache({ model: 'text-embedding-3-small', embedder: openaiEmbedder });
const monitor = createMonitor({ modelId: 'text-embedding-3-small' });

// Canary texts will be embedded on first call and cached thereafter
const report = await monitor.checkCanaries((texts) => cache.embedBatch(texts));
```

**2. Clear stale cache entries on model change**: When `embed-drift` detects a model change, the cache should be cleared to remove incompatible entries:

```typescript
const monitor = createMonitor({
  modelId: 'text-embedding-3-small',
  onDrift: async (report) => {
    if (report.modelChanged) {
      await cache.clear(); // remove all stale entries from old model
    }
  },
});
```

### Integration with `embed-cluster`

`embed-cluster` provides cluster structure over embedding vectors. `embed-drift` can operate on cluster centroids and cluster-level statistics to detect cluster-level drift:

- **Centroid drift per cluster**: Compare cluster centroids between two time periods. A cluster whose centroid has drifted significantly indicates that the content within that topic has evolved.
- **Cluster membership drift**: Track which cluster each document belongs to. If many documents have changed cluster membership between snapshots, the content distribution has restructured.
- **Cluster emergence and disappearance**: New clusters appearing (or old clusters disappearing) indicates the corpus population has changed.

```typescript
import { cluster } from 'embed-cluster';
import { createMonitor } from 'embed-drift';

const oldResult = await cluster(oldEmbeddings);
const newResult = await cluster(newEmbeddings);

const monitor = createMonitor({ modelId: 'text-embedding-3-small' });

// Take snapshots of cluster centroids instead of full embedding sets
// (centroid-level analysis is much cheaper than full-corpus analysis)
const oldCentroidSnapshot = monitor.snapshot(oldResult.clusters.map(c => c.centroid));
const newCentroidSnapshot = monitor.snapshot(newResult.clusters.map(c => c.centroid));

const report = monitor.compare(oldCentroidSnapshot, newCentroidSnapshot);
// report.composite.score reflects whether cluster structure has shifted
```

### Integration with `model-price-registry`

`model-price-registry` (this monorepo) maintains a registry of embedding model metadata: provider, release date, price per million tokens, dimensionality, and deprecation status. `embed-drift` can query `model-price-registry` to:
- Automatically populate the `modelId` field with the canonical model identifier.
- Check whether a model is deprecated and flag it in the snapshot metadata.
- Log the model's dimension count as a consistency check against the actual embedding dimensionality.

```typescript
import { createMonitor } from 'embed-drift';
import { getModelInfo } from 'model-price-registry';

const modelInfo = getModelInfo('text-embedding-3-small');
const monitor = createMonitor({
  modelId: modelInfo.canonicalId,
  // modelInfo.deprecated → warn if using a deprecated model
});
```

---

## 14. Testing Strategy

### Unit Tests

Unit tests cover each drift detection method and utility in isolation, using small deterministic synthetic embeddings.

**Snapshot creation tests:**
- `monitor.snapshot(embeddings)` returns a snapshot with the correct model ID, dimensionality, and centroid (verify element-wise mean is correct for a 3-vector, 2-dimension input).
- Centroid is the arithmetic mean of the input vectors (verified numerically for small inputs).
- Per-dimension variance is computed correctly (verified against manual calculation).
- `sampleVectors` has length `min(sampleSize, n)`.
- `snapshot` throws `DriftError` with code `EMPTY_INPUT` for an empty array.
- `snapshot` throws `DriftError` with code `INCONSISTENT_DIMENSIONS` when vectors have different lengths.

**Canary tests:**
- `checkCanaries(embedFn)` embeds exactly the configured canary texts in one call.
- When called twice with the same embedFn, the second call compares against the first call's result.
- `isInitialBaseline: true` on the first call, `false` on subsequent calls.
- `modelChanged: false` when mean similarity > `canaryThreshold`.
- `modelChanged: true` when mean similarity < `canaryThreshold`.
- `setCanaryBaseline(embeddings)` overrides the stored reference.

**Centroid drift tests:**
- Two identical snapshots → centroid drift score = 0.
- Snapshot with centroid [1, 0] vs. [0, 1] (orthogonal) → centroid drift score = 1.0.
- Snapshot with centroid [1, 0] vs. [-1, 0] (opposite) → centroid drift score = 2.0 clamped to 1.0.

**Pairwise similarity tests:**
- Two sets of identical embeddings → pairwise drift score ≈ 0.
- Two sets with very different pairwise similarity distributions → drift score close to 1.
- Verify that sample M pairs are drawn without replacement and within array bounds.

**Dimension-wise tests:**
- Two identical sets → dimension-wise drift score = 0.
- Sets where one dimension has a shifted mean → score reflects the shifted dimension.
- KS statistic computation: for two sets of [0.0, 0.5, 1.0] and [0.3, 0.6, 0.9] in one dimension, the maximum CDF difference is 0.33; verify this is correctly computed.

**MMD tests:**
- Two sets of identical vectors → MMD ≈ 0 (may not be exactly 0 due to random Fourier features; verify score < 0.02).
- Two sets drawn from clearly different distributions → MMD score > 0.2.
- Verify bandwidth σ is set to the approximate median pairwise distance.
- Verify that using `mmdRandomFeatures = 1000` vs. `100` produces consistent scores (within 0.05 for the same inputs with fixed random seed).

**Composite score tests:**
- Verify weighted average formula with default weights against a manually computed expected value.
- Verify that disabling a method redistributes its weight proportionally to the remaining methods.
- Verify severity classification: score 0.03 → `none`, 0.10 → `low`, 0.30 → `medium`, 0.50 → `high`, 0.80 → `critical`.

**Alert tests:**
- `monitor.alert(report)` returns `false` when `severity < alertSeverity`.
- `monitor.alert(report)` returns `true` when `severity >= alertSeverity`.
- `monitor.alert(report)` returns `true` when a per-method score exceeds its threshold even if severity is below `alertSeverity`.
- `onDrift` callback is called when alert fires and not called when alert does not fire.
- `onDrift` async errors are swallowed without crashing.

**Serialization tests:**
- `saveSnapshot` writes valid JSON parseable back to a `Snapshot`.
- `loadSnapshot` reads back the same snapshot (deep equality).
- `loadSnapshot` throws `DriftError('INVALID_SNAPSHOT')` for malformed JSON.
- `loadSnapshot` throws `DriftError('INVALID_SNAPSHOT')` for JSON that is missing required fields (centroid, modelId, etc.).

**Model change flag tests:**
- `compare(snapshotA, snapshotB)` where `snapshotA.modelId !== snapshotB.modelId` → `modelChanged: true`, `severity: 'critical'`.
- `compare(snapshotA, snapshotB)` where model IDs are identical → `modelChanged: false` (unless canary score indicates otherwise).

### Integration Tests

- **End-to-end drift detection**: Generate two synthetic embedding sets from known distributions (Gaussian blobs centered at different points). Verify that `compare()` produces a composite score that correctly reflects the distance between the two distributions.
- **No-drift baseline**: Generate two samples from the same distribution. Verify composite score < 0.10 and severity is `none` or `low`.
- **Full model change simulation**: Create embeddings for 100 texts using two different random projection matrices (simulating two different embedding models). Verify composite score > 0.50 and severity is `high` or `critical`.
- **Canary round-trip**: Call `checkCanaries(fn)` with a deterministic embed function (returns fixed vectors). On second call with the same function, verify drift score < 0.01. On second call with a different function (simulating model change), verify `modelChanged: true`.
- **CLI integration**: Invoke the CLI via `child_process.execSync` in tests. Verify exit codes for no-drift, high-drift, and model-change scenarios.

### Test Data

Tests use three categories of data:

1. **Deterministic synthetic embeddings**: Small (2-5 dimensional) embedding vectors with analytically known properties. Used for testing individual computation steps (centroid, variance, pairwise similarity, KS statistics) where the correct answer can be verified by hand.

2. **Synthetic high-dimensional blobs**: 1536-dimensional vectors generated by random projection from 2D Gaussian blobs with known cluster structure. Used for integration tests of drift detection sensitivity. Stored as pre-computed fixtures to avoid randomness in tests.

3. **Model change simulation**: Two sets of 1536-dimensional embeddings produced by different random projection matrices (seeded so they are deterministic). Used to simulate what happens when the embedding model changes. The two projection matrices produce embedding spaces that are, by construction, uncorrelated -- analogous to two completely different models.

---

## 15. Performance

### Snapshot Creation

Snapshot creation is dominated by the pairwise similarity estimation step. For n input vectors and d dimensions:

| Component | Complexity | Time (n=10k, d=1536) |
|---|---|---|
| Centroid computation | O(n * d) | ~0.5s |
| Per-dimension variance | O(n * d) | ~0.5s |
| Sample M pairs for pairwise sim. | O(M * d) where M=500 | ~0.01s |
| Reservoir sampling sampleVectors | O(n) | negligible |
| Total | O(n * d) | ~1-2s |

For 1,000 vectors at 1536 dimensions, snapshot creation takes approximately 100-200ms. For 100,000 vectors, approximately 10-20 seconds.

### Snapshot Comparison

Comparison operates primarily on the stored snapshot statistics (centroid, variance, sample vectors), not on the full input set. The cost is dominated by MMD and dimension-wise KS computation over the stored sample vectors:

| Component | Complexity | Time (sampleSize=50, d=1536, R=100) |
|---|---|---|
| Canary comparison | O(N * d) where N=25 | < 1ms |
| Centroid drift | O(d) | < 1ms |
| Pairwise similarity shift | O(1) (pre-computed in snapshot) | < 1ms |
| Dimension-wise KS | O(d * s * log(s)) where s=50 | ~20ms |
| MMD (random Fourier features) | O(s * R * d) where R=100 | ~15ms |
| Total | | ~40ms |

Snapshot comparison is designed to be fast: under 100ms for default settings. Increasing `sampleSize` to 200 increases comparison time to approximately 150ms. Increasing `mmdRandomFeatures` to 500 adds approximately 60ms.

### Canary Check

A canary check embeds N canary texts (one API call) and computes N cosine similarities:

| Component | Time |
|---|---|
| API call (25 texts) | 50-500ms (network-dependent) |
| Cosine similarity computation | < 1ms |
| Total | 50-500ms (API latency dominates) |

The API call is the only non-trivial cost. If canary texts are routed through `embed-cache`, subsequent canary checks (same model) return from cache in < 1ms.

### Memory Footprint

| Component | Memory |
|---|---|
| Centroid (1536 dims) | ~12 KB |
| Variance (1536 dims) | ~12 KB |
| Sample vectors (50 × 1536 dims) | ~600 KB |
| Canary embeddings (25 × 1536 dims) | ~300 KB |
| Per snapshot total | ~1 MB |

Two snapshots in memory for comparison: ~2 MB. For dimensionalities of 3072, double these estimates. `embed-drift` is designed for lightweight operation -- it does not hold the full embedding corpus in memory.

---

## 16. Dependencies

### Runtime Dependencies

**Zero mandatory runtime dependencies.** All drift detection methods (centroid drift, pairwise similarity, dimension-wise statistics, MMD with random Fourier features) are implemented in pure TypeScript using typed arrays. No native modules, no WASM.

Node.js built-ins used:

- `node:crypto` -- UUID v4 generation for snapshot and report IDs
- `node:fs` -- filesystem snapshot serialization in `saveSnapshot` / `loadSnapshot`
- `node:path` -- path utilities in CLI

### Dev Dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linting |
| `@types/node` | Node.js type definitions |

---

## 17. File Structure

```
embed-drift/
├── src/
│   ├── index.ts                      # Public API exports: createMonitor, types, errors
│   ├── monitor.ts                    # DriftMonitor class: snapshot, compare, check, checkCanaries
│   ├── snapshot.ts                   # Snapshot creation: centroid, variance, pairwise stats, sampling
│   ├── methods/
│   │   ├── canary.ts                 # Canary-based detection: cosine similarity comparison
│   │   ├── centroid.ts               # Centroid drift: cosine distance between centroids
│   │   ├── pairwise.ts               # Pairwise similarity shift: mean/std comparison
│   │   ├── dimension-wise.ts         # Dimension-wise statistics: Cohen's d, per-dim KS
│   │   └── mmd.ts                    # MMD approximation: random Fourier features
│   ├── composite.ts                  # Composite score computation and severity classification
│   ├── alert.ts                      # Alert threshold evaluation and onDrift dispatch
│   ├── canary-corpus.ts              # Built-in default canary texts (25 diverse sentences)
│   ├── serialization.ts              # saveSnapshot, loadSnapshot, schema validation
│   ├── math.ts                       # Shared math utilities: cosine similarity, dot product, L2 norm
│   ├── cli.ts                        # CLI entry point (embed-drift command)
│   └── types.ts                      # All TypeScript type definitions
├── src/__tests__/
│   ├── snapshot.test.ts              # Snapshot creation unit tests
│   ├── monitor.test.ts               # DriftMonitor integration: compare, check, alert, setBaseline
│   ├── methods/
│   │   ├── canary.test.ts            # Canary comparison unit tests
│   │   ├── centroid.test.ts          # Centroid drift unit tests
│   │   ├── pairwise.test.ts          # Pairwise similarity shift unit tests
│   │   ├── dimension-wise.test.ts    # Dimension-wise statistics unit tests
│   │   └── mmd.test.ts               # MMD approximation unit tests
│   ├── composite.test.ts             # Composite score and severity classification tests
│   ├── alert.test.ts                 # Alert threshold and callback dispatch tests
│   ├── serialization.test.ts         # saveSnapshot, loadSnapshot, validation tests
│   ├── math.test.ts                  # Math utility unit tests (cosine sim, norm, etc.)
│   └── integration/
│       ├── drift-detection.test.ts   # End-to-end: no-drift baseline, model change simulation
│       └── cli.test.ts               # CLI invocation via child_process, exit code verification
├── src/__fixtures__/
│   ├── same-distribution.json        # Pre-computed pair of embedding sets from same distribution
│   ├── different-distribution.json   # Pre-computed pair from different distributions
│   └── model-change-simulation.json  # Pre-computed pair simulating model change
├── package.json
├── tsconfig.json
├── README.md
└── SPEC.md
```

---

## 18. Implementation Roadmap

### Phase 1: Core Statistical Engine (Week 1)

The foundation of `embed-drift` is the statistical computation layer. This phase implements:

1. **`math.ts`**: Shared math utilities -- cosine similarity, L2 norm, dot product, element-wise mean, element-wise variance. All operations use typed arrays (`Float64Array`) for performance. Unit-tested against hand-computed expected values.

2. **`snapshot.ts`**: Snapshot creation -- centroid computation, per-dimension variance, pairwise cosine similarity estimation (reservoir-sampled pairs), histogram construction, reservoir sampling for sample vectors. Unit-tested with small synthetic inputs.

3. **`methods/centroid.ts`**: Centroid drift computation -- cosine distance between two centroid vectors. Trivial implementation; primarily needs the normalization formula to be correct.

4. **`methods/pairwise.ts`**: Pairwise similarity shift -- compare the pre-computed pairwise statistics stored in two snapshots (mean, std). Compute normalized difference.

5. **`methods/dimension-wise.ts`**: Dimension-wise statistics -- Cohen's d per dimension (using centroid means and variance arrays), per-dimension KS statistic over sample vectors. Mean across dimensions.

6. **`methods/mmd.ts`**: MMD approximation -- random Fourier features, bandwidth estimation (median heuristic on sample vector pairwise distances), feature map computation, MMD^2 estimation. Verify the approximation converges with more features using synthetic data.

### Phase 2: Canary System (Week 1-2)

1. **`canary-corpus.ts`**: The 25 built-in canary texts as a frozen constant array.

2. **`methods/canary.ts`**: Per-canary cosine similarity, mean and minimum computation, `modelChanged` determination against threshold.

3. **`monitor.ts`** (canary methods): `checkCanaries(embedFn)`, `setCanaryBaseline(embeddings)`, `getCanaryTexts()`, canary baseline initialization on first call.

### Phase 3: Monitor and Composite (Week 2)

1. **`composite.ts`**: Weighted composite score from per-method scores. Weight normalization when methods are disabled. Severity classification. `methodChanged` flag propagation.

2. **`alert.ts`**: Threshold evaluation against per-method thresholds and `alertSeverity`. `onDrift` callback dispatch. Error swallowing for async callbacks.

3. **`monitor.ts`** (full implementation): `createMonitor(options)`, `snapshot()`, `compare()`, `setBaseline()`, `check()`, `alert()`. Wire together all method modules, composite computation, and alert dispatch.

### Phase 4: Serialization and CLI (Week 2-3)

1. **`serialization.ts`**: `saveSnapshot`, `loadSnapshot`, JSON schema validation. Verify round-trip fidelity (save then load produces structurally equal snapshot).

2. **`cli.ts`**: Three commands -- `snapshot`, `compare`, `canary`. Argument parsing (using Node.js `process.argv` directly, no external parser dependency). Human-readable and JSON output formats. Exit code logic.

### Phase 5: Tests and Documentation (Week 3)

1. Full unit test suite for all methods and components.
2. Integration tests with pre-computed fixture data.
3. CLI tests via `child_process.execSync`.
4. README with quick-start, API reference, and common use-case examples.
5. Performance validation: measure snapshot creation and comparison times against the targets in Section 15.

---

## 19. Example Use Cases

### Use Case 1: Model Migration Detection

**Scenario**: A team is migrating their RAG pipeline from `text-embedding-ada-002` to `text-embedding-3-small`. They want to detect the migration before any degraded results reach users.

**Solution**: Establish a canary baseline under `ada-002`. On each pipeline run, re-embed the canary corpus. When the infrastructure migrates to `text-embedding-3-small`, the canary check fires a `critical` alert, the `onDrift` callback halts new indexing, and the team is notified to run the full re-indexing pipeline before resuming retrieval.

**Configuration**: `alertSeverity: 'high'`, `canaryThreshold: 0.95`, `onDrift: triggerPageDuty`.

### Use Case 2: Production Distribution Monitoring

**Scenario**: A customer support platform embeds and indexes support tickets. Over time, new product lines and features cause the distribution of ticket content to shift. The team wants to know when this drift is significant enough to warrant a full re-indexing run (which improves retrieval quality by reflecting the current content distribution).

**Solution**: A weekly cron job takes a snapshot of the current week's embeddings and compares it to the snapshot from when the index was last rebuilt. When the composite drift score exceeds `medium` severity for three consecutive weeks, a Slack notification is sent to schedule re-indexing.

**Configuration**: `alertSeverity: 'medium'`, `onDrift: postToSlack`.

### Use Case 3: CI/CD Pre-Deployment Gate

**Scenario**: An AI infrastructure team maintains a shared embedding model. Before deploying a new model version, they want to programmatically quantify how different the new model's embeddings are from the current model's, and gate the deployment if the difference is high enough to require coordinated re-indexing of all downstream vector databases.

**Solution**: A CI step embeds a representative sample corpus (200 documents) with both the old and new model. `embed-drift compare` is run on the two snapshot files. If exit code 3 (model changed) or exit code 1 with `severity >= high`, the CI pipeline fails and posts a Slack message requesting that downstream teams re-index before the model deployment can proceed.

**CLI**: `embed-drift compare --a old-model-snapshot.json --b new-model-snapshot.json --alert-severity high`

### Use Case 4: Scheduled Health Check with Alert Integration

**Scenario**: A platform team runs a nightly health check on all their vector databases. They want to detect both model changes and content distribution drift, log both as structured JSON to their observability stack, and page on-call when severity is `high` or above.

**Solution**: A nightly job runs `monitor.check(sampleEmbeddings)` for each index. The `onDrift` callback ships the full `DriftReport` as a structured log event to their log aggregation system. A log-based alert rule pages on-call when the event's `severity` field is `high` or `critical`. The report JSON includes all per-method scores, enabling post-incident root cause analysis (was it model change? centroid shift? pairwise distribution change?).

**Configuration**: `alertSeverity: 'high'`, `onDrift: structuredLog`.

### Use Case 5: Stale Cache Detection

**Scenario**: A team uses `embed-cache` with a SQLite backend to cache embedding vectors across pipeline runs. When the embedding model is silently upgraded by the provider (same model name, different weights -- a known provider practice), the cache is still serving stale vectors but at very high hit rates, masking the problem.

**Solution**: The pipeline runs `monitor.checkCanaries(embedFn)` before each indexing job. The embed function is the same function used to populate the cache (so canary texts are served from cache if they were recently embedded). On the first run after the silent model upgrade, the cached canary embeddings no longer match -- the cosine similarity drops below threshold. The `onDrift` callback calls `cache.clear()` to invalidate all stale entries and re-embeds the corpus with the new model.

**Configuration**: `onDrift: async (r) => { if (r.modelChanged) await cache.clear(); }`
