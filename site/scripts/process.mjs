import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const NPM_CACHE = resolve(import.meta.dirname, '../.cache/npm');

/**
 * Resolves a portable executable name without invoking a command shell.
 *
 * @param {string} command Logical executable name.
 * @param {string[]} args Logical command arguments.
 * @returns {{ args: string[], executable: string }} Platform-specific invocation.
 */
function resolveCommand(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return {
      args: [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args],
      executable: process.execPath,
    };
  }
  return { args, executable: command };
}

/**
 * Runs a command with inherited output and rejects with actionable context.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Command arguments.
 * @param {{ cwd: string, label: string, retryExitCodes?: number[] }} context Execution context.
 * @returns {Promise<void>} Resolves after a successful exit.
 */
function runCommand(command, args, { cwd, label, retryExitCodes = [] }) {
  const retryableExitCodes = new Set(retryExitCodes);
  let retriesRemaining = retryableExitCodes.size === 0 ? 0 : 1;

  return new Promise((resolvePromise, rejectPromise) => {
    const start = () => {
      const invocation = resolveCommand(command, args);
      const child = spawn(invocation.executable, invocation.args, {
        cwd,
        env: { ...process.env, NG_CLI_ANALYTICS: 'false', npm_config_cache: NPM_CACHE },
        stdio: 'inherit',
      });

      child.once('error', (error) => {
        rejectPromise(new Error(`${label}: could not start ${command}: ${error.message}`, { cause: error }));
      });
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise();
          return;
        }
        if (signal === null && code !== null && retriesRemaining > 0 && retryableExitCodes.has(code)) {
          retriesRemaining -= 1;
          console.warn(`${label}: ${command} exited unexpectedly with ${String(code)}; retrying once.`);
          start();
          return;
        }

        const outcome = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
        rejectPromise(new Error(`${label}: ${command} ${args.join(' ')} failed with ${outcome}.`));
      });
    };

    start();
  });
}

/**
 * Runs a command and captures UTF-8 output.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Command arguments.
 * @param {{ cwd: string, label: string }} context Execution context.
 * @returns {Promise<string>} Captured standard output.
 */
function runCommandCapture(command, args, { cwd, label }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const invocation = resolveCommand(command, args);
    const child = spawn(invocation.executable, invocation.args, {
      cwd,
      env: { ...process.env, NG_CLI_ANALYTICS: 'false', npm_config_cache: NPM_CACHE },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';

    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.once('error', (error) => {
      rejectPromise(new Error(`${label}: could not start ${command}: ${error.message}`, { cause: error }));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }

      const outcome = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      const detail = stderr.trim() === '' ? '' : `\n${stderr.trim()}`;
      rejectPromise(new Error(`${label}: ${command} ${args.join(' ')} failed with ${outcome}.${detail}`));
    });
  });
}

export { runCommand, runCommandCapture };
