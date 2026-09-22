import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { getPublishablePackageName, getPublishablePackageNames } from '../../scripts/lib/workspace-pack.mjs';
import { SITE_ROOT } from '../config.mjs';
import { getLiveRoute, isPublishedSourcePath } from './artifact-layout.mjs';
import { injectSitePageMetadata } from './inject-site-page.mjs';
import { materializeSharedResources } from './materialize-shared.mjs';
import { resolveOwnedPath } from './paths.mjs';
import { runCommand } from './process.mjs';

/** Core subpaths whose conditional exports are consumed by each adapter. */
const CORE_EXPORTS_BY_INTEGRATION = Object.freeze({
  angular: ['.', './projection'],
  element: ['.', './projection'],
  react: ['.', './projection'],
  vanilla: ['.', './renderer'],
  vue: ['.', './projection'],
});

/** Published Tracker package names pinned in production source snapshots. */
const PUBLISHABLE_PACKAGE_NAMES = new Set(getPublishablePackageNames());

/** Windows fail-fast status eligible for one npm-install recovery attempt. */
const WINDOWS_FAST_FAIL_EXIT_CODE = 0xc0000409;

/**
 * Locates a built index entry below a project dist directory.
 *
 * @param {string} directory Directory to inspect.
 * @returns {Promise<string | null>} Directory containing index.html, or null.
 */
async function findBuiltRoot(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'index.html')) {
    return directory;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findBuiltRoot(resolve(directory, entry.name));
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Rewrites only the temporary local consumer manifest to file tarballs.
 *
 * @param {Record<string, unknown>} manifest Consumer manifest copy.
 * @param {Map<string, string>} tarballs Local package tarballs.
 * @returns {Record<string, unknown>} Rewritten manifest.
 */
function rewriteLocalManifest(manifest, tarballs) {
  const rewritten = structuredClone(manifest);
  const dependencies = { ...(rewritten.dependencies ?? {}) };
  for (const [packageName, tarball] of tarballs) {
    if (packageName === '@rightxt/tracker-core' || Object.hasOwn(dependencies, packageName)) {
      dependencies[packageName] = pathToFileURL(tarball).href;
    }
  }
  rewritten.dependencies = dependencies;
  return rewritten;
}

/**
 * Pins direct Tracker dependencies to the published version.
 *
 * @param {Record<string, unknown>} manifest Consumer manifest copy.
 * @param {string} trackerVersion Exact published package version.
 * @returns {Record<string, unknown>} Rewritten manifest.
 */
function rewritePublishedManifest(manifest, trackerVersion) {
  const rewritten = structuredClone(manifest);
  const dependencies = { ...(rewritten.dependencies ?? {}) };
  for (const packageName of Object.keys(dependencies)) {
    if (PUBLISHABLE_PACKAGE_NAMES.has(packageName)) {
      dependencies[packageName] = trackerVersion;
    }
  }
  rewritten.dependencies = dependencies;
  return rewritten;
}

/**
 * Verifies that an installed debug consumer has every required public Core development export.
 *
 * @param {string} projectRoot Installed temporary consumer root.
 * @param {{ integration: string, route: string, trackerProfile: string }} entry Consumer site entry.
 * @returns {Promise<void>} Resolves when the installed package supports the claimed profile.
 */
async function verifyInstalledTrackerProfile(projectRoot, entry) {
  if (entry.trackerProfile !== 'debug') {
    return;
  }

  try {
    const consumerRequire = createRequire(resolve(projectRoot, 'package.json'));
    const integrationManifestPath = consumerRequire.resolve(
      `${getPublishablePackageName(entry.integration)}/package.json`,
    );
    const integrationRequire = createRequire(integrationManifestPath);
    const coreManifestPath = integrationRequire.resolve('@rightxt/tracker-core/package.json');
    const coreManifest = JSON.parse(await readFile(coreManifestPath, 'utf8'));
    for (const subpath of CORE_EXPORTS_BY_INTEGRATION[entry.integration] ?? []) {
      const developmentExport = coreManifest.exports?.[subpath]?.development;
      if (typeof developmentExport !== 'string') {
        throw new Error(`@rightxt/tracker-core does not publish a development condition for ${subpath}.`);
      }
      await access(resolve(dirname(coreManifestPath), developmentExport));
    }
  } catch (error) {
    throw new Error(
      `${entry.route} requires the public debug Tracker profile, but its installed packages do not provide the required development exports. Production fallback is disabled.`,
      { cause: error },
    );
  }
}

/**
 * Builds one isolated consumer and copies its output into the site artifact.
 *
 * @param {{
 *   aggregateRoot: string,
 *   entry: { integration: string, route: string, source: string, trackerProfile: string },
 *   sourceSnapshotsRoot?: string,
 *   sourceUrl?: string,
 *   tarballs?: Map<string, string>,
 *   trackerVersion: string,
 *   workRoot: string,
 * }} options Build inputs.
 * @returns {Promise<string>} Built route directory.
 */
async function buildConsumer({
  aggregateRoot,
  entry,
  sourceSnapshotsRoot,
  sourceUrl,
  tarballs = new Map(),
  trackerVersion,
  workRoot,
}) {
  const sourceRoot = resolve(SITE_ROOT, entry.source);
  const projectRoot = resolveOwnedPath(workRoot, entry.route);
  const outputRoot = resolveOwnedPath(aggregateRoot, getLiveRoute(entry.route));

  await rm(projectRoot, { force: true, recursive: true });
  await mkdir(dirname(projectRoot), { recursive: true });
  await cp(sourceRoot, projectRoot, { recursive: true });
  await materializeSharedResources(projectRoot, entry);

  const manifestPath = resolve(projectRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const installedManifest =
    tarballs.size > 0 ? rewriteLocalManifest(manifest, tarballs) : rewritePublishedManifest(manifest, trackerVersion);
  await writeFile(manifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`);

  const dependencySource = tarballs.size > 0 ? 'local' : 'npm';
  const label = `Site consumer ${entry.route} (${dependencySource})`;
  await runCommand('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: projectRoot,
    label,
    retryExitCodes: process.platform === 'win32' ? [WINDOWS_FAST_FAIL_EXIT_CODE] : [],
  });
  await verifyInstalledTrackerProfile(projectRoot, entry);
  await runCommand('npm', ['run', 'build'], { cwd: projectRoot, label });

  const distRoot = resolve(projectRoot, 'dist');
  let builtRoot;
  try {
    builtRoot = await findBuiltRoot(distRoot);
  } catch (error) {
    throw new Error(`${label}: build produced no readable dist directory at ${distRoot}.`, { cause: error });
  }
  if (builtRoot === null) {
    throw new Error(`${label}: no index.html was found below ${distRoot}.`);
  }
  await injectSitePageMetadata(builtRoot, {
    ...entry,
    trackerVersion,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  });

  await rm(outputRoot, { force: true, recursive: true });
  await mkdir(dirname(outputRoot), { recursive: true });
  await cp(builtRoot, outputRoot, { recursive: true });
  if (sourceSnapshotsRoot !== undefined) {
    const sourceOutputRoot = resolveOwnedPath(sourceSnapshotsRoot, entry.route);
    await rm(sourceOutputRoot, { force: true, recursive: true });
    await mkdir(dirname(sourceOutputRoot), { recursive: true });
    await cp(projectRoot, sourceOutputRoot, {
      filter: (candidate) => isPublishedSourcePath(projectRoot, candidate),
      recursive: true,
    });
  }
  console.log(`Built consumer ${entry.route} from ${dependencySource} dependencies.`);
  return outputRoot;
}

export { buildConsumer, findBuiltRoot, rewriteLocalManifest, rewritePublishedManifest, verifyInstalledTrackerProfile };
