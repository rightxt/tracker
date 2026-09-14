import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { PACKAGE_DIRECTORY_BY_NAME, packWorkspacePackages } from '../../scripts/lib/workspace-pack.mjs';
import { SITE_ROOT } from '../config.mjs';

const CACHE_ROOT = resolve(SITE_ROOT, '.cache/local-packages');

/**
 * Packs local package tarballs through the same pnpm path used by package verification.
 *
 * pnpm handles workspace dependency rewriting.
 */
async function prepareLocalPackages(requiredPackageNames) {
  const packageNames = [...new Set(['@rightxt/tracker-core', ...requiredPackageNames])];
  const packedPackages = await packWorkspacePackages(packageNames, CACHE_ROOT);

  return new Map(packedPackages.map(({ manifest, tarball }) => [manifest.name, tarball]));
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const tarballs = await prepareLocalPackages(process.argv.slice(2));
  for (const [packageName, tarball] of tarballs) {
    console.log(`${packageName}: ${tarball}`);
  }
}

export { PACKAGE_DIRECTORY_BY_NAME, prepareLocalPackages };
