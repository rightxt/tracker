import { access, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const FORBIDDEN_CANONICAL_GENERATED_DIRECTORIES = Object.freeze([
  '.angular',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
  'out-tsc',
]);

/**
 * Recursively enumerates files below a directory.
 *
 * @param {string} root Directory to walk.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Asserts that a path exists.
 *
 * @param {string} path Path to inspect.
 * @param {string} message Failure message.
 * @returns {Promise<void>} Resolves when present.
 */
async function requirePath(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

/**
 * Asserts that a path does not exist.
 *
 * @param {string} path Path to inspect.
 * @param {string} message Failure message.
 * @returns {Promise<void>} Resolves when absent.
 */
async function requireAbsentPath(path, message) {
  try {
    await access(path);
    throw new Error(message);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Rejects generated directories inside a checked-in demo source tree.
 *
 * @param {string} projectRoot Demo source root.
 * @param {{ route: string }} demo Catalog entry.
 * @returns {Promise<void>} Resolves when no forbidden generated directory exists.
 */
async function verifyCanonicalDemoSourceHygiene(projectRoot, demo) {
  for (const directoryName of FORBIDDEN_CANONICAL_GENERATED_DIRECTORIES) {
    const candidate = resolve(projectRoot, directoryName);
    try {
      if ((await stat(candidate)).isDirectory()) {
        throw new Error(`${demo.route} contains generated directory ${directoryName}/.`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export { listFiles, requireAbsentPath, requirePath, verifyCanonicalDemoSourceHygiene };
