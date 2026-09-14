import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { siteEntries } from '../catalog.mjs';
import { SITE_ROOT } from '../config.mjs';
import { getHomeHref, getNavigationLinks, getSourceAction } from '../shared/navigation/model.js';
import { escapeHtml } from './html.mjs';

/**
 * Injects site navigation metadata before the page application starts.
 *
 * @param {string} builtRoot Built site-entry root.
 * @param {{ route: string, sourceUrl?: string, trackerVersion: string }} page Site page descriptor.
 * @returns {Promise<void>} Resolves after page metadata and navigation assets are written.
 */
async function injectSitePageMetadata(builtRoot, page) {
  if (typeof page.trackerVersion !== 'string' || page.trackerVersion.length === 0) {
    throw new Error('Site page metadata requires a Tracker version.');
  }
  const entry = siteEntries.find((candidate) => candidate.route === page.route);
  const source = getSourceAction({ ...entry, sourceUrl: page.sourceUrl });
  const descriptor = {
    route: page.route,
    kind: entry?.kind,
    trackerVersion: page.trackerVersion,
    ...(source === undefined ? {} : { sourceUrl: source.href }),
  };
  const indexPath = resolve(builtRoot, 'index.html');
  const siteStyleName = 'rxt-site-navigation.css';
  const siteScriptName = 'rxt-site-navigation.js';
  await cp(resolve(SITE_ROOT, 'shared/navigation/rxt-site-navigation.css'), resolve(builtRoot, siteStyleName));
  await cp(resolve(SITE_ROOT, 'shared/navigation/rxt-site-navigation.js'), resolve(builtRoot, siteScriptName));
  await cp(resolve(SITE_ROOT, 'shared/navigation/model.js'), resolve(builtRoot, 'model.js'));
  const navigation = `<div class="site-bar"><nav class="site-navigation" aria-label="Site navigation"><span class="site-navigation__identity"><span class="site-navigation__brand">RXT Tracker</span><span class="site-navigation__version">v${escapeHtml(page.trackerVersion)}</span></span><span class="site-navigation__links">${getNavigationLinks(
    page.route,
  )
    .map(({ label, href }) => `<a class="site-navigation__link" href="${escapeHtml(href)}">${label}</a>`)
    .join(
      '',
    )}</span></nav>${source === undefined ? '' : `<a class="site-source" href="${escapeHtml(source.href)}">Source</a>`}</div>`;
  const faviconHref = `${getHomeHref(page.route)}favicon.svg`;
  const metadata = `<link rel="icon" href="${escapeHtml(faviconHref)}" type="image/svg+xml"><link rel="stylesheet" href="./${siteStyleName}"><script>globalThis.RXT_SITE_PAGE=${JSON.stringify(descriptor)};</script><script type="module" src="./${siteScriptName}"></script>`;
  const html = await readFile(indexPath, 'utf8');
  if (!html.includes('</head>')) {
    throw new Error(`Built site entry at ${builtRoot} has no closing head element.`);
  }
  const withMetadata = html.replace('</head>', `${metadata}</head>`);
  const withNavigation = withMetadata.includes('<!-- SITE_NAVIGATION -->')
    ? withMetadata.replace('<!-- SITE_NAVIGATION -->', navigation)
    : withMetadata.replace(/(<body\b[^>]*>)/u, `$1${navigation}`);
  await writeFile(indexPath, withNavigation);
}

export { injectSitePageMetadata };
