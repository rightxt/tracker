import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SITE_ROOT } from '../config.mjs';
import { getLiveRoute } from './artifact-layout.mjs';
import { injectSitePageMetadata } from './inject-site-page.mjs';
import { resolveOwnedPath } from './paths.mjs';

/**
 * Copies a static site entry into the artifact.
 *
 * Static entries do not install packages, run consumer builds, or publish source snapshots.
 *
 * @param {{
 *   aggregateRoot: string,
 *   entry: { buildKind: string, route: string, source: string },
 *   sourceUrl?: string,
 *   trackerVersion: string,
 * }} options Static-page inputs.
 * @returns {Promise<string>} Generated live-route directory.
 */
async function buildStaticPage({ aggregateRoot, entry, sourceUrl, trackerVersion }) {
  if (entry.buildKind !== 'static') {
    throw new Error(`${entry.route} cannot use the static-page builder with build kind ${entry.buildKind}.`);
  }
  const sourceRoot = resolve(SITE_ROOT, entry.source);
  const outputRoot = resolveOwnedPath(aggregateRoot, getLiveRoute(entry.route));

  await rm(outputRoot, { force: true, recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await cp(resolveOwnedPath(sourceRoot, 'index.html'), resolveOwnedPath(outputRoot, 'index.html'));
  await cp(resolveOwnedPath(sourceRoot, 'src'), resolveOwnedPath(outputRoot, 'src'), { recursive: true });
  await injectSitePageMetadata(outputRoot, {
    ...entry,
    trackerVersion,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  });

  console.log(`Built static page ${entry.route}.`);
  return outputRoot;
}

export { buildStaticPage };
