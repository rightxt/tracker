import { relative } from 'node:path';

import { REPOSITORY_URL } from '../config.mjs';

const ARTIFACT_LAYOUT = 'site-flat-live-routes';
const EXCLUDED_SOURCE_ENTRIES = new Set([
  '.angular',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
  'npm-debug.log',
  'out-tsc',
]);

/**
 * Selects consumer files included in a published source snapshot.
 *
 * @param {string} projectRoot Temporary installed consumer project root.
 * @param {string} candidate Candidate path visited by fs.cp or verification.
 * @returns {boolean} Whether the path belongs to the source artifact.
 */
function isPublishedSourcePath(projectRoot, candidate) {
  const relativePath = relative(projectRoot, candidate);
  if (relativePath === '') {
    return true;
  }
  return relativePath.split(/[\\/]/u).every((segment) => !EXCLUDED_SOURCE_ENTRIES.has(segment));
}

/**
 * Returns the published directory containing one site entry.
 *
 * @param {string} route Public site route.
 * @returns {string} Artifact-relative live route.
 */
function getLiveRoute(route) {
  return route;
}

/**
 * Returns a repository source URL for a file or project.
 *
 * @param {string} source Repository-relative file or site-relative project directory.
 * @param {string} sourceRef Git ref containing the source.
 * @param {{ file?: boolean }} options Whether the source is a repository file.
 * @returns {string} Repository source URL.
 */
function getRepositorySourceUrl(source, sourceRef, { file = false } = {}) {
  if (file) {
    return `${REPOSITORY_URL}/blob/${encodeURIComponent(sourceRef)}/${source}`;
  }
  return `${REPOSITORY_URL}/tree/${encodeURIComponent(sourceRef)}/site/${source}`;
}

/**
 * Returns the URL of a published demo source snapshot.
 *
 * @param {string} route Logical demo route.
 * @param {string} publishedSourcesBranch Branch containing the published demo source snapshots.
 * @returns {string} Published source URL.
 */
function getPublishedDemoSourceUrl(route, publishedSourcesBranch) {
  return `${REPOSITORY_URL}/tree/${encodeURIComponent(publishedSourcesBranch)}/sources/${route}`;
}

export { ARTIFACT_LAYOUT, getLiveRoute, getPublishedDemoSourceUrl, getRepositorySourceUrl, isPublishedSourcePath };
