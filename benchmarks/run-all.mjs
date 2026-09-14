/* eslint-disable no-console -- Aggregate runner reports preparation and per-profile progress. */

import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { parseBenchmarkArguments } from './lib/cli.mjs';
import { BENCHMARK_PROFILES } from './profiles.mjs';

/** Directory where every profile writes its report pair. */
const REPORTS_DIRECTORY = 'benchmarks/reports';

/** Promisified child-process execution used for preparation and profiles. */
const executeFile = promisify(execFile);

/** Parsed aggregate options forwarded to every standalone profile. */
const arguments_ = parseBenchmarkArguments(process.argv.slice(2));

if (arguments_.output !== null) {
  throw new Error('The aggregate benchmark runner does not accept --output; use it with one standalone profile.');
}

/** Executes one command while preserving its captured stdout/stderr. */
async function runCommand(command, commandArguments, description) {
  try {
    const { stderr, stdout } = await executeFile(command, commandArguments, {
      cwd: process.cwd(),
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    });

    process.stdout.write(stdout);

    if (stderr !== '') {
      process.stderr.write(stderr);
    }
  } catch (error) {
    if (typeof error?.stdout === 'string') {
      process.stdout.write(error.stdout);
    }

    if (typeof error?.stderr === 'string') {
      process.stderr.write(error.stderr);
    }

    throw new Error(`${description} failed.`, { cause: error });
  }
}

/** Package artifacts required by registered production-dist benchmark profiles. */
const REQUIRED_PACKAGE_ARTIFACTS = [
  'packages/core/dist/index.mjs',
  'packages/core/dist/projection.mjs',
  'packages/vanilla/dist/rxt-tracker-vanilla.mjs',
  'packages/element/dist/rxt-tracker-element.mjs',
  'packages/react/dist/rxt-tracker-react.mjs',
  'packages/vue/dist/rxt-tracker-vue.mjs',
  'packages/angular/dist/rxt-tracker-angular.mjs',
];

/** Checks shared package prerequisites, then builds benchmark-owned adapter bridges. */
async function prepareBenchmarkSuite() {
  const preparations = new Set(BENCHMARK_PROFILES.map(({ preparation }) => preparation));
  const requiresProductionBuild = preparations.has('production-build') || preparations.has('adapter-bridges');

  if (requiresProductionBuild) {
    const missingArtifacts = [];
    for (const path of REQUIRED_PACKAGE_ARTIFACTS) {
      try {
        await access(resolve(path));
      } catch {
        missingArtifacts.push(path);
      }
    }
    if (missingArtifacts.length > 0) {
      throw new Error(
        `Benchmark package artifacts are missing:\n- ${missingArtifacts.join('\n- ')}\nRun "pnpm packages:build" first.`,
      );
    }
  }

  if (preparations.has('adapter-bridges')) {
    console.log('\nPreparing adapter benchmark bridges against production dist...');
    await runCommand(process.execPath, ['benchmarks/adapters/build.mjs'], 'Adapter bridge build');
  }
}

/** Lists report filenames currently present in the reports directory. */
async function listReportFiles() {
  try {
    const entries = await readdir(REPORTS_DIRECTORY, { withFileTypes: true });

    return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return new Set();
    }

    throw error;
  }
}

/** Runs one registered profile and verifies that it produced a new report pair. */
async function runProfile(profile) {
  console.log(`\nRunning: ${profile.name} (${profile.id})`);

  if (arguments_.smoke && !profile.smoke) {
    throw new Error(`Benchmark profile "${profile.id}" does not support smoke mode.`);
  }

  const filesBefore = await listReportFiles();
  const forwardedArguments = [`--phase=${arguments_.phase}`, ...(arguments_.smoke ? ['--smoke'] : [])];

  await runCommand(
    process.execPath,
    [...profile.nodeArguments, profile.runner, ...forwardedArguments],
    `Benchmark profile "${profile.id}"`,
  );

  const filesAfter = await listReportFiles();
  const newFiles = [...filesAfter]
    .filter((name) => !filesBefore.has(name) && name.startsWith(`${profile.reportPrefix}-`))
    .sort((first, second) => first.localeCompare(second));
  const jsonFiles = newFiles.filter((name) => name.endsWith('.json'));
  const csvFiles = newFiles.filter((name) => name.endsWith('.csv'));

  if (jsonFiles.length !== 1 || csvFiles.length !== 1) {
    throw new Error(
      `Benchmark profile "${profile.id}" must write one new JSON/CSV pair; found ${String(jsonFiles.length)} JSON and ${String(csvFiles.length)} CSV files.`,
    );
  }

  return { files: newFiles, name: profile.name };
}

await prepareBenchmarkSuite();

const completed = [];

for (const profile of BENCHMARK_PROFILES) {
  // Sequential execution avoids cross-profile CPU/browser contention and keeps
  // each measurement's preparation and output attributable to one profile.
  completed.push(await runProfile(profile));
}

console.log('\nAll registered benchmark profiles completed. Verified report files:');
completed.forEach(({ files, name }) => {
  console.log(`  ${name}:`);
  files.forEach((file) => {
    console.log(`    benchmarks/reports/${file}`);
  });
});
