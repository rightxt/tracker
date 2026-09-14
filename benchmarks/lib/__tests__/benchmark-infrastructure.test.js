import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { parseBenchmarkArguments } from '../cli.mjs';
import { compareBenchmarkReports } from '../comparison.mjs';
import { REPORT_SCHEMA_VERSION, validateBenchmarkReport, writeBenchmarkReports } from '../reporting.mjs';
import { getBenchmarkProfile, validateBenchmarkProfiles } from '../../profiles.mjs';

/** Creates one minimal valid report for infrastructure contract tests. */
function createReport(overrides = {}) {
  return {
    benchmark: 'example',
    environment: {
      build: { mode: 'production', provenance: 'production-dist', target: 'example-dist' },
      runtime: { architecture: 'x64', cpuModel: 'test', nodeVersion: 'v1', platform: 'test' },
      source: { gitCommit: 'abc', lockfileHash: 'lock', workingTreeDirty: false, workingTreeHash: 'clean' },
    },
    generatedAt: '2026-01-01T00:00:00.000Z',
    methodology: {},
    phase: 'before',
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    results: [
      {
        assertions: { checksum: 10 },
        caseId: 'example/one',
        dimensions: { size: 1 },
        measurementVersion: 1,
        metrics: { durationMs: 2 },
      },
    ],
    smoke: false,
    ...overrides,
  };
}

/** Report files written by the persistence test, removed once the suite ends. */
const writtenPaths = [];

afterAll(async () => {
  await Promise.all(writtenPaths.map((path) => rm(path, { force: true, recursive: true })));
});

describe('benchmark infrastructure', () => {
  it('rejects ambiguous registry identities and unknown profile lookups', () => {
    expect(() =>
      validateBenchmarkProfiles([
        {
          id: 'duplicate',
          name: 'First',
          nodeArguments: [],
          preparation: 'none',
          provenance: 'source',
          reportPrefix: 'first',
          runner: 'first.mjs',
          smoke: true,
        },
        {
          id: 'duplicate',
          name: 'Second',
          nodeArguments: [],
          preparation: 'none',
          provenance: 'source',
          reportPrefix: 'second',
          runner: 'second.mjs',
          smoke: true,
        },
      ]),
    ).toThrow('Duplicate benchmark profile id');
    expect(() => getBenchmarkProfile('missing')).toThrow('Unknown benchmark profile');
  });

  it('parses shared phase/output forms and smoke mode consistently', () => {
    expect(parseBenchmarkArguments(['--', '--phase=before', '--output', 'report.json', '--smoke'])).toEqual({
      flags: new Set(['--smoke']),
      output: 'report.json',
      phase: 'before',
      smoke: true,
    });
    expect(parseBenchmarkArguments(['--phase', 'after', '--output=report.json'])).toMatchObject({
      output: 'report.json',
      phase: 'after',
      smoke: false,
    });
  });

  it('rejects duplicate and malformed case identities before report serialization', () => {
    const duplicate = createReport();

    duplicate.results.push({ ...duplicate.results[0] });

    expect(() => validateBenchmarkReport(duplicate)).toThrow('duplicate caseId "example/one"');
    expect(() =>
      validateBenchmarkReport(
        createReport({ results: [{ assertions: {}, caseId: '', dimensions: {}, metrics: { durationMs: 1 } }] }),
      ),
    ).toThrow('non-empty caseId');
    expect(() => validateBenchmarkReport(createReport({ results: [] }))).toThrow('must not be empty');
  });

  it('compares metrics only when dimensions and assertions are equivalent', () => {
    const before = createReport();
    const after = createReport({
      phase: 'after',
      results: [
        {
          ...before.results[0],
          assertions: { checksum: 10 },
          metrics: { durationMs: 3 },
        },
      ],
    });
    const comparison = compareBenchmarkReports(before, after);

    expect(comparison.cases[0]).toMatchObject({
      caseId: 'example/one',
      metrics: [{ after: 3, before: 2, name: 'durationMs' }],
      status: 'comparable',
    });
  });

  it('blocks metric comparison when workload dimensions differ', () => {
    const before = createReport();
    const after = createReport({
      phase: 'after',
      results: [{ ...before.results[0], dimensions: { size: 2 }, metrics: { durationMs: 3 } }],
    });

    expect(compareBenchmarkReports(before, after).cases[0]).toMatchObject({
      after: { size: 2 },
      before: { size: 1 },
      caseId: 'example/one',
      status: 'dimension-mismatch',
    });
  });

  it('blocks metric comparison when correctness assertions differ', () => {
    const before = createReport();
    const after = createReport({
      results: [{ ...before.results[0], assertions: { checksum: 11 }, metrics: { durationMs: 1 } }],
    });

    expect(compareBenchmarkReports(before, after).cases[0]).toMatchObject({
      caseId: 'example/one',
      status: 'assertion-mismatch',
    });
  });

  it('rejects results without a finite performance metric', () => {
    expect(() =>
      validateBenchmarkReport(
        createReport({ results: [{ ...createReport().results[0], metrics: { durationMs: Number.NaN } }] }),
      ),
    ).toThrow('must contain at least one finite metric');
    expect(() =>
      validateBenchmarkReport(
        createReport({
          results: [{ ...createReport().results[0], metrics: { durationMs: Number.POSITIVE_INFINITY } }],
        }),
      ),
    ).toThrow('must contain at least one finite metric');
  });

  it('rejects results missing a positive integer measurementVersion', () => {
    expect(() =>
      validateBenchmarkReport(
        createReport({ results: [{ ...createReport().results[0], measurementVersion: undefined }] }),
      ),
    ).toThrow('positive integer measurementVersion');
    expect(() =>
      validateBenchmarkReport(createReport({ results: [{ ...createReport().results[0], measurementVersion: 0 }] })),
    ).toThrow('positive integer measurementVersion');
  });

  it('blocks metric comparison for a case whose measurementVersion changed, without blocking unrelated cases', () => {
    const before = createReport({
      results: [
        { ...createReport().results[0], caseId: 'example/one', measurementVersion: 1 },
        { ...createReport().results[0], caseId: 'example/two', measurementVersion: 1, metrics: { durationMs: 5 } },
      ],
    });
    const after = createReport({
      phase: 'after',
      results: [
        { ...createReport().results[0], caseId: 'example/one', measurementVersion: 2, metrics: { durationMs: 1 } },
        { ...createReport().results[0], caseId: 'example/two', measurementVersion: 1, metrics: { durationMs: 4 } },
      ],
    });
    const comparison = compareBenchmarkReports(before, after);

    expect(comparison.cases.find((entry) => entry.caseId === 'example/one')).toMatchObject({
      after: 2,
      before: 1,
      caseId: 'example/one',
      status: 'measurement-version-mismatch',
    });
    expect(comparison.cases.find((entry) => entry.caseId === 'example/two')).toMatchObject({
      caseId: 'example/two',
      metrics: [{ after: 4, before: 5, name: 'durationMs' }],
      status: 'comparable',
    });
  });

  it('persists diagnostics through the JSON and CSV serialization round trip', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rxt-benchmark-report-'));
    const outputPath = join(temporaryDirectory, 'report.json');
    const diagnostics = { allocationProxy: { itemArrayChanged: true }, renders: { started: 3 } };
    const source = createReport({
      results: [{ ...createReport().results[0], diagnostics }],
    });
    const saved = await writeBenchmarkReports('example', source, { output: relative(process.cwd(), outputPath) });

    writtenPaths.push(temporaryDirectory, saved.csv, saved.json);

    const persisted = JSON.parse(await readFile(outputPath, 'utf8'));

    expect(persisted.results[0].diagnostics).toEqual(diagnostics);
    expect(() => {
      validateBenchmarkReport(persisted);
    }).not.toThrow();
    expect(saved.csvContent.split('\n')[0]).toContain('diagnostics.renders.started');
  });

  it('compares metrics across reports whose diagnostics differ', () => {
    const before = createReport({
      results: [{ ...createReport().results[0], diagnostics: { renders: { started: 1 } } }],
    });
    const after = createReport({
      phase: 'after',
      results: [{ ...createReport().results[0], diagnostics: { renders: { started: 9 } }, metrics: { durationMs: 3 } }],
    });

    expect(compareBenchmarkReports(before, after).cases[0]).toMatchObject({
      caseId: 'example/one',
      metrics: [{ after: 3, before: 2, name: 'durationMs' }],
      status: 'comparable',
    });
  });

  it('rejects a non-object diagnostics field before report serialization', () => {
    expect(() =>
      validateBenchmarkReport(createReport({ results: [{ ...createReport().results[0], diagnostics: 42 }] })),
    ).toThrow('diagnostics must be an object');
  });

  it('rejects a changed execution environment unless explicitly overridden', () => {
    const before = createReport({
      environment: { ...createReport().environment, browser: { engine: 'chromium', version: '1.0.0' } },
    });
    const after = createReport({
      environment: {
        ...before.environment,
        browser: { ...before.environment.browser, version: '2.0.0' },
        runtime: { ...before.environment.runtime, nodeVersion: 'v2' },
      },
    });

    expect(() => compareBenchmarkReports(before, after)).toThrow('Node version differs');

    const { failures } = compareBenchmarkReports(before, after, { allowIncompatible: true }).compatibility;

    expect(failures).toContain('Node version differs ("v1" vs "v2")');
    expect(failures).toContain('browser version differs ("1.0.0" vs "2.0.0")');
  });

  it('never compares different benchmark families, even when incompatibilities are explicitly overridden', () => {
    const before = createReport();
    const after = createReport({ benchmark: 'different-benchmark', phase: 'after' });

    expect(() => compareBenchmarkReports(before, after, { allowIncompatible: true })).toThrow(
      'benchmark family differs',
    );
  });

  it('rejects incompatible lockfile identities unless explicitly overridden', () => {
    const before = createReport();
    const after = createReport({
      environment: {
        ...before.environment,
        source: { ...before.environment.source, lockfileHash: 'different' },
      },
    });

    expect(() => compareBenchmarkReports(before, after)).toThrow('pnpm-lock.yaml identity differs');
    expect(compareBenchmarkReports(before, after, { allowIncompatible: true }).compatibility.failures).toContain(
      'pnpm-lock.yaml identity differs',
    );
  });
});
