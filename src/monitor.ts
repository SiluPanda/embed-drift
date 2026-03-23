import { randomUUID } from 'node:crypto';
import { DriftError } from './errors';
import { DEFAULT_CANARY_TEXTS } from './constants';
import type {
  DriftMonitor,
  DriftMonitorOptions,
  DriftReport,
  CanaryReport,
  Snapshot,
  SnapshotOptions,
  CheckOptions,
  MethodWeights,
  EmbedFn,
} from './types';
import { createSnapshot } from './snapshot';
import { computeCanaryDrift } from './methods/canary';
import { computeCentroidDrift } from './methods/centroid';
import { computePairwiseDrift } from './methods/pairwise';
import { computeDimensionWiseDrift } from './methods/dimension-wise';
import { computeMMDDrift } from './methods/mmd';
import { DEFAULT_METHOD_WEIGHTS, computeComposite, scoreSeverity } from './composite';
import { evaluateAlert, dispatchAlert } from './alert';
import { saveSnapshot, loadSnapshot } from './serialization';

export function createMonitor(options: DriftMonitorOptions): DriftMonitor {
  const {
    modelId,
    canaryTexts = [],
    replaceDefaultCanaries = false,
    canaryThreshold = 0.95,
    alertSeverity = 'high',
    thresholds = {},
    onDrift,
    methodWeights: userWeights,
    enabledMethods = {},
    mmdRandomFeatures = 100,
  } = options;

  const resolvedCanaryTexts: string[] = replaceDefaultCanaries
    ? [...canaryTexts]
    : [...DEFAULT_CANARY_TEXTS, ...canaryTexts];

  const weights: MethodWeights = {
    ...DEFAULT_METHOD_WEIGHTS,
    ...userWeights,
  };

  const enabled = {
    centroid: enabledMethods.centroid !== false,
    pairwise: enabledMethods.pairwise !== false,
    dimensionWise: enabledMethods.dimensionWise !== false,
    mmd: enabledMethods.mmd !== false,
  };

  let baseline: Snapshot | undefined;
  let canaryBaseline: number[][] | undefined;

  function snapshot(embeddings: number[][], snapshotOptions?: SnapshotOptions): Snapshot {
    return createSnapshot(embeddings, modelId, snapshotOptions);
  }

  function compare(snapshotA: Snapshot, snapshotB: Snapshot): DriftReport {
    const startTime = Date.now();

    if (snapshotA.dimensionality !== snapshotB.dimensionality) {
      throw new DriftError(
        `Incompatible snapshot dimensions: ${snapshotA.dimensionality} vs ${snapshotB.dimensionality}`,
        'INCOMPATIBLE_DIMENSIONS',
      );
    }

    const modelChanged = snapshotA.modelId !== snapshotB.modelId;

    // Run drift methods
    const centroidResult = enabled.centroid
      ? computeCentroidDrift(snapshotA, snapshotB)
      : { score: 0, computed: false, interpretation: 'Centroid method disabled.' };

    const pairwiseResult = enabled.pairwise
      ? computePairwiseDrift(snapshotA, snapshotB)
      : { score: 0, computed: false, interpretation: 'Pairwise method disabled.' };

    const dimensionWiseResult = enabled.dimensionWise
      ? computeDimensionWiseDrift(snapshotA, snapshotB)
      : { score: 0, computed: false, interpretation: 'Dimension-wise method disabled.' };

    const mmdResult = enabled.mmd
      ? computeMMDDrift(snapshotA, snapshotB, mmdRandomFeatures)
      : { score: 0, computed: false, interpretation: 'MMD method disabled.' };

    // Canary method: only runs when both snapshots have canary embeddings
    const hasCanaries =
      snapshotA.canaryEmbeddings !== undefined &&
      snapshotA.canaryEmbeddings.length > 0 &&
      snapshotB.canaryEmbeddings !== undefined &&
      snapshotB.canaryEmbeddings.length > 0;

    const canaryResult = hasCanaries
      ? computeCanaryDrift(
          snapshotB.canaryEmbeddings!,
          snapshotA.canaryEmbeddings!,
          canaryThreshold,
        )
      : { score: 0, computed: false, interpretation: 'Canary embeddings not available in snapshots.' };

    const methods = {
      canary: canaryResult,
      centroid: centroidResult,
      pairwise: pairwiseResult,
      dimensionWise: dimensionWiseResult,
      mmd: mmdResult,
    };

    const { score: compositeScore, effectiveWeights } = computeComposite(methods, weights);
    const severity = scoreSeverity(compositeScore, modelChanged);

    const durationMs = Date.now() - startTime;

    const summary = buildDriftSummary(compositeScore, severity, modelChanged, durationMs);

    const report: DriftReport = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      snapshotIds: [snapshotA.id, snapshotB.id],
      modelIds: [snapshotA.modelId, snapshotB.modelId],
      modelChanged,
      methods,
      composite: {
        score: compositeScore,
        severity,
        weights: effectiveWeights,
      },
      alerted: false,
      summary,
      durationMs,
    };

    // Set alerted before dispatching so the callback receives the correct value
    report.alerted = evaluateAlert(report, alertSeverity, thresholds);
    dispatchAlert(report, onDrift, alertSeverity, thresholds);

    return report;
  }

  function setBaseline(snap: Snapshot): void {
    baseline = snap;
  }

  function getBaseline(): Snapshot | undefined {
    return baseline;
  }

  function check(embeddings: number[][], checkOptions?: CheckOptions): DriftReport {
    if (baseline === undefined) {
      throw new DriftError(
        'No baseline snapshot set. Call setBaseline() before check().',
        'NO_BASELINE',
      );
    }
    const newSnapshot = createSnapshot(embeddings, modelId, checkOptions?.snapshotOptions);
    return compare(baseline, newSnapshot);
  }

  async function checkCanaries(embedFn: EmbedFn): Promise<CanaryReport> {
    const startTime = Date.now();

    let freshEmbeddings: number[][];
    try {
      freshEmbeddings = await embedFn(resolvedCanaryTexts);
    } catch (err) {
      throw new DriftError(
        `Embed function failed: ${(err as Error).message}`,
        'EMBED_FN_FAILED',
      );
    }

    const canaryCount = Math.min(freshEmbeddings.length, resolvedCanaryTexts.length);

    if (canaryBaseline === undefined) {
      // First call — establish baseline
      canaryBaseline = freshEmbeddings;
      const durationMs = Date.now() - startTime;
      const canaryReport: CanaryReport = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        canaryCount,
        meanSimilarity: 1,
        minSimilarity: 1,
        perCanarySimilarities: new Array(canaryCount).fill(1),
        driftScore: 0,
        modelChanged: false,
        isInitialBaseline: true,
        alerted: false,
        modelId,
        durationMs,
      };
      return canaryReport;
    }

    const result = computeCanaryDrift(freshEmbeddings, canaryBaseline, canaryThreshold);
    const durationMs = Date.now() - startTime;

    const canaryReport: CanaryReport = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      canaryCount,
      meanSimilarity: result.meanSimilarity,
      minSimilarity: result.minSimilarity,
      perCanarySimilarities: result.perCanarySimilarities,
      driftScore: result.score,
      modelChanged: result.modelChanged,
      isInitialBaseline: false,
      alerted: false,
      modelId,
      durationMs,
    };

    canaryReport.alerted = evaluateAlert(canaryReport, alertSeverity, thresholds);
    dispatchAlert(canaryReport, onDrift, alertSeverity, thresholds);

    return canaryReport;
  }

  function setCanaryBaseline(canaryEmbeddings: number[][]): void {
    if (!canaryEmbeddings || canaryEmbeddings.length === 0) {
      throw new DriftError(
        'canaryEmbeddings must be a non-empty array.',
        'EMPTY_INPUT',
      );
    }
    canaryBaseline = canaryEmbeddings;
  }

  function getCanaryTexts(): string[] {
    return [...resolvedCanaryTexts];
  }

  function alert(report: DriftReport | CanaryReport): boolean {
    return evaluateAlert(report, alertSeverity, thresholds);
  }

  function save(snap: Snapshot, filePath: string): void {
    saveSnapshot(snap, filePath);
  }

  function load(filePath: string): Snapshot {
    return loadSnapshot(filePath);
  }

  return {
    snapshot,
    compare,
    setBaseline,
    getBaseline,
    check,
    checkCanaries,
    setCanaryBaseline,
    getCanaryTexts,
    alert,
    saveSnapshot: save,
    loadSnapshot: load,
  };
}

function buildDriftSummary(
  score: number,
  severity: string,
  modelChanged: boolean,
  durationMs: number,
): string {
  if (modelChanged) {
    return `Model change detected. Severity: critical. Composite score: ${score.toFixed(3)}. Re-embed immediately. (${durationMs}ms)`;
  }
  const actions: Record<string, string> = {
    none: 'No action needed.',
    low: 'Monitor. No re-embedding needed.',
    medium: 'Investigate. Consider partial re-indexing.',
    high: 'Re-embed recommended.',
    critical: 'Re-embed immediately.',
  };
  return `Drift severity: ${severity}. Composite score: ${score.toFixed(3)}. ${actions[severity] ?? ''} (${durationMs}ms)`;
}
