import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { TRACKER_PROFILE_BY_DEMO_KIND, siteEntries } from '../catalog.mjs';
import { SITE_ROOT } from '../config.mjs';
import { HOME_METADATA, SITE_METADATA } from '../metadata.mjs';
import { ARTIFACT_LAYOUT, getLiveRoute } from './artifact-layout.mjs';
import { escapeHtml, serializeAttributes } from './html.mjs';
import { injectSitePageMetadata } from './inject-site-page.mjs';
import { resolveOwnedPath } from './paths.mjs';

const DOCUMENTATION_RESOURCE = Object.freeze({
  actionLabel: 'Browse',
  description: 'Package guides, integration guidance, API reference, runtime behavior, and styling documentation.',
  kind: 'resource',
  route: 'docs',
  title: 'Documentation',
});
const DEMO_SECTIONS = Object.freeze([
  Object.freeze({ key: 'recipe', title: 'Recipes' }),
  Object.freeze({ key: 'scenario', title: 'Scenarios' }),
  Object.freeze({ key: 'playground', title: 'Playgrounds' }),
]);

/**
 * Renders one catalog card.
 *
 * @param {Record<string, unknown>} entry Catalog or root resource entry.
 * @param {(entry: Record<string, unknown>) => string} getSourceUrl Resolves a source link for the build mode.
 * @returns {string} Catalog card markup.
 */
function renderCatalogCard(entry, getSourceUrl) {
  const profile = entry.trackerProfile === 'debug' ? '<span class="catalog-card__badge">Debug</span>' : '';
  const meta = entry.kind === 'demo' ? `<span>${escapeHtml(entry.integration)}</span>${profile}` : '';
  const sourceAction =
    entry.kind !== 'demo' || entry.showSource === false
      ? ''
      : `<a${serializeAttributes({ 'aria-label': `Source — ${entry.title}`, class: 'catalog-card__action catalog-card__action--source', href: getSourceUrl(entry) })}>Source</a>`;
  const liveRoute = getLiveRoute(entry.route);
  const liveAction = entry.actionLabel ?? (entry.kind === 'tool' ? 'Open tool' : 'Live demo');
  return `
    <article class="catalog-card">
      ${meta === '' ? '' : `<div class="catalog-card__meta">${meta}</div>`}
      <h3>${escapeHtml(entry.title)}</h3>
      <p>${escapeHtml(entry.description)}</p>
      <div class="catalog-card__actions">
        <a${serializeAttributes({ 'aria-label': `${liveAction} — ${entry.title}`, class: 'catalog-card__action catalog-card__action--primary', href: `./${liveRoute}/` })}>${liveAction}</a>
        ${sourceAction}
      </div>
    </article>`;
}

/**
 * Renders the Documentation and Tools section.
 *
 * @param {(entry: Record<string, unknown>) => string} getSourceUrl Resolves a source link for the build mode.
 * @returns {string} Resources section markup.
 */
function renderResources(getSourceUrl) {
  const entries = [DOCUMENTATION_RESOURCE, ...siteEntries.filter((entry) => entry.kind === 'tool')];
  return `<section aria-labelledby="resources-title" class="catalog-section">
    <h2 id="resources-title">Resources</h2>
    <div class="catalog-grid">${entries.map((entry) => renderCatalogCard(entry, getSourceUrl)).join('')}</div>
  </section>`;
}

/**
 * Renders demo cards in catalog order.
 *
 * @param {(entry: Record<string, unknown>) => string} getSourceUrl Resolves a source link for the build mode.
 * @returns {string} Demo section markup.
 */
function renderCatalog(getSourceUrl) {
  return DEMO_SECTIONS.map(({ key, title }) => {
    const entries = siteEntries.filter((entry) => entry.kind === 'demo' && entry.demoKind === key);
    if (entries.length === 0) {
      return '';
    }
    const cards = entries.map((entry) => renderCatalogCard(entry, getSourceUrl)).join('');
    return `<section aria-labelledby="${key}-title" class="catalog-section">
        <h2 id="${key}-title">${title}</h2>
        <div class="catalog-grid">${cards}</div>
      </section>`;
  })
    .filter(Boolean)
    .join('\n');
}

/**
 * Builds the site shell and writes build metadata.
 *
 * @param {string} candidateRoot Temporary site output root.
 * @param {{
 *   builtAt: string,
 *   getSourceUrl: (entry: Record<string, unknown>) => string,
 *   inputFingerprint?: string,
 *   publishedSourcesBranch?: string,
 *   siteMode: 'dev' | 'production',
 *   sourceRevision: string | null,
 *   sourceRef: string,
 *   trackerDependencySource: 'local' | 'npm',
 *   trackerVersion: string,
 * }} build Build metadata.
 * @returns {Promise<void>} Resolves after shell materialization.
 */
async function assembleSite(
  candidateRoot,
  {
    builtAt,
    getSourceUrl,
    inputFingerprint,
    publishedSourcesBranch,
    siteMode,
    sourceRef,
    sourceRevision,
    trackerDependencySource,
    trackerVersion,
  },
) {
  const template = await readFile(resolve(SITE_ROOT, 'shell/index.template.html'), 'utf8');
  const html = template
    .replace('<!-- SITE_RESOURCES -->', renderResources(getSourceUrl))
    .replace('<!-- SITE_DEMOS -->', renderCatalog(getSourceUrl));

  await mkdir(candidateRoot, { recursive: true });
  await writeFile(resolve(candidateRoot, 'index.html'), html);
  await cp(resolve(SITE_ROOT, 'shell/styles.css'), resolve(candidateRoot, 'styles.css'));
  await cp(resolve(SITE_ROOT, 'shared/favicon.svg'), resolve(candidateRoot, 'favicon.svg'));
  const imagePath = resolve(candidateRoot, SITE_METADATA.image.path);
  await mkdir(dirname(imagePath), { recursive: true });
  await cp(resolve(SITE_ROOT, SITE_METADATA.image.source), imagePath);
  await injectSitePageMetadata(candidateRoot, { ...HOME_METADATA, trackerVersion });
  if (siteMode === 'production') {
    await writeFile(resolve(candidateRoot, '.nojekyll'), '');
  }
  await writeFile(
    resolve(candidateRoot, 'build-info.json'),
    `${JSON.stringify(
      {
        artifactLayout: ARTIFACT_LAYOUT,
        builtAt,
        ...(inputFingerprint === undefined ? {} : { inputFingerprint }),
        ...(publishedSourcesBranch === undefined ? {} : { publishedSourcesBranch }),
        siteMode,
        sourceRevision,
        sourceRef,
        trackerDependencySource,
        trackerProfilesByDemoKind: TRACKER_PROFILE_BY_DEMO_KIND,
        trackerVersion,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Replaces the site output only after the new build succeeds.
 *
 * @param {string} candidateRoot Verified temporary output root.
 * @param {string} outputRoot Final artifact root.
 * @param {string} backupRoot Owned backup root.
 * @returns {Promise<void>} Resolves after the verified output replaces the previous artifact.
 */
async function commitCandidate(candidateRoot, outputRoot, backupRoot) {
  resolveOwnedPath(SITE_ROOT, backupRoot);
  await rm(backupRoot, { force: true, recursive: true });

  let hadOutput = false;
  try {
    await rename(outputRoot, backupRoot);
    hadOutput = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    await rename(candidateRoot, outputRoot);
  } catch (error) {
    if (hadOutput) {
      await rename(backupRoot, outputRoot);
    }
    throw error;
  }
  await rm(backupRoot, { force: true, recursive: true });
}

export { assembleSite, commitCandidate, escapeHtml, renderCatalog, renderResources };
