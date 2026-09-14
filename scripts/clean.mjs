import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Repository root resolved from this script, never from caller-controlled input. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

/** Generated directories that may occur below independent site consumers. */
const SITE_GENERATED_DIRECTORY_NAMES = new Set(['.angular', '.vite', 'coverage', 'dist', 'out-tsc']);

/** Removes a repository-owned generated path when it exists. */
async function removeGeneratedPath(...segments) {
  await rm(resolve(REPOSITORY_ROOT, ...segments), { force: true, recursive: true });
}

/** Removes generated directories below site source projects without traversing dependency or work trees. */
async function cleanSiteTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) {
        return;
      }

      const path = resolve(directory, entry.name);
      if (SITE_GENERATED_DIRECTORY_NAMES.has(entry.name)) {
        await rm(path, { force: true, recursive: true });
        return;
      }
      if (entry.name === 'node_modules' || entry.name === '.cache' || entry.name === '.work') {
        return;
      }
      await cleanSiteTree(path);
    }),
  );
}

const packageEntries = await readdir(resolve(REPOSITORY_ROOT, 'packages'), { withFileTypes: true });
await Promise.all(
  packageEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => removeGeneratedPath('packages', entry.name, 'dist')),
);

await Promise.all([
  removeGeneratedPath('.release'),
  removeGeneratedPath('.vitest-attachments'),
  removeGeneratedPath('benchmarks', 'adapters', 'dist'),
  removeGeneratedPath('coverage'),
  removeGeneratedPath('site', '.cache'),
  removeGeneratedPath('site', '.work'),
  removeGeneratedPath('site-dist'),
  removeGeneratedPath('tests', 'browser', '__screenshots__'),
]);

const reportEntries = await readdir(resolve(REPOSITORY_ROOT, 'benchmarks', 'reports'), { withFileTypes: true });
await Promise.all(
  reportEntries
    .filter((entry) => entry.name !== 'README.md')
    .map((entry) => removeGeneratedPath('benchmarks', 'reports', entry.name)),
);

await cleanSiteTree(resolve(REPOSITORY_ROOT, 'site'));
