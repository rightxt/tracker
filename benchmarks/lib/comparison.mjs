import { isDeepStrictEqual } from 'node:util';
import { validateBenchmarkReport } from './reporting.mjs';

/** Reads a nested object path without throwing on absent provenance. */
function readPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

/** Flattens only finite numeric metric leaves. */
function flattenMetrics(value, prefix = '', output = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    output[prefix] = value;
    return output;
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, nestedValue]) => {
      flattenMetrics(nestedValue, prefix === '' ? key : `${prefix}.${key}`, output);
    });
  }

  return output;
}

/** Collects compatibility failures and strong warnings for two validated reports. */
function inspectReportCompatibility(before, after) {
  const failures = [];
  const warnings = [];

  if (before.benchmark !== after.benchmark) {
    failures.push(`benchmark family differs (${before.benchmark} vs ${after.benchmark})`);
  }

  if (before.reportSchemaVersion !== after.reportSchemaVersion) {
    failures.push(
      `report schema differs (${String(before.reportSchemaVersion)} vs ${String(after.reportSchemaVersion)})`,
    );
  }

  // Every recorded identity of the execution environment is a hard incompatibility: durations
  // measured on a different machine, platform, Node runtime, or browser build are not
  // like-for-like, and reporting that as a warning let an unusable comparison print numbers.
  // `--force` still allows an explicitly acknowledged exploratory comparison.
  const hardPaths = [
    ['environment.build.provenance', 'source/build provenance'],
    ['environment.build.mode', 'build mode'],
    ['environment.build.target', 'build target'],
    ['environment.browser.engine', 'browser engine'],
    ['environment.browser.headless', 'browser headless mode'],
    ['environment.browser.version', 'browser version'],
    ['environment.browser.viewport', 'browser viewport'],
    ['environment.runtime.architecture', 'machine architecture'],
    ['environment.runtime.cpuModel', 'CPU model'],
    ['environment.runtime.nodeVersion', 'Node version'],
    ['environment.runtime.platform', 'platform'],
  ];

  hardPaths.forEach(([path, label]) => {
    const beforeValue = readPath(before, path);
    const afterValue = readPath(after, path);

    if (!isDeepStrictEqual(beforeValue, afterValue)) {
      failures.push(`${label} differs (${JSON.stringify(beforeValue)} vs ${JSON.stringify(afterValue)})`);
    }
  });

  const beforeLockfile = readPath(before, 'environment.source.lockfileHash');
  const afterLockfile = readPath(after, 'environment.source.lockfileHash');

  if (beforeLockfile === 'unknown' || afterLockfile === 'unknown') {
    warnings.push('lockfile identity is unknown for at least one report');
  } else if (beforeLockfile !== afterLockfile) {
    failures.push('pnpm-lock.yaml identity differs');
  }

  return { failures, warnings };
}

/** Builds a case map after shared validation has established unique case IDs. */
function createCaseMap(report) {
  return new Map(report.results.map((result) => [result.caseId, result]));
}

/**
 * Compares compatible schema-v2 reports by case ID and metrics only.
 *
 * A `measurementVersion`, assertion, or dimension mismatch blocks metric
 * comparison for that case, so a report is never mistaken for a like-for-like
 * before/after when the case's measured workload has actually changed. A
 * result's optional `diagnostics` object is deliberately read by no gate: work
 * counters and other implementation evidence must remain visible in the
 * reports without turning a genuine performance change into an unusable
 * comparison.
 */
function compareBenchmarkReports(before, after, { allowIncompatible = false } = {}) {
  validateBenchmarkReport(before);
  validateBenchmarkReport(after);

  const compatibility = inspectReportCompatibility(before, after);
  const unconditionallyFatal = compatibility.failures.filter(
    (failure) => failure.startsWith('benchmark family') || failure.startsWith('report schema'),
  );

  if (unconditionallyFatal.length > 0 || (!allowIncompatible && compatibility.failures.length > 0)) {
    throw new Error(`Benchmark reports are incompatible:\n- ${compatibility.failures.join('\n- ')}`);
  }

  const beforeCases = createCaseMap(before);
  const afterCases = createCaseMap(after);
  const caseIds = [...new Set([...beforeCases.keys(), ...afterCases.keys()])].sort((first, second) =>
    first.localeCompare(second),
  );
  const cases = caseIds.map((caseId) => {
    const beforeCase = beforeCases.get(caseId);
    const afterCase = afterCases.get(caseId);

    if (beforeCase === undefined) {
      return { caseId, status: 'only-after' };
    }

    if (afterCase === undefined) {
      return { caseId, status: 'only-before' };
    }

    if (beforeCase.measurementVersion !== afterCase.measurementVersion) {
      return {
        after: afterCase.measurementVersion,
        before: beforeCase.measurementVersion,
        caseId,
        status: 'measurement-version-mismatch',
      };
    }

    if (!isDeepStrictEqual(beforeCase.dimensions, afterCase.dimensions)) {
      return {
        after: afterCase.dimensions,
        before: beforeCase.dimensions,
        caseId,
        status: 'dimension-mismatch',
      };
    }

    if (!isDeepStrictEqual(beforeCase.assertions, afterCase.assertions)) {
      return {
        after: afterCase.assertions,
        before: beforeCase.assertions,
        caseId,
        status: 'assertion-mismatch',
      };
    }

    const beforeMetrics = flattenMetrics(beforeCase.metrics);
    const afterMetrics = flattenMetrics(afterCase.metrics);
    const metricNames = Object.keys(beforeMetrics)
      .filter((name) => Object.hasOwn(afterMetrics, name))
      .sort((first, second) => first.localeCompare(second));

    return {
      caseId,
      metrics: metricNames.map((name) => ({ after: afterMetrics[name], before: beforeMetrics[name], name })),
      status: 'comparable',
    };
  });

  return { cases, compatibility };
}

export { compareBenchmarkReports, flattenMetrics, inspectReportCompatibility };
