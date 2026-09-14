import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';

/** Current structural benchmark report contract. */
const REPORT_SCHEMA_VERSION = 2;

/**
 * Every result must carry a `measurementVersion` (positive integer): an
 * explicit tag for what its metrics actually measure, independent of
 * `REPORT_SCHEMA_VERSION` (which only versions the JSON envelope's shape).
 * A profile bumps a case's `measurementVersion` whenever it changes what a
 * timer boundary covers for that case, even if metric names stay the same,
 * so `compareBenchmarkReports()` can refuse to compare before/after values
 * that look alike but no longer mean the same thing. Bump only the cases
 * whose measured workload actually changed; unaffected cases in the same
 * report keep their existing value.
 */

/** Directory that contains generated benchmark reports. */
const REPORTS_DIRECTORY = 'benchmarks/reports';

/** Returns whether a value is a non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Flattens a JSON-compatible value into one CSV row. */
function flattenValue(value, prefix, row) {
  if (Array.isArray(value)) {
    row[prefix] = JSON.stringify(value);
    return;
  }

  if (isRecord(value)) {
    Object.entries(value)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
      .forEach(([key, nestedValue]) => {
        flattenValue(nestedValue, prefix === '' ? key : `${prefix}.${key}`, row);
      });
    return;
  }

  row[prefix] = value;
}

/** Escapes one CSV value according to RFC 4180-compatible quoting rules. */
function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  return /[",\r\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

/** Serializes flattened result rows to CSV. */
function createCsv(rows) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort((first, second) =>
    first.localeCompare(second),
  );
  const lines = [columns.map(escapeCsvValue).join(',')];

  rows.forEach((row) => {
    lines.push(columns.map((column) => escapeCsvValue(row[column])).join(','));
  });

  return `${lines.join('\n')}\n`;
}

/** Creates tabular rows while repeating report context for standalone interpretation. */
function createBenchmarkReportRows(report) {
  const context = {};

  flattenValue(report.environment, 'environment', context);
  flattenValue(report.methodology, 'methodology', context);
  context.benchmark = report.benchmark;
  context.generatedAt = report.generatedAt;
  context.phase = report.phase;
  context.reportSchemaVersion = report.reportSchemaVersion;
  context.smoke = report.smoke;

  return report.results.map((result) => {
    const row = { ...context };

    flattenValue(result, '', row);
    return row;
  });
}

/** Returns whether a nested metric tree contains at least one finite number. */
function containsFiniteMetric(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.some(containsFiniteMetric);
  }

  return isRecord(value) && Object.values(value).some(containsFiniteMetric);
}

/**
 * Validates the shared report schema and rejects ambiguous result identity.
 *
 * A result's optional `diagnostics` object holds instrumentation and
 * implementation evidence — work counters, allocation churn, render-call
 * counts. It is validated only as an object because, unlike `dimensions` and
 * `assertions`, it is deliberately not a comparability gate: a changed work
 * counter must stay visible in a before/after comparison rather than
 * invalidating it.
 *
 * @param {unknown} report - Candidate complete report envelope.
 * @returns {void}
 */
function validateBenchmarkReport(report) {
  if (!isRecord(report)) {
    throw new TypeError('Benchmark report must be an object.');
  }

  if (report.reportSchemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported benchmark report schema ${String(report.reportSchemaVersion)}; expected ${String(REPORT_SCHEMA_VERSION)}.`,
    );
  }

  if (typeof report.benchmark !== 'string' || report.benchmark === '') {
    throw new Error('Benchmark report must have a non-empty benchmark family.');
  }

  if (!isRecord(report.environment) || !isRecord(report.methodology) || !Array.isArray(report.results)) {
    throw new Error('Benchmark report requires object environment/methodology fields and a results array.');
  }

  if (report.results.length === 0) {
    throw new Error('Benchmark report results must not be empty.');
  }

  const caseIds = new Set();

  report.results.forEach((result, index) => {
    if (!isRecord(result)) {
      throw new Error(`Benchmark result at index ${String(index)} must be an object.`);
    }

    if (typeof result.caseId !== 'string' || result.caseId.trim() === '') {
      throw new Error(`Benchmark result at index ${String(index)} must have a non-empty caseId.`);
    }

    if (caseIds.has(result.caseId)) {
      throw new Error(`Benchmark report contains duplicate caseId "${result.caseId}".`);
    }

    caseIds.add(result.caseId);

    if (!isRecord(result.dimensions) || !isRecord(result.metrics) || !isRecord(result.assertions)) {
      throw new Error(`Benchmark result "${result.caseId}" requires dimensions, metrics, and assertions objects.`);
    }

    if (result.diagnostics !== undefined && !isRecord(result.diagnostics)) {
      throw new Error(`Benchmark result "${result.caseId}" diagnostics must be an object when present.`);
    }

    if (Object.keys(result.metrics).length === 0 || !containsFiniteMetric(result.metrics)) {
      throw new Error(`Benchmark result "${result.caseId}" must contain at least one finite metric.`);
    }

    if (!Number.isInteger(result.measurementVersion) || result.measurementVersion < 1) {
      throw new Error(`Benchmark result "${result.caseId}" must have a positive integer measurementVersion.`);
    }
  });
}

/** Produces a filesystem-safe timestamp for a report filename. */
function createReportTimestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

/**
 * Writes validated JSON/CSV reports and an optional explicit JSON copy.
 *
 * @param {string} reportName - Stable benchmark family and filename prefix.
 * @param {Record<string, unknown>} report - Profile-owned environment, methodology, and results.
 * @param {{ output?: string | null, phase?: string | null, smoke?: boolean }} [options] - Shared envelope options.
 * @returns {Promise<{ csv: string, csvContent: string, json: string, report: Record<string, unknown> }>} Saved report metadata.
 */
async function writeBenchmarkReports(reportName, report, { output = null, phase = null, smoke = false } = {}) {
  const outputDirectory = resolve(process.cwd(), REPORTS_DIRECTORY);
  const timestamp = createReportTimestamp();
  const reportWithMetadata = {
    ...report,
    benchmark: reportName,
    generatedAt: new Date().toISOString(),
    phase: phase ?? report.phase ?? 'unspecified',
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    smoke,
  };

  validateBenchmarkReport(reportWithMetadata);

  const filename = `${reportName}-${timestamp}`;
  const jsonPath = resolve(outputDirectory, `${filename}.json`);
  const csvPath = resolve(outputDirectory, `${filename}.csv`);
  const jsonContent = `${JSON.stringify(reportWithMetadata, null, 2)}\n`;
  const csvContent = createCsv(createBenchmarkReportRows(reportWithMetadata));
  const explicitOutputPath = output === null ? null : resolve(process.cwd(), output);

  await mkdir(outputDirectory, { recursive: true });

  if (explicitOutputPath !== null) {
    await mkdir(dirname(explicitOutputPath), { recursive: true });
  }

  await Promise.all([
    writeFile(jsonPath, jsonContent, 'utf8'),
    writeFile(csvPath, csvContent, 'utf8'),
    ...(explicitOutputPath === null ? [] : [writeFile(explicitOutputPath, jsonContent, 'utf8')]),
  ]);

  return {
    csv: relative(process.cwd(), csvPath),
    csvContent,
    json: relative(process.cwd(), jsonPath),
    report: reportWithMetadata,
  };
}

export { REPORT_SCHEMA_VERSION, validateBenchmarkReport, writeBenchmarkReports };
