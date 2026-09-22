import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { getPublishablePackageName } from '../../scripts/lib/workspace-pack.mjs';
import { siteEntries } from '../catalog.mjs';
import {
  DEV_ARTIFACT_ROOT,
  DEV_BUILD_ROOT,
  DEV_CANDIDATE_ROOT,
  PUBLISHED_SOURCES_BRANCH,
  PRODUCTION_ARTIFACT_ROOT,
  PRODUCTION_BUILD_ROOT,
  PRODUCTION_CANDIDATE_ROOT,
  PRODUCTION_SOURCES_ROOT,
  REPOSITORY_ROOT,
  SITE_ROOT,
  SOURCE_REF,
} from '../config.mjs';
import { getPublishedDemoSourceUrl, getRepositorySourceUrl } from './artifact-layout.mjs';
import { assembleSite, commitCandidate } from './assemble-site.mjs';
import { buildConsumer } from './build-consumer.mjs';
import { buildMarkdown, prepareDocumentation } from './build-markdown.mjs';
import { buildStaticPage } from './build-static-page.mjs';
import { computeDevInputFingerprint } from './fingerprint.mjs';
import { prepareLocalPackages } from './prepare-local-packages.mjs';
import { runCommandCapture } from './process.mjs';
import { verifyDevArtifact, verifyProductionArtifact } from './verify.mjs';

/**
 * Reads one CLI option in --name=value form.
 *
 * @param {string} name Option name.
 * @returns {string | undefined} Option value.
 */
function readOption(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Checks that every required package version exists in npm before clean builds begin.
 *
 * @param {string[]} packageNames Required public packages.
 * @param {string} version Exact workspace version.
 * @returns {Promise<void>} Resolves when all versions are published.
 */
async function preflightNpmPackages(packageNames, version) {
  for (const packageName of packageNames) {
    try {
      const output = await runCommandCapture('npm', ['view', `${packageName}@${version}`, 'version', '--json'], {
        cwd: REPOSITORY_ROOT,
        label: `npm site preflight for ${packageName}@${version}`,
      });
      if (JSON.parse(output) !== version) {
        throw new Error(`Registry returned ${output.trim()} instead of ${version}.`);
      }
    } catch (error) {
      throw new Error(
        `npm site build: ${packageName}@${version} is not available from npm. Production builds do not fall back to local packages.`,
        { cause: error },
      );
    }
  }
}

async function main() {
  const mode = readOption('mode');
  if (mode !== 'dev' && mode !== 'production') {
    throw new Error(`Unknown site build mode: ${String(mode)}. Expected dev or production.`);
  }

  const rootManifest = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  const trackerVersion = rootManifest.version;
  const consumerEntries = siteEntries.filter((entry) => entry.buildKind === 'consumer');
  const requiredPackages = [
    ...new Set(consumerEntries.map((entry) => getPublishablePackageName(entry.integration))),
  ].sort();

  const isDev = mode === 'dev';
  const dependencySource = isDev ? 'local' : 'npm';
  const workRoot = isDev ? DEV_BUILD_ROOT : PRODUCTION_BUILD_ROOT;
  const candidateRoot = isDev ? DEV_CANDIDATE_ROOT : PRODUCTION_CANDIDATE_ROOT;
  const outputRoot = isDev ? DEV_ARTIFACT_ROOT : PRODUCTION_ARTIFACT_ROOT;
  const backupRoot = resolve(SITE_ROOT, '.work', `${mode}-site-backup`);
  const getSourceUrl = (entry) =>
    !isDev && entry.kind === 'demo'
      ? getPublishedDemoSourceUrl(entry.route, PUBLISHED_SOURCES_BRANCH)
      : getRepositorySourceUrl(entry.source, SOURCE_REF, { file: entry.kind === 'documentation' });
  const getVisibleSourceUrl = (entry) =>
    entry.kind === 'demo' && entry.showSource !== false ? getSourceUrl(entry) : undefined;
  const documentation = await prepareDocumentation(trackerVersion);
  let tarballs = new Map();
  if (isDev) {
    tarballs = await prepareLocalPackages(requiredPackages);
  } else {
    await preflightNpmPackages(['@rightxt/tracker-core', ...requiredPackages], trackerVersion);
  }

  if (!isDev) {
    await rm(PRODUCTION_SOURCES_ROOT, { force: true, recursive: true });
    await mkdir(PRODUCTION_SOURCES_ROOT, { recursive: true });
  }
  await rm(workRoot, { force: true, recursive: true });
  await rm(candidateRoot, { force: true, recursive: true });
  await mkdir(candidateRoot, { recursive: true });

  for (const entry of siteEntries) {
    if (entry.buildKind === 'consumer') {
      await buildConsumer({
        aggregateRoot: candidateRoot,
        entry,
        sourceSnapshotsRoot: !isDev && entry.kind === 'demo' ? PRODUCTION_SOURCES_ROOT : undefined,
        sourceUrl: getVisibleSourceUrl(entry),
        tarballs,
        trackerVersion,
        workRoot,
      });
      continue;
    }
    if (entry.buildKind === 'static') {
      await buildStaticPage({
        aggregateRoot: candidateRoot,
        entry,
        sourceUrl: getVisibleSourceUrl(entry),
        trackerVersion,
      });
      continue;
    }
    if (entry.buildKind === 'markdown') {
      await buildMarkdown({
        aggregateRoot: candidateRoot,
        entry,
        sourceUrl: getVisibleSourceUrl(entry),
        context: documentation,
        trackerVersion,
      });
      continue;
    }
    throw new Error(`Unsupported site build kind for ${entry.route}: ${entry.buildKind}.`);
  }

  let sourceRevision = null;
  try {
    sourceRevision = (
      await runCommandCapture('git', ['rev-parse', 'HEAD'], {
        cwd: REPOSITORY_ROOT,
        label: 'Read site source revision',
      })
    ).trim();
  } catch {
    // A source archive without Git metadata remains buildable.
  }
  const metadata = {
    builtAt: new Date().toISOString(),
    getSourceUrl,
    ...(isDev ? { inputFingerprint: await computeDevInputFingerprint() } : {}),
    publishedSourcesBranch: isDev ? undefined : PUBLISHED_SOURCES_BRANCH,
    siteMode: mode,
    sourceRevision,
    sourceRef: SOURCE_REF,
    trackerDependencySource: dependencySource,
    trackerVersion,
  };
  await assembleSite(candidateRoot, metadata);
  if (isDev) {
    await verifyDevArtifact(candidateRoot, { sourceRef: SOURCE_REF, trackerVersion });
  } else {
    await verifyProductionArtifact(candidateRoot, {
      sourceSnapshotsRoot: PRODUCTION_SOURCES_ROOT,
      publishedSourcesBranch: PUBLISHED_SOURCES_BRANCH,
      sourceRef: SOURCE_REF,
      trackerVersion,
    });
  }
  await commitCandidate(candidateRoot, outputRoot, backupRoot);
  console.log(`Generated ${outputRoot} from ${dependencySource} Tracker packages.`);
}

await main();
