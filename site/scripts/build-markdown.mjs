import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DOCUMENTATION_GROUPS } from '../catalog.mjs';
import { SITE_ROOT } from '../config.mjs';
import { escapeHtml, serializeAttributes } from './html.mjs';
import {
  applyTrackerVersionPlaceholder,
  createDocumentationContext,
  getRouteHref,
  readDocumentationSource,
  renderDocumentation,
} from './documentation.mjs';
import { injectSitePageMetadata } from './inject-site-page.mjs';
import { resolveOwnedPath } from './paths.mjs';

/**
 * Reads and renders documentation before consumer builds.
 *
 * @param {string} trackerVersion Tracker version substituted for `{{TRACKER_VERSION}}`.
 * @param {object} context Catalog indexes in approved navigation order.
 * @returns {Promise<object>} Context extended with source-keyed rendered page data.
 */
async function prepareDocumentation(trackerVersion, context = createDocumentationContext()) {
  const pages = new Map();
  for (const entry of context.documents) {
    const markdown = applyTrackerVersionPlaceholder(await readDocumentationSource(entry.source), trackerVersion);
    pages.set(entry.source, renderDocumentation(markdown, entry, context));
  }
  return { ...context, pages };
}

/**
 * Renders grouped documentation navigation with the current page marked.
 *
 * @param {object} entry Current documentation entry.
 * @param {object} context Prepared catalog indexes and page titles.
 * @returns {string} Static grouped navigation markup.
 */
function renderDocumentationTree(entry, context) {
  return Object.entries(DOCUMENTATION_GROUPS)
    .map(([key, label]) => {
      const items = context.documents
        .filter((document) => document.navGroup === key)
        .map((document) => {
          const title = document.navTitle ?? context.pages.get(document.source).title;
          const attributes = {
            class: 'docs-navigation__link',
            href: getRouteHref(entry.route, document.route),
            ...(document.route === entry.route ? { 'aria-current': 'page' } : {}),
          };
          return `<li><a${serializeAttributes(attributes)}>${escapeHtml(title)}</a></li>`;
        })
        .join('');
      return `${key === 'overview' ? '' : `<p class="docs-navigation__group">${label}</p>`}<ul>${items}</ul>`;
    })
    .join('');
}

/**
 * Builds one documentation route from Markdown without requiring JavaScript.
 *
 * @param {object} options Build inputs.
 * @param {string} options.aggregateRoot Owned output root.
 * @param {object} options.entry Documentation catalog entry.
 * @param {string} [options.sourceUrl] Optional source metadata; documentation pages do not show a Source link.
 * @param {object} options.context Prepared documents and catalog indexes.
 * @param {string} options.trackerVersion Tracker version for the generated page.
 * @returns {Promise<string>} Created route directory containing HTML and presentation assets.
 */
async function buildMarkdown({ aggregateRoot, entry, sourceUrl, context, trackerVersion }) {
  if (entry.kind !== 'documentation' || entry.buildKind !== 'markdown') {
    throw new Error(`${entry.route} is not a Markdown documentation entry.`);
  }
  const page = context.pages.get(entry.source);
  const iconsHref = `${getRouteHref(entry.route, 'docs')}documentation-icons.svg#icon-btt`;
  const index = context.documents.findIndex((document) => document.route === entry.route);
  const neighbors = [
    ['Previous', context.documents[index - 1]],
    ['Next', context.documents[index + 1]],
  ]
    .filter(([, document]) => document !== undefined)
    .map(([label, document]) => {
      const direction = label === 'Previous' ? 'previous' : 'next';
      return `<a${serializeAttributes({ class: `docs-pagination__link docs-pagination__link--${direction}`, href: getRouteHref(entry.route, document.route), rel: label === 'Previous' ? 'prev' : 'next' })}><span class="docs-pagination__direction">${label}</span><span class="docs-pagination__title">${escapeHtml(document.navTitle ?? context.pages.get(document.source).title)}</span></a>`;
    })
    .join('');
  const toc = page.toc
    .map(
      ({ depth, id, text }) =>
        `<li class="docs-toc__level-${depth}"><a class="docs-toc__link" href="#${escapeHtml(id)}">${escapeHtml(text)}</a></li>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head><link href="./documentation.css" rel="stylesheet"><script src="./documentation.js" type="module"></script></head>
<body class="docs-page">
<a class="docs-skip" href="#docs-main">Skip to content</a>
<!-- SITE_NAVIGATION -->
<div class="docs-layout">
<div class="docs-navigation"><details open><summary>Documentation navigation</summary><nav aria-label="Documentation">${renderDocumentationTree(entry, context)}</nav></details></div>
<main id="docs-main" tabindex="-1"><article class="docs-content">${page.html}</article><nav aria-label="Previous and next" class="docs-pagination">${neighbors}</nav></main>
<div class="docs-toc"><details open><summary>On this page</summary><nav aria-label="On this page"><ul>${toc}<li><a class="docs-back-to-top" href="#docs-main"><svg aria-hidden="true" class="docs-back-to-top__icon" focusable="false"><use href="${iconsHref}"></use></svg><span>Back to top</span></a></li></ul></nav></details></div>
</div></body></html>`;
  const outputRoot = resolveOwnedPath(aggregateRoot, entry.route);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, 'index.html'), html);
  await cp(resolve(SITE_ROOT, 'shared/documentation.css'), resolve(outputRoot, 'documentation.css'));
  await cp(resolve(SITE_ROOT, 'shared/documentation.js'), resolve(outputRoot, 'documentation.js'));
  if (entry.route === 'docs') {
    await cp(resolve(SITE_ROOT, 'shared/documentation-icons.svg'), resolve(outputRoot, 'documentation-icons.svg'));
  }
  await injectSitePageMetadata(outputRoot, { ...entry, sourceUrl, trackerVersion });
  return outputRoot;
}

export { buildMarkdown, prepareDocumentation, renderDocumentationTree };
