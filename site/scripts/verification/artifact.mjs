import { access, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';

import { demos, siteEntries } from '../../catalog.mjs';
import { getHomeHref } from '../../shared/navigation/model.js';
import {
  ARTIFACT_LAYOUT,
  getLiveRoute,
  getPublishedDemoSourceUrl,
  getRepositorySourceUrl,
} from '../artifact-layout.mjs';
import { listFiles, requireAbsentPath, requirePath } from './filesystem.mjs';
import { verifyDocumentationArtifact, verifyGlobalNavigation } from './documentation.mjs';
import { verifyPublishedProjectSource } from './source.mjs';

/**
 * Verifies local asset references in an assembled site artifact.
 *
 * JavaScript bundle contents are not inspected.
 *
 * @param {string} artifactRoot Generated site root.
 * @returns {Promise<void>} Resolves when references remain self-contained.
 */
async function verifyReferences(artifactRoot) {
  const files = await listFiles(artifactRoot);
  const referencePattern = /(?:href|src)=["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gu;

  for (const file of files) {
    if (!['.css', '.html'].includes(extname(file))) {
      continue;
    }
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(referencePattern)) {
      const reference = match[1] ?? match[2];
      if (
        reference.startsWith('#') ||
        reference.startsWith('data:') ||
        reference.startsWith('http://') ||
        reference.startsWith('https://') ||
        reference.startsWith('mailto:')
      ) {
        continue;
      }
      if (reference.startsWith('/')) {
        throw new Error(`Root-absolute reference ${reference} in ${relative(artifactRoot, file)}.`);
      }
      const cleanReference = reference.split(/[?#]/u, 1)[0];
      if (cleanReference === '') {
        continue;
      }
      const target = resolve(dirname(file), cleanReference);
      const relativeTarget = relative(artifactRoot, target);
      if (relativeTarget.startsWith('..')) {
        throw new Error(`Reference escapes the site artifact: ${reference} in ${relative(artifactRoot, file)}.`);
      }
      await requirePath(target, `Missing asset ${reference} from ${relative(artifactRoot, file)}.`);
    }
  }
}

/**
 * Verifies routes, references, and build metadata in an assembled site artifact.
 *
 * @param {string} artifactRoot Generated site root.
 * @param {{
 *   trackerDependencySource: 'local' | 'npm',
 *   getSourceUrl: (entry: Record<string, unknown>) => string,
 *   siteMode: 'dev' | 'production',
 *   sourceRef: string,
 *   trackerVersion: string,
 * }} expected Build assertions.
 * @returns {Promise<Record<string, unknown>>} Parsed build metadata.
 */
async function verifyArtifact(
  artifactRoot,
  { trackerDependencySource, getSourceUrl, siteMode, sourceRef, trackerVersion },
) {
  await requirePath(resolve(artifactRoot, 'index.html'), 'Generated site is missing index.html.');
  await requirePath(resolve(artifactRoot, 'favicon.svg'), 'Generated site is missing favicon.svg.');
  for (const entry of siteEntries) {
    const routeIndex = resolve(artifactRoot, getLiveRoute(entry.route), 'index.html');
    await requirePath(routeIndex, `Generated route ${entry.route} is missing index.html.`);
    const routeHtml = await readFile(routeIndex, 'utf8');
    const sourceUrl = getSourceUrl(entry);
    if (entry.kind === 'demo' && entry.showSource !== false && !routeHtml.includes(sourceUrl)) {
      throw new Error(`Generated route ${entry.route} does not use its configured source URL.`);
    }
    if (!routeHtml.includes(`"route":"${entry.route}"`)) {
      throw new Error(`Generated route ${entry.route} does not contain its site page descriptor.`);
    }
    if (!routeHtml.includes(`"trackerVersion":"${trackerVersion}"`)) {
      throw new Error(`Generated route ${entry.route} does not contain the Tracker version.`);
    }
    if (!routeHtml.includes('rxt-site-navigation.css') || !routeHtml.includes('rxt-site-navigation.js')) {
      throw new Error(`Generated route ${entry.route} is missing live-site navigation assets.`);
    }
    if (!routeHtml.includes(`<link rel="icon" href="${getHomeHref(entry.route)}favicon.svg" type="image/svg+xml">`)) {
      throw new Error(`Generated route ${entry.route} does not contain its favicon reference.`);
    }
  }
  const buildInfo = JSON.parse(await readFile(resolve(artifactRoot, 'build-info.json'), 'utf8'));
  if (buildInfo.artifactLayout !== ARTIFACT_LAYOUT) {
    throw new Error(`Generated artifact layout is ${String(buildInfo.artifactLayout)}; expected ${ARTIFACT_LAYOUT}.`);
  }
  if (buildInfo.trackerDependencySource !== trackerDependencySource) {
    throw new Error(
      `Generated dependency source is ${String(buildInfo.trackerDependencySource)}; expected ${trackerDependencySource}.`,
    );
  }
  if (buildInfo.siteMode !== siteMode) {
    throw new Error(`Generated site mode is ${String(buildInfo.siteMode)}; expected ${siteMode}.`);
  }
  if (siteMode === 'dev' && !/^[a-f0-9]{64}$/u.test(buildInfo.inputFingerprint)) {
    throw new Error('Development build metadata does not contain a deterministic input fingerprint.');
  }
  if (buildInfo.sourceRef !== sourceRef) {
    throw new Error(`Generated source ref is ${String(buildInfo.sourceRef)}; expected ${sourceRef}.`);
  }
  if (buildInfo.trackerVersion !== trackerVersion) {
    throw new Error(`Generated Tracker version is ${String(buildInfo.trackerVersion)}; expected ${trackerVersion}.`);
  }

  const landing = await readFile(resolve(artifactRoot, 'index.html'), 'utf8');
  if (!landing.includes('./docs/')) {
    throw new Error('Generated landing page is missing its documentation entry.');
  }
  if (!landing.includes(`<link rel="icon" href="${getHomeHref('')}favicon.svg" type="image/svg+xml">`)) {
    throw new Error('Generated landing page does not contain its favicon reference.');
  }
  for (const entry of siteEntries.filter((candidate) => candidate.kind !== 'documentation')) {
    if (!landing.includes(`./${getLiveRoute(entry.route)}/`)) {
      throw new Error(`Generated landing page does not link to ${entry.route}/.`);
    }
    if (entry.kind === 'demo' && entry.showSource !== false && !landing.includes(getSourceUrl(entry))) {
      throw new Error(`Generated landing page does not link to the configured source for ${entry.route}.`);
    }
  }
  await verifyReferences(artifactRoot);
  await verifyGlobalNavigation(artifactRoot, trackerVersion);
  await verifyDocumentationArtifact(artifactRoot, trackerVersion);
  return buildInfo;
}

/**
 * Verifies the development artifact and its development-only constraints.
 *
 * @param {string} artifactRoot Generated site root.
 * @param {{ sourceRef: string, trackerVersion: string }} expected Build assertions.
 * @returns {Promise<void>} Resolves when the development artifact is complete.
 */
async function verifyDevArtifact(artifactRoot, { sourceRef, trackerVersion }) {
  const buildInfo = await verifyArtifact(artifactRoot, {
    trackerDependencySource: 'local',
    getSourceUrl: (entry) => getRepositorySourceUrl(entry.source, sourceRef, { file: entry.kind === 'documentation' }),
    siteMode: 'dev',
    sourceRef,
    trackerVersion,
  });
  if (Object.hasOwn(buildInfo, 'publishedSourcesBranch')) {
    throw new Error('Development build metadata must not identify a published-sources branch.');
  }
  await requireAbsentPath(resolve(artifactRoot, '.nojekyll'), 'Development artifact must not contain .nojekyll.');
  try {
    await access(resolve(artifactRoot, 'sources'));
    throw new Error('Development artifact must not contain publication source snapshots.');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Verifies the npm-backed production artifact and its production-only constraints.
 *
 * @param {string} artifactRoot Generated site root.
 * @param {{ publishedSourcesBranch: string, sourceRef: string, trackerVersion: string }} expected Build assertions.
 * @returns {Promise<void>} Resolves when the publication artifact is complete.
 */
async function verifyProductionArtifact(artifactRoot, { publishedSourcesBranch, sourceRef, trackerVersion }) {
  await requirePath(resolve(artifactRoot, '.nojekyll'), 'Production site is missing .nojekyll.');
  const buildInfo = await verifyArtifact(artifactRoot, {
    trackerDependencySource: 'npm',
    getSourceUrl: (entry) =>
      entry.kind === 'demo'
        ? getPublishedDemoSourceUrl(entry.route, publishedSourcesBranch)
        : getRepositorySourceUrl(entry.source, sourceRef, { file: entry.kind === 'documentation' }),
    siteMode: 'production',
    sourceRef,
    trackerVersion,
  });
  if (buildInfo.publishedSourcesBranch !== publishedSourcesBranch) {
    throw new Error('Production build metadata does not identify its published-sources branch.');
  }
  for (const demo of demos) {
    await verifyPublishedProjectSource(artifactRoot, demo, trackerVersion);
  }
  for (const entry of siteEntries.filter((candidate) => candidate.kind !== 'demo')) {
    await requireAbsentPath(
      resolve(artifactRoot, 'sources', entry.route),
      `Production artifact must not publish a consumer source snapshot for ${entry.route}.`,
    );
  }
}

export { verifyArtifact, verifyDevArtifact, verifyProductionArtifact, verifyReferences };
