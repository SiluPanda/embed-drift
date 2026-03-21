import type { DriftReport, CanaryReport, DriftSeverity, MethodThresholds } from './types';

const SEVERITY_ORDER: DriftSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

function severityGte(a: DriftSeverity, b: DriftSeverity): boolean {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b);
}

/**
 * Evaluate whether a DriftReport or CanaryReport should trigger an alert.
 * Does NOT invoke any callback.
 */
export function evaluateAlert(
  report: DriftReport | CanaryReport,
  alertSeverity: DriftSeverity,
  thresholds: Partial<MethodThresholds>,
): boolean {
  if ('composite' in report) {
    // DriftReport
    if (severityGte(report.composite.severity, alertSeverity)) return true;
    if (thresholds.composite !== undefined && report.composite.score >= thresholds.composite) return true;
    if (thresholds.canary !== undefined && report.methods.canary.computed && report.methods.canary.score >= thresholds.canary) return true;
    if (thresholds.centroid !== undefined && report.methods.centroid.computed && report.methods.centroid.score >= thresholds.centroid) return true;
    if (thresholds.pairwise !== undefined && report.methods.pairwise.computed && report.methods.pairwise.score >= thresholds.pairwise) return true;
    if (thresholds.dimensionWise !== undefined && report.methods.dimensionWise.computed && report.methods.dimensionWise.score >= thresholds.dimensionWise) return true;
    if (thresholds.mmd !== undefined && report.methods.mmd.computed && report.methods.mmd.score >= thresholds.mmd) return true;
  } else {
    // CanaryReport
    // Map canary drift score to a pseudo-severity for threshold evaluation
    let canaryDriftSeverity: DriftSeverity;
    const s = report.driftScore;
    if (s < 0.05) canaryDriftSeverity = 'none';
    else if (s < 0.20) canaryDriftSeverity = 'low';
    else if (s < 0.40) canaryDriftSeverity = 'medium';
    else if (s < 0.70) canaryDriftSeverity = 'high';
    else canaryDriftSeverity = 'critical';

    if (report.modelChanged) canaryDriftSeverity = 'critical';
    if (severityGte(canaryDriftSeverity, alertSeverity)) return true;
    if (thresholds.canary !== undefined && report.driftScore >= thresholds.canary) return true;
  }
  return false;
}

/**
 * Dispatch the onDrift callback if an alert fires.
 * Async callbacks are fire-and-forget; errors are swallowed.
 */
export function dispatchAlert(
  report: DriftReport | CanaryReport,
  onDrift: ((report: DriftReport | CanaryReport) => void | Promise<void>) | undefined,
  alertSeverity: DriftSeverity,
  thresholds: Partial<MethodThresholds>,
): boolean {
  const fired = evaluateAlert(report, alertSeverity, thresholds);
  if (fired && onDrift) {
    try {
      const result = onDrift(report);
      if (result instanceof Promise) {
        result.catch(() => { /* swallow async errors */ });
      }
    } catch {
      // swallow sync errors
    }
  }
  return fired;
}
