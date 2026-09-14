import { access, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { loadConfigFromFile } from 'vite';

import { getPublishablePackageName } from '../../../scripts/lib/workspace-pack.mjs';
import { SITE_ROOT } from '../../config.mjs';
import { getSharedResources } from '../materialize-shared.mjs';
import { listFiles, requirePath } from './filesystem.mjs';

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * Finds a dependency specifier that cannot work outside the repository.
 *
 * @param {Record<string, unknown>} manifest Package manifest.
 * @returns {{ name: string, section: string, specifier: string } | null} First local dependency, if any.
 */
function findLocalDependency(manifest) {
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (typeof specifier === 'string' && /^(?:file|link|workspace):/u.test(specifier)) {
        return { name, section, specifier };
      }
    }
  }
  return null;
}

/**
 * Reads package conditions configured by one standalone consumer.
 *
 * Vite configs are loaded through Vite so object, constant, and function forms are handled consistently.
 * Only user-specified conditions are returned.
 *
 * @param {string} projectRoot Consumer project root.
 * @param {{ integration: string, route: string }} demo Catalog entry.
 * @returns {Promise<Set<string>>} Explicitly configured package conditions.
 */
async function readConsumerConditions(projectRoot, demo) {
  if (demo.integration === 'angular') {
    const angularConfig = JSON.parse(await readFile(resolve(projectRoot, 'angular.json'), 'utf8'));
    return new Set(
      Object.values(angularConfig.projects ?? {}).flatMap(
        (project) => project?.architect?.build?.options?.conditions ?? [],
      ),
    );
  }

  const configFile = resolve(projectRoot, 'vite.config.js');
  try {
    await access(configFile);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile, projectRoot);
  return new Set(loaded?.config.resolve?.conditions ?? []);
}

/**
 * Verifies that a consumer selects the package condition required by its Tracker profile.
 *
 * @param {string} projectRoot Consumer project root.
 * @param {{ integration: string, route: string, trackerProfile: string }} demo Catalog entry.
 * @param {string} label Project label used in failures.
 * @returns {Promise<void>} Resolves when the effective package condition matches the Tracker profile.
 */
async function verifyConsumerTrackerProfile(projectRoot, demo, label = demo.route) {
  const conditions = await readConsumerConditions(projectRoot, demo);
  const selectsDevelopment = conditions.has('development');
  if (demo.trackerProfile === 'debug' && !selectsDevelopment) {
    const builder = demo.integration === 'angular' ? 'Angular' : 'Vite';
    throw new Error(`${label} must select ${builder}'s development package condition for the debug Tracker profile.`);
  }
  if (demo.trackerProfile === 'production' && selectsDevelopment) {
    const builder = demo.integration === 'angular' ? 'Angular' : 'Vite';
    throw new Error(
      `${label} must not select ${builder}'s development package condition for the production Tracker profile.`,
    );
  }
}

/**
 * Verifies a published demo source snapshot after installation and materialization.
 *
 * Checks package shape and dependency metadata without rebuilding the snapshot.
 *
 * @param {string} artifactRoot Generated site root.
 * @param {{ route: string }} demo Catalog entry.
 * @param {string} trackerVersion Exact published Tracker version.
 * @returns {Promise<void>} Resolves when the source snapshot is valid.
 */
async function verifyPublishedProjectSource(artifactRoot, demo, trackerVersion) {
  const integrationPackageName = getPublishablePackageName(demo.integration);
  const canonicalRoot = resolve(SITE_ROOT, demo.source);
  const publishedRoot = resolve(artifactRoot, 'sources', demo.route);
  await requirePath(resolve(publishedRoot, 'README.md'), `Published source ${demo.route} is missing README.md.`);
  await requirePath(resolve(publishedRoot, 'src'), `Published source ${demo.route} is missing src/**.`);
  await requirePath(
    resolve(publishedRoot, 'package-lock.json'),
    `Published source ${demo.route} is missing package-lock.json.`,
  );
  await verifyConsumerTrackerProfile(publishedRoot, demo, `Published source ${demo.route}`);
  const manifest = JSON.parse(await readFile(resolve(publishedRoot, 'package.json'), 'utf8'));
  const localPublishedDependency = findLocalDependency(manifest);
  if (localPublishedDependency !== null) {
    throw new Error(
      `Published source ${demo.route} uses local dependency ${localPublishedDependency.name} in ${localPublishedDependency.section}.`,
    );
  }
  if (manifest.dependencies?.[integrationPackageName] !== trackerVersion) {
    throw new Error(`Published source ${demo.route} does not pin RXT to ${trackerVersion}.`);
  }
  if (demo.demoKind === 'playground' && manifest.dependencies?.['@rightxt/tracker-core'] !== trackerVersion) {
    throw new Error(`Published playground source ${demo.route} does not pin Core to ${trackerVersion}.`);
  }
  const lock = JSON.parse(await readFile(resolve(publishedRoot, 'package-lock.json'), 'utf8'));
  if (lock.packages?.['']?.dependencies?.[integrationPackageName] !== trackerVersion) {
    throw new Error(`Published source lockfile ${demo.route} does not pin RXT to ${trackerVersion}.`);
  }
  if (
    demo.demoKind === 'playground' &&
    lock.packages?.['']?.dependencies?.['@rightxt/tracker-core'] !== trackerVersion
  ) {
    throw new Error(`Published playground source lockfile ${demo.route} does not pin Core to ${trackerVersion}.`);
  }
  const files = await listFiles(publishedRoot);
  for (const file of files) {
    const relativePath = relative(publishedRoot, file).replaceAll('\\', '/');
    if (/(?:^|\/)(?:node_modules|dist|out-tsc|\.angular|\.vite|coverage)(?:\/|$)|\.tgz$/u.test(relativePath)) {
      throw new Error(`Published source ${demo.route} contains generated or private path ${relativePath}.`);
    }
  }
  for (const resource of getSharedResources(demo)) {
    await requirePath(
      resolve(publishedRoot, resource.target),
      `Published source ${demo.route} is missing materialized ${resource.target}.`,
    );
  }
  if (files.some((file) => /rxt-site-navigation\.(?:css|js)$/u.test(file))) {
    throw new Error(`Published source ${demo.route} contains live-site navigation infrastructure.`);
  }
  const canonicalManifest = JSON.parse(await readFile(resolve(canonicalRoot, 'package.json'), 'utf8'));
  if (canonicalManifest.dependencies?.[integrationPackageName] !== 'latest') {
    throw new Error(`Canonical manifest ${demo.route} unexpectedly changed during publication assembly.`);
  }
  if (demo.demoKind === 'playground' && canonicalManifest.dependencies?.['@rightxt/tracker-core'] !== 'latest') {
    throw new Error(`Canonical playground manifest ${demo.route} does not declare the shared validator dependency.`);
  }
}

export { findLocalDependency, readConsumerConditions, verifyConsumerTrackerProfile, verifyPublishedProjectSource };
