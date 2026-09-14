import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { siteEntries } from '../catalog.mjs';
import { PUBLIC_URL, REPOSITORY_ROOT, SITE_ROOT } from '../config.mjs';

/** Generated or dependency directories excluded from development inputs. */
const EXCLUDED_DIRECTORIES = new Set([
  '.angular',
  '.cache',
  '.vite',
  '.work',
  'coverage',
  'dist',
  'node_modules',
  'out-tsc',
]);
const NON_BUILD_SITE_SCRIPTS = new Set(['serve.mjs', 'test-browser.mjs']);

/** Recursively collects stable regular-file inputs below one root. */
async function collectFiles(directory, { includeDist = false } = {}) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name) && !(includeDist && entry.name === 'dist')) {
        continue;
      }
      files.push(...(await collectFiles(path, { includeDist })));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

/**
 * Computes the input fingerprint used to detect stale development builds.
 *
 * Includes site inputs, package manifests and dist files, and packing logic. Generated site state and
 * consumer caches are excluded.
 */
async function computeDevInputFingerprint() {
  const scriptRoot = resolve(SITE_ROOT, 'scripts');
  const buildScriptFiles = (await collectFiles(scriptRoot)).filter((file) => {
    const scriptPath = relative(scriptRoot, file).replaceAll('\\', '/');
    return !scriptPath.startsWith('__tests__/') && !NON_BUILD_SITE_SCRIPTS.has(scriptPath);
  });
  const siteFiles = [
    resolve(SITE_ROOT, 'catalog.mjs'),
    resolve(SITE_ROOT, 'config.mjs'),
    ...(await collectFiles(resolve(SITE_ROOT, 'demos'))),
    ...(await collectFiles(resolve(SITE_ROOT, 'shared'))),
    ...(await collectFiles(resolve(SITE_ROOT, 'shell'))),
    ...(await collectFiles(resolve(SITE_ROOT, 'tools'))),
    ...buildScriptFiles,
  ];
  const packageFiles = [];
  const packageEntries = await readdir(resolve(REPOSITORY_ROOT, 'packages'), { withFileTypes: true });

  for (const entry of packageEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageRoot = resolve(REPOSITORY_ROOT, 'packages', entry.name);
    packageFiles.push(resolve(packageRoot, 'package.json'));
    packageFiles.push(...(await collectFiles(resolve(packageRoot, 'dist'), { includeDist: true })));
  }

  const files = [
    resolve(REPOSITORY_ROOT, 'package.json'),
    resolve(REPOSITORY_ROOT, 'pnpm-lock.yaml'),
    ...siteEntries
      .filter((entry) => entry.kind === 'documentation')
      .map((entry) => resolve(REPOSITORY_ROOT, entry.source)),
    resolve(REPOSITORY_ROOT, 'scripts/lib/workspace-pack.mjs'),
    ...siteFiles,
    ...packageFiles,
  ].sort((first, second) => first.localeCompare(second));
  const hash = createHash('sha256');
  hash.update(PUBLIC_URL);

  for (const file of files) {
    hash.update(relative(REPOSITORY_ROOT, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }

  return hash.digest('hex');
}

export { computeDevInputFingerprint };
