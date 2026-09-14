/* eslint-disable no-console -- Test orchestrators report stage boundaries and child failures. */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

/** Workspace root used by every test subprocess. */
const ROOT_DIRECTORY = resolve(import.meta.dirname, '..');

/** Installed TypeScript CLI invoked through the common test subprocess wrapper. */
const TYPESCRIPT_CLI = resolve(ROOT_DIRECTORY, 'node_modules/typescript/bin/tsc');

/**
 * Runs one foreground subprocess without overlapping resource-sensitive stages.
 *
 * @param {string} command - Executable path or name.
 * @param {readonly string[]} arguments_ - Child-process arguments.
 * @param {{ allowFailure?: boolean, label: string }} options - Stage label and failure policy.
 * @returns {number} Child exit code when failures are allowed.
 */
function runTestProcess(command, arguments_, { allowFailure = false, label }) {
  console.log(`\n=== ${label} ===`);

  const result = spawnSync(command, arguments_, {
    cwd: ROOT_DIRECTORY,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  const exitCode = result.status ?? 1;

  if (!allowFailure && exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${String(exitCode)}.`);
  }

  return exitCode;
}

/** Runs a repository Node script with optional Node runtime arguments. */
function runNodeScript(script, { arguments_ = [], label = script, nodeArguments = [] } = {}) {
  return runTestProcess(process.execPath, [...nodeArguments, resolve(ROOT_DIRECTORY, script), ...arguments_], {
    label,
  });
}

/** Runs one root pnpm script through the same package-manager CLI as the parent invocation. */
function runPnpmScript(script, { label = `pnpm ${script}` } = {}) {
  const pnpmCliPath = process.env.npm_execpath;

  if (pnpmCliPath !== undefined) {
    return runTestProcess(process.execPath, [pnpmCliPath, script], { label });
  }

  if (process.platform === 'win32') {
    return runTestProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${script}`], { label });
  }

  return runTestProcess('pnpm', [script], { label });
}

/** Type-checks one built-package consumer fixture project. */
function runTypeScriptFixture(project) {
  return runTestProcess(process.execPath, [TYPESCRIPT_CLI, '--project', project], {
    label: `consumer declarations: ${project}`,
  });
}

export { ROOT_DIRECTORY, runNodeScript, runPnpmScript, runTestProcess, runTypeScriptFixture };
