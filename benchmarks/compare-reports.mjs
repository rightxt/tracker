/* eslint-disable no-console -- Command-line comparison tool prints compatibility and delta tables. */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { compareBenchmarkReports } from './lib/comparison.mjs';

/** Directory scanned for persisted benchmark reports. */
const REPORTS_DIRECTORY = resolve(process.cwd(), 'benchmarks/reports');

/** Reads and parses one benchmark JSON report. */
async function readReport(filePath) {
  const content = await readFile(resolve(process.cwd(), filePath), 'utf8');

  return JSON.parse(content);
}

/** Finds the most recent report for one family and phase. */
async function findLatestReport(benchmarkName, phase) {
  const entries = await readdir(REPORTS_DIRECTORY, { withFileTypes: true });
  const candidateNames = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${benchmarkName}-`) && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((first, second) => second.localeCompare(first));

  for (const name of candidateNames) {
    const filePath = resolve(REPORTS_DIRECTORY, name);
    const report = await readReport(filePath);

    if (report.phase === phase) {
      return { filePath: `benchmarks/reports/${name}`, report };
    }
  }

  throw new Error(`No "${benchmarkName}-*.json" report with phase "${phase}" was found.`);
}

/** Formats an absolute numeric delta. */
function formatDelta(delta) {
  return `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
}

/** Formats percentage change without dividing by zero. */
function formatPercent(before, delta) {
  if (before === 0) {
    return 'n/a';
  }

  const percent = (delta / Math.abs(before)) * 100;

  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

/** Formats recorded source identity without implying that commit identifies dirty content. */
function formatSourceIdentity(report) {
  const source = report.environment?.source ?? {};
  const commit = typeof source.gitCommit === 'string' ? source.gitCommit.slice(0, 12) : 'unknown';
  const worktree = source.workingTreeHash;
  const worktreeLabel =
    typeof worktree === 'string' && worktree !== 'clean' && worktree !== 'unknown'
      ? worktree.slice(0, 12)
      : String(worktree ?? 'unknown');

  return `commit ${commit}, dirty ${String(source.workingTreeDirty ?? 'unknown')}, worktree ${worktreeLabel}`;
}

/** Prints one schema-aware comparison. */
function printComparison(before, after, allowIncompatible) {
  const comparison = compareBenchmarkReports(before.report, after.report, { allowIncompatible });

  console.log(`Before: ${before.filePath} (phase "${String(before.report.phase)}")`);
  console.log(`After:  ${after.filePath} (phase "${String(after.report.phase)}")`);
  console.log(`Source before: ${formatSourceIdentity(before.report)}`);
  console.log(`Source after:  ${formatSourceIdentity(after.report)}`);

  comparison.compatibility.warnings.forEach((warning) => {
    console.warn(`WARNING: ${warning}`);
  });

  if (allowIncompatible) {
    comparison.compatibility.failures.forEach((failure) => {
      console.warn(`OVERRIDDEN INCOMPATIBILITY: ${failure}`);
    });
  }

  let comparableCount = 0;
  let blockedCount = 0;

  comparison.cases.forEach((caseComparison) => {
    console.log(`\n${caseComparison.caseId}`);

    if (caseComparison.status === 'only-after') {
      console.log('  only present after');
      return;
    }

    if (caseComparison.status === 'only-before') {
      console.log('  only present before');
      return;
    }

    if (
      caseComparison.status === 'assertion-mismatch' ||
      caseComparison.status === 'dimension-mismatch' ||
      caseComparison.status === 'measurement-version-mismatch'
    ) {
      blockedCount += 1;
      console.error(`  ${caseComparison.status}; metric comparison blocked`);
      console.error(`  before: ${JSON.stringify(caseComparison.before)}`);
      console.error(`  after:  ${JSON.stringify(caseComparison.after)}`);
      return;
    }

    comparableCount += 1;

    if (caseComparison.metrics.length === 0) {
      console.log('  no comparable metric leaves');
      return;
    }

    caseComparison.metrics.forEach(({ after: afterValue, before: beforeValue, name }) => {
      const delta = afterValue - beforeValue;

      console.log(
        `  ${name}: ${beforeValue.toFixed(2)} -> ${afterValue.toFixed(2)} (${formatDelta(delta)}, ${formatPercent(beforeValue, delta)})`,
      );
    });
  });

  console.log(`\nCompared ${String(comparableCount)} of ${String(comparison.cases.length)} case IDs.`);

  if (blockedCount > 0) {
    process.exitCode = 1;
  }
}

/** Parses the comparison tool's two supported invocation forms. */
function parseComparisonArguments(argv) {
  const values = { after: 'after', before: 'before', benchmark: null };
  const positional = [];
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--force') {
      force = true;
      continue;
    }

    const inlineMatch = /^(--after|--before|--benchmark)=(.*)$/.exec(argument);

    if (inlineMatch !== null) {
      const [, name, value] = inlineMatch;

      if (value === '') {
        throw new Error(`Comparison argument "${name}" requires a value.`);
      }

      values[name.slice(2)] = value;
      continue;
    }

    if (argument === '--after' || argument === '--before' || argument === '--benchmark') {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Comparison argument "${argument}" requires a value.`);
      }

      values[argument.slice(2)] = value;
      index += 1;
      continue;
    }

    if (argument.startsWith('--')) {
      throw new Error(`Unknown comparison argument "${argument}".`);
    }

    positional.push(argument);
  }

  if (positional.length !== 0 && positional.length !== 2) {
    throw new Error('Comparison requires either exactly two report paths or a --benchmark value.');
  }

  if (positional.length === 2 && values.benchmark !== null) {
    throw new Error('Do not combine explicit report paths with --benchmark.');
  }

  return { force, positional, ...values };
}

const arguments_ = parseComparisonArguments(process.argv.slice(2));

if (arguments_.positional.length === 2) {
  const [beforePath, afterPath] = arguments_.positional;

  printComparison(
    { filePath: beforePath, report: await readReport(beforePath) },
    { filePath: afterPath, report: await readReport(afterPath) },
    arguments_.force,
  );
} else {
  const benchmarkName = arguments_.benchmark;

  if (benchmarkName === null) {
    throw new Error(
      'Usage: node benchmarks/compare-reports.mjs --benchmark=<name> [--before=<phase>] [--after=<phase>] [--force]' +
        '\n   or: node benchmarks/compare-reports.mjs <before.json> <after.json> [--force]',
    );
  }

  const [before, after] = await Promise.all([
    findLatestReport(benchmarkName, arguments_.before),
    findLatestReport(benchmarkName, arguments_.after),
  ]);

  printComparison(before, after, arguments_.force);
}
