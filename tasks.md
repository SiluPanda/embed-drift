# embed-drift — Task Breakdown

## Phase 1: Project Scaffolding & Types

- [x] **Define all TypeScript types in `src/types.ts`** — Create the full type definitions file including: `EmbedFn`, `DriftMonitorOptions`, `SnapshotOptions`, `CheckOptions`, `MethodThresholds`, `MethodWeights`, `DriftSeverity`, `MethodResult`, `Snapshot`, `DriftReport`, `CanaryReport`, `DriftMonitor` interface, and `enabledMethods` shape. All types must match the spec exactly (Section 9). | Status: done

- [x] **Implement `DriftError` class in `src/errors.ts`** — Create a custom error class extending `Error` with a `code` property. Supported codes: `EMPTY_INPUT`, `INCONSISTENT_DIMENSIONS`, `INCOMPATIBLE_DIMENSIONS`, `NO_BASELINE`, `INVALID_SNAPSHOT`, `NO_CANARY_BASELINE`, `EMBED_FN_FAILED`. | Status: done

- [x] **Update `package.json` with dev dependencies** — Add `typescript`, `vitest`, `eslint`, `@types/node` as dev dependencies. Ensure `engines.node` is `>=18`. | Status: done

- [x] **Add CLI bin entry to `package.json`** — Add `"bin": { "embed-drift": "dist/cli.js" }` so the CLI is available after global install or via npx. | Status: done

- [x] **Set up public API exports in `src/index.ts`** — Export `createMonitor`, all public types (`Snapshot`, `DriftReport`, `CanaryReport`, `DriftMonitor`, `DriftMonitorOptions`, `SnapshotOptions`, `CheckOptions`, `EmbedFn`, `DriftSeverity`, `MethodResult`, `MethodThresholds`, `MethodWeights`), `DriftError`, and `DEFAULT_CANARY_TEXTS`. | Status: done

---

## Phase 2: Core Math Utilities (`src/math.ts`)

- [ ] **Implement `dotProduct(a, b)` function** — Compute the dot product of two number arrays of equal length. Use a simple loop for clarity and correctness. | Status: not_done

- [ ] **Implement `l2Norm(v)` function** — Compute the L2 (Euclidean) norm of a vector: `sqrt(sum(v[i]^2))`. | Status: not_done

- [ ] **Implement `cosineSimilarity(a, b)` function** — Compute `dot(a, b) / (norm(a) * norm(b))`. Handle the zero-norm edge case (return 0 if either vector is all zeros). | Status: not_done

- [ ] **Implement `cosineDistance(a, b)` function** — Compute `1 - cosineSimilarity(a, b)`. Clamp result to [0, 2] range. | Status: not_done

- [ ] **Implement `elementWiseMean(vectors)` function** — Compute the centroid of a set of vectors by averaging each dimension across all vectors. Returns a number array of the same dimensionality. | Status: not_done

- [ ] **Implement `elementWiseVariance(vectors, mean)` function** — Compute the per-dimension variance given a set of vectors and their precomputed mean. Uses the population variance formula. | Status: not_done

- [ ] **Implement `reservoirSample(items, k)` function** — Implement reservoir sampling (Algorithm R) to select k items uniformly at random from an array of unknown or large size, in a single pass. | Status: not_done

- [ ] **Write unit tests for math utilities (`src/__tests__/math.test.ts`)** — Test dotProduct, l2Norm, cosineSimilarity, cosineDistance, elementWiseMean, elementWiseVariance, and reservoirSample with small hand-computed inputs. Verify edge cases: zero vectors, single-element vectors, identical vectors, orthogonal vectors, opposite vectors. | Status: not_done

---

## Phase 3: Snapshot Creation (`src/snapshot.ts`)

- [ ] **Implement `createSnapshot()` core function** — Accept an array of embedding vectors (`number[][]`), a `modelId`, and `SnapshotOptions`. Validate inputs (at least 2 vectors, consistent dimensionality). Compute centroid, variance, pairwise similarity stats, similarity histogram, and sample vectors. Return a `Snapshot` object with UUID, timestamp, and all computed fields. | Status: not_done

- [ ] **Implement input validation in snapshot creation** — Throw `DriftError('EMPTY_INPUT')` if embeddings array is empty or has fewer than 2 vectors. Throw `DriftError('INCONSISTENT_DIMENSIONS')` if vectors have different lengths. | Status: not_done

- [ ] **Implement pairwise cosine similarity estimation** — Sample `M = min(500, n*(n-1)/2)` random pairs from input vectors. Compute cosine similarity for each pair. Record mean, standard deviation, and a 20-bin histogram from -1.0 to 1.0 (each bin stores the fraction of pairs in that range). | Status: not_done

- [ ] **Implement reservoir sampling for `sampleVectors`** — Store `min(sampleSize, n)` randomly selected vectors from the input. Default `sampleSize` is 50. Use reservoir sampling for uniform random selection. | Status: not_done

- [ ] **Implement similarity histogram construction** — Create 20 bins spanning [-1.0, 1.0]. Each bin covers a range of 0.1. Store the fraction of sampled pairwise similarities that fall in each bin. | Status: not_done

- [ ] **Implement UUID v4 generation using `node:crypto`** — Use `crypto.randomUUID()` to generate unique IDs for snapshots and reports. | Status: not_done

- [ ] **Support `includeCanaries` option in snapshot** — When `includeCanaries: true` and an `embedFn` is provided, embed the configured canary texts and store the resulting vectors in `snapshot.canaryEmbeddings`. Throw `DriftError` if `includeCanaries` is true but no `embedFn` is available. Note: `snapshot()` becomes async when `includeCanaries` is true. | Status: not_done

- [ ] **Support `metadata` option in snapshot** — Attach caller-provided key-value metadata to the snapshot object. Default to empty object. | Status: not_done

- [ ] **Write unit tests for snapshot creation (`src/__tests__/snapshot.test.ts`)** — Test: correct modelId, dimensionality, centroid (verify element-wise mean for 3-vector 2-dimension input), correct variance, sampleVectors length = min(sampleSize, n), pairwise similarity stats are within expected bounds, histogram sums to ~1.0. Test error cases: empty array, single vector, inconsistent dimensions. | Status: not_done

---

## Phase 4: Drift Detection Methods

### Method 1: Canary-Based Detection (`src/methods/canary.ts`)

- [ ] **Implement canary comparison function** — Given two arrays of canary embeddings (new and reference), compute per-canary cosine similarity, mean similarity, minimum similarity, and drift score (`1 - meanSimilarity`). Determine `modelChanged` based on whether mean similarity is below the configured `canaryThreshold` (default 0.95). | Status: not_done

- [ ] **Return a `MethodResult` from canary comparison** — Include `score` (drift score), `computed: true`, `interpretation` (human-readable string), and `details` containing `meanSimilarity`, `minSimilarity`, and `perCanarySimilarities`. | Status: not_done

- [ ] **Write unit tests for canary comparison (`src/__tests__/methods/canary.test.ts`)** — Test: identical embeddings produce drift score 0; orthogonal embeddings produce high drift score; mean similarity below threshold sets modelChanged to true; per-canary similarities are correctly computed. | Status: not_done

### Method 2: Centroid Drift (`src/methods/centroid.ts`)

- [ ] **Implement centroid drift computation** — Compute cosine distance between two snapshot centroids. Return normalized score in [0, 1] (clamp cosine distance which can be up to 2.0 for opposite vectors). | Status: not_done

- [ ] **Return a `MethodResult` from centroid drift** — Include score, computed flag, interpretation, and details (raw cosine distance, cosine similarity). | Status: not_done

- [ ] **Write unit tests for centroid drift (`src/__tests__/methods/centroid.test.ts`)** — Test: identical centroids produce score 0; centroid [1,0] vs [0,1] (orthogonal) produces score 1.0; centroid [1,0] vs [-1,0] (opposite) produces score clamped to 1.0. | Status: not_done

### Method 3: Pairwise Cosine Similarity Distribution Shift (`src/methods/pairwise.ts`)

- [ ] **Implement pairwise similarity shift computation** — Compare `meanPairwiseSimilarity` and `stdPairwiseSimilarity` between two snapshots. Compute `mean_diff = |mean_A - mean_B|` and `std_diff = |std_A - std_B|`. Normalize using the formula: `score = normalize(mean_diff + 0.5 * std_diff)` where a mean shift of 0.1 maps to approximately 0.3 and a shift of 0.2 saturates at 1.0. Clamp to [0, 1]. | Status: not_done

- [ ] **Return a `MethodResult` from pairwise shift** — Include score, computed flag, interpretation, and details (mean_diff, std_diff, raw values from both snapshots). | Status: not_done

- [ ] **Write unit tests for pairwise similarity shift (`src/__tests__/methods/pairwise.test.ts`)** — Test: identical pairwise stats produce score ~0; large mean difference produces high score; verify normalization formula with known inputs. | Status: not_done

### Method 4: Dimension-Wise Statistics (`src/methods/dimension-wise.ts`)

- [ ] **Implement per-dimension Cohen's d computation** — For each dimension i, compute `mean_diff[i] = (centroid_A[i] - centroid_B[i])^2`, pooled variance, and `dim_score[i] = mean_diff[i] / var_pooled[i]`. Average across dimensions and normalize: `score = min(mean_cohens_d / 2.0, 1.0)`. | Status: not_done

- [ ] **Implement per-dimension KS-like statistic** — For each dimension, extract that dimension's values from sampleVectors of both snapshots. Sort both arrays. Compute the maximum absolute difference between empirical CDFs. Average the per-dimension KS statistics across all dimensions. | Status: not_done

- [ ] **Combine Cohen's d and KS into a single dimension-wise score** — Blend the mean Cohen's d score and the mean KS score into a single normalized dimension-wise drift score in [0, 1]. | Status: not_done

- [ ] **Return a `MethodResult` from dimension-wise analysis** — Include combined score, computed flag, interpretation, and details (mean Cohen's d, mean KS statistic, number of dimensions analyzed, top-drifted dimensions). | Status: not_done

- [ ] **Write unit tests for dimension-wise statistics (`src/__tests__/methods/dimension-wise.test.ts`)** — Test: identical sets produce score 0; one shifted dimension produces a score reflecting that shift; KS statistic for [0.0, 0.5, 1.0] vs [0.3, 0.6, 0.9] has max CDF difference ~0.33; verify Cohen's d computation against hand-calculated values. | Status: not_done

### Method 5: MMD Approximation (`src/methods/mmd.ts`)

- [ ] **Implement median heuristic bandwidth estimation** — Compute pairwise L2 distances between a combined sample of vectors from both snapshots. Set bandwidth sigma to the median pairwise distance. Cache the computation per comparison. | Status: not_done

- [ ] **Implement random Fourier feature map** — Draw R random frequency vectors from `N(0, (1/sigma^2) * I)` and R random bias terms from `Uniform(0, 2*pi)`. For each embedding x, compute `phi(x) = sqrt(2/R) * cos(omega^T * x + b)`. | Status: not_done

- [ ] **Implement MMD^2 estimation** — Compute mean feature vectors `mu_A` and `mu_B` for the two sample sets. Compute `MMD^2 = ||mu_A - mu_B||^2`. | Status: not_done

- [ ] **Compute final MMD drift score** — Take `sqrt(MMD^2)`, divide by calibration constant, and clamp to [0, 1]. | Status: not_done

- [ ] **Support configurable `mmdRandomFeatures` parameter** — Default to 100 random features. Allow overriding via monitor options. | Status: not_done

- [ ] **Return a `MethodResult` from MMD** — Include score, computed flag, interpretation, and details (raw MMD^2, bandwidth sigma, number of random features used). | Status: not_done

- [ ] **Write unit tests for MMD (`src/__tests__/methods/mmd.test.ts`)** — Test: identical vector sets produce MMD score < 0.02; clearly different distributions produce score > 0.2; verify bandwidth is approximately the median pairwise distance; verify that R=1000 vs R=100 produces scores within 0.05 of each other for same inputs (use fixed seed). | Status: not_done

---

## Phase 5: Composite Score & Severity (`src/composite.ts`)

- [ ] **Implement weighted composite score computation** — Compute `composite = sum(weight[method] * score[method]) / sum(weight[method])` using the configured method weights. Default weights: canary=0.35, centroid=0.15, pairwise=0.20, dimensionWise=0.15, mmd=0.15. | Status: not_done

- [ ] **Implement weight renormalization for disabled/unavailable methods** — If a method is disabled or its data is unavailable (e.g., no canary embeddings), exclude it from the weighted average and renormalize remaining weights to sum to 1. | Status: not_done

- [ ] **Implement severity classification function** — Map composite score to severity: 0.00-0.05 = `none`, 0.05-0.20 = `low`, 0.20-0.40 = `medium`, 0.40-0.70 = `high`, 0.70-1.00 = `critical`. Override to `critical` when `modelChanged` is true regardless of score. | Status: not_done

- [ ] **Write unit tests for composite score (`src/__tests__/composite.test.ts`)** — Test: verify weighted average with default weights against manually computed value; verify weight renormalization when a method is disabled; verify severity bands: 0.03 = none, 0.10 = low, 0.30 = medium, 0.50 = high, 0.80 = critical; verify modelChanged always produces critical. | Status: not_done

---

## Phase 6: Alert System (`src/alert.ts`)

- [ ] **Implement alert threshold evaluation** — Return `true` if: `severity >= alertSeverity` OR any per-method score exceeds its configured threshold in `thresholds`. | Status: not_done

- [ ] **Implement `onDrift` callback dispatch** — When an alert fires, invoke the `onDrift` callback with the full `DriftReport` or `CanaryReport`. Support both sync and async callbacks. Fire-and-forget for async (do not await). Swallow errors thrown by the callback. | Status: not_done

- [ ] **Implement the `monitor.alert(report)` public method** — Accept a `DriftReport` or `CanaryReport`, evaluate against configured thresholds and severity, and return a boolean. This method does NOT invoke the callback; it only evaluates the threshold. | Status: not_done

- [ ] **Write unit tests for alert system (`src/__tests__/alert.test.ts`)** — Test: returns false when severity < alertSeverity; returns true when severity >= alertSeverity; returns true when a per-method score exceeds its threshold even if severity is below alertSeverity; onDrift callback is called when alert fires; onDrift callback is NOT called when alert does not fire; async onDrift errors are swallowed. | Status: not_done

---

## Phase 7: Canary Corpus (`src/canary-corpus.ts`)

- [ ] **Define the 25 built-in default canary texts** — Create a frozen constant array (`DEFAULT_CANARY_TEXTS`) containing the 25 diverse English texts specified in the spec (Section 7): 3 technical, 3 scientific, 3 legal, 3 casual, 3 news, 3 medical, 2 creative, 2 mathematical, 2 instructional, 1 philosophical. | Status: not_done

- [ ] **Export the canary corpus** — Export `DEFAULT_CANARY_TEXTS` for use by the monitor and for direct consumer access. Freeze the array with `Object.freeze` to prevent mutation. | Status: not_done

---

## Phase 8: DriftMonitor Implementation (`src/monitor.ts`)

- [ ] **Implement `createMonitor(options)` factory function** — Validate required `modelId` option. Apply defaults for all optional fields: `canaryTexts=[]`, `replaceDefaultCanaries=false`, `canaryThreshold=0.95`, `alertSeverity='high'`, `thresholds={}`, `methodWeights` defaults, `enabledMethods` all true, `mmdRandomFeatures=100`, `pairwiseSamplePairs=500`. Return a `DriftMonitor` object. | Status: not_done

- [ ] **Implement canary text resolution** — If `replaceDefaultCanaries` is false, concatenate `DEFAULT_CANARY_TEXTS` with custom `canaryTexts`. If true, use only the custom texts. | Status: not_done

- [ ] **Implement `monitor.snapshot(embeddings, options?)` method** — Delegate to the `createSnapshot` function from `snapshot.ts`. Pass through the monitor's modelId and the caller's options. Return a `Snapshot`. | Status: not_done

- [ ] **Implement `monitor.compare(snapshotA, snapshotB)` method** — Check dimensionality compatibility (throw `DriftError('INCOMPATIBLE_DIMENSIONS')` if different). Check model IDs for mismatch. Run each enabled drift detection method. Compute composite score and severity. Evaluate alert thresholds. Dispatch `onDrift` callback if alert fires. Record timing (`durationMs`). Return a `DriftReport` with all fields populated. | Status: not_done

- [ ] **Implement model ID mismatch detection in `compare()`** — If `snapshotA.modelId !== snapshotB.modelId`, set `modelChanged: true` and severity to `critical`. Still compute all other scores for informational purposes. | Status: not_done

- [ ] **Implement `monitor.setBaseline(snapshot)` method** — Store the snapshot in the monitor's internal state for use by `check()`. | Status: not_done

- [ ] **Implement `monitor.getBaseline()` method** — Return the currently stored baseline snapshot, or `undefined` if none is set. | Status: not_done

- [ ] **Implement `monitor.check(embeddings, options?)` method** — Throw `DriftError('NO_BASELINE')` if no baseline is set. Create a new snapshot from the provided embeddings. Call `compare(baseline, newSnapshot)` and return the `DriftReport`. | Status: not_done

- [ ] **Implement `monitor.checkCanaries(embedFn)` method** — If no canary reference embeddings exist, embed all canary texts via `embedFn`, store as reference, and return a `CanaryReport` with `isInitialBaseline: true` and `driftScore: 0`. If reference exists, re-embed canary texts, compute per-canary similarities, mean/min similarity, drift score, and `modelChanged` flag. Wrap `embedFn` call in try/catch and throw `DriftError('EMBED_FN_FAILED')` on failure. Evaluate alert thresholds and dispatch `onDrift` if appropriate. Return `CanaryReport`. | Status: not_done

- [ ] **Implement `monitor.setCanaryBaseline(canaryEmbeddings)` method** — Explicitly set the canary reference embeddings without calling `checkCanaries`. Validates that the array is non-empty. | Status: not_done

- [ ] **Implement `monitor.getCanaryTexts()` method** — Return the resolved canary text array (built-in + custom, or custom-only if replaceDefaultCanaries is true). | Status: not_done

- [ ] **Implement `monitor.alert(report)` method** — Delegate to the alert evaluation logic in `alert.ts`. Accept both `DriftReport` and `CanaryReport`. Return boolean. | Status: not_done

- [ ] **Implement `DriftReport` summary generation** — Generate a human-readable `summary` string for each `DriftReport` that describes the drift findings, severity, and recommended action. | Status: not_done

- [ ] **Write integration tests for DriftMonitor (`src/__tests__/monitor.test.ts`)** — Test the full workflow: createMonitor, snapshot, setBaseline, check, compare, checkCanaries, setCanaryBaseline, alert, getBaseline, getCanaryTexts. Test error cases: check without baseline, incompatible dimensions. Test onDrift callback invocation. Test method disabling. Test custom weights. | Status: not_done

---

## Phase 9: Serialization (`src/serialization.ts`)

- [ ] **Implement `saveSnapshot(snapshot, filePath)` function** — Write a snapshot as pretty-printed JSON to the specified file path using `node:fs` synchronous API (`writeFileSync`). | Status: not_done

- [ ] **Implement `loadSnapshot(filePath)` function** — Read a JSON file from the specified path, parse it, and validate the snapshot schema. Return a `Snapshot` object. Throw `DriftError('INVALID_SNAPSHOT')` if the file is not valid JSON or is missing required fields. | Status: not_done

- [ ] **Implement snapshot schema validation** — Validate all required fields: `id` (string), `createdAt` (string), `modelId` (string), `dimensionality` (number), `sampleCount` (number), `centroid` (number array), `variance` (number array), `meanPairwiseSimilarity` (number), `stdPairwiseSimilarity` (number), `similarityHistogram` (number array of length 20), `sampleVectors` (array of number arrays). Validate that `centroid` and `variance` lengths match `dimensionality`. | Status: not_done

- [ ] **Write unit tests for serialization (`src/__tests__/serialization.test.ts`)** — Test: saveSnapshot writes valid JSON; loadSnapshot reads back the same snapshot (deep equality round-trip); loadSnapshot throws INVALID_SNAPSHOT for malformed JSON; loadSnapshot throws INVALID_SNAPSHOT for JSON missing required fields (centroid, modelId, etc.); loadSnapshot throws INVALID_SNAPSHOT for JSON with wrong field types. | Status: not_done

---

## Phase 10: CLI (`src/cli.ts`)

- [ ] **Implement CLI argument parser** — Parse `process.argv` directly (no external dependency). Support the three subcommands: `snapshot`, `compare`, `canary`. Parse all flags specified in the spec (Section 12). Show usage help when invoked with no arguments or `--help`. | Status: not_done

- [ ] **Implement `embed-drift snapshot` command** — Read a JSON file of embedding vectors from `--input`. Create a snapshot with `--model`, `--sample-size`, and `--metadata` options. Write the snapshot JSON to `--output` (or stdout if not specified). Support `--format summary` for human-readable output and `--format json` (default) for JSON output. | Status: not_done

- [ ] **Implement `embed-drift compare` command** — Load two snapshot files from `--a` and `--b`. Create a monitor and run `compare()`. Support `--format summary` (default) and `--format json` for output. Support `--output` for writing to a file. Support `--alert-severity` to configure the exit code threshold. Support `--no-canary` and `--no-mmd` flags to skip methods. | Status: not_done

- [ ] **Implement `embed-drift canary` command** — Support `--action establish` (embed canaries, save reference to `--reference` path) and `--action check` (re-embed canaries, compare to reference). Support `--model`, `--provider` (openai/cohere), `--api-key` (or env vars OPENAI_API_KEY/COHERE_API_KEY), `--canary-texts` (path to JSON string array), and `--format`. | Status: not_done

- [ ] **Implement CLI exit code logic** — Exit code 0: no significant drift. Exit code 1: drift at or above alert severity. Exit code 2: configuration/usage error. Exit code 3: model change detected. | Status: not_done

- [ ] **Implement human-readable summary output for `compare` command** — Format output matching the spec examples: snapshot metadata, model changed status, per-method drift scores with threshold indicators, composite score, severity, and interpretation/action text. | Status: not_done

- [ ] **Implement human-readable summary output for `snapshot` command** — Format output matching the spec example: model, vector count, dimensions, first 5 centroid values, mean pairwise similarity with std, sample size, output path. | Status: not_done

- [ ] **Implement human-readable summary output for `canary` command** — Format output for both `establish` (corpus size, model, reference save path) and `check` (mean similarity, range, drift score, model changed status, result message) actions. | Status: not_done

- [ ] **Add hashbang to CLI entry point** — Add `#!/usr/bin/env node` as the first line of `src/cli.ts` so it can be executed directly. | Status: not_done

- [ ] **Write CLI integration tests (`src/__tests__/integration/cli.test.ts`)** — Invoke the CLI via `child_process.execSync`. Test `snapshot` command with a fixture JSON file. Test `compare` command with two fixture snapshots (no-drift, high-drift, and model-change scenarios). Verify correct exit codes for each scenario. Test `--format json` and `--format summary` outputs. Test error exit code 2 for missing required options. | Status: not_done

---

## Phase 11: Test Fixtures

- [ ] **Generate `same-distribution.json` fixture** — Pre-compute two sets of 1536-dimensional embedding vectors drawn from the same distribution (same random seed, Gaussian blob). Store in `src/__fixtures__/same-distribution.json`. | Status: not_done

- [ ] **Generate `different-distribution.json` fixture** — Pre-compute two sets of 1536-dimensional embedding vectors drawn from different distributions (different Gaussian blob centers). Store in `src/__fixtures__/different-distribution.json`. | Status: not_done

- [ ] **Generate `model-change-simulation.json` fixture** — Pre-compute two sets of 1536-dimensional embeddings produced by different random projection matrices (seeded for determinism), simulating two different embedding models. Store in `src/__fixtures__/model-change-simulation.json`. | Status: not_done

---

## Phase 12: Integration Tests

- [ ] **Write end-to-end no-drift baseline test (`src/__tests__/integration/drift-detection.test.ts`)** — Generate two samples from the same distribution. Run `compare()`. Verify composite score < 0.10 and severity is `none` or `low`. | Status: not_done

- [ ] **Write end-to-end model change simulation test** — Create embeddings using two different random projection matrices (simulating two different models). Run `compare()`. Verify composite score > 0.50 and severity is `high` or `critical`. | Status: not_done

- [ ] **Write end-to-end canary round-trip test** — Call `checkCanaries(fn)` with a deterministic embed function. On second call with the same function, verify drift score < 0.01. On second call with a different function, verify `modelChanged: true`. | Status: not_done

- [ ] **Write end-to-end snapshot serialization round-trip test** — Create a snapshot, save it to a temp file, load it back, and verify deep equality. | Status: not_done

- [ ] **Write end-to-end check() workflow test** — Create a monitor, set a baseline snapshot, then call check() with new embeddings. Verify the returned DriftReport has all expected fields and reasonable scores. | Status: not_done

---

## Phase 13: Edge Cases & Error Handling

- [ ] **Handle edge case: all vectors are identical** — Snapshot creation should handle zero variance gracefully. Pairwise similarity should be 1.0 for all pairs. Cohen's d computation must not divide by zero (use epsilon in variance denominator). | Status: not_done

- [ ] **Handle edge case: very small sample sizes** — When fewer vectors than `sampleSize` are provided, store all vectors as sampleVectors. When only 2 vectors are provided, pairwise sampling should still work correctly. | Status: not_done

- [ ] **Handle edge case: canary embeddings missing from one snapshot** — When comparing two snapshots where only one has `canaryEmbeddings`, skip the canary method and renormalize composite weights. Do not throw an error. | Status: not_done

- [ ] **Handle edge case: all method scores are 0** — Composite score should be 0, severity should be `none`. No alert should fire. | Status: not_done

- [ ] **Handle `embedFn` failure in `checkCanaries`** — If the embed function throws, catch the error and rethrow as `DriftError('EMBED_FN_FAILED')` with the original error as the `cause`. | Status: not_done

- [ ] **Handle very high dimensional embeddings (3072+)** — Ensure all computations work correctly with large dimensions. No hardcoded dimension limits. | Status: not_done

- [ ] **Handle NaN and Infinity in computations** — Add guards against NaN/Infinity in cosine similarity (zero-norm vectors), variance ratios (zero variance), and MMD bandwidth (zero distances). Replace with safe defaults. | Status: not_done

---

## Phase 14: Performance Validation

- [ ] **Benchmark snapshot creation** — Measure snapshot creation time for n=1000 vectors at d=1536. Verify it completes in approximately 100-200ms. Measure for n=10000 and verify it completes in 1-3 seconds. | Status: not_done

- [ ] **Benchmark snapshot comparison** — Measure comparison time with default settings (sampleSize=50, d=1536, R=100). Verify it completes in under 100ms. | Status: not_done

- [ ] **Verify memory footprint** — Verify a single 1536-dimensional snapshot with 50 sample vectors and 25 canary embeddings fits in approximately 1 MB or less. | Status: not_done

---

## Phase 15: Documentation

- [x] **Write README.md** — Include: package description, installation instructions, quick-start examples (model migration detection, snapshot-based monitoring, CI/CD gate), full API reference for all public methods, CLI usage with all commands and flags, configuration reference table, integration examples with embed-cache/embed-cluster/model-price-registry. | Status: done

- [ ] **Add JSDoc comments to all public API functions and types** — Document every exported function, interface, and type with JSDoc comments matching the spec descriptions. Include parameter descriptions, return types, and example usage. | Status: not_done

---

## Phase 16: Build & Publish Preparation

- [ ] **Verify TypeScript compilation** — Run `npm run build` (`tsc`) and ensure zero errors. Verify `dist/` output includes `.js`, `.d.ts`, and `.d.ts.map` files for all source modules. | Status: not_done

- [ ] **Verify `npm run lint` passes** — Run ESLint on all source files and ensure zero errors/warnings (or only acceptable warnings). | Status: not_done

- [ ] **Verify `npm run test` passes** — Run `vitest run` and ensure all unit tests and integration tests pass. | Status: not_done

- [ ] **Verify package exports** — Import `embed-drift` from a test consumer script and verify that `createMonitor`, all types, `DriftError`, and `DEFAULT_CANARY_TEXTS` are accessible. | Status: not_done

- [ ] **Verify CLI binary works** — Run `npx embed-drift --help` (or via local bin link) and verify help output is displayed. Test all three commands with real arguments. | Status: not_done

- [ ] **Bump version in `package.json`** — Set the appropriate version before publishing (likely 0.1.0 for initial release or bump as needed). | Status: not_done
