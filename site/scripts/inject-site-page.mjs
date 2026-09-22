import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';

import { SITE_METADATA } from '../metadata.mjs';
import { SITE_ROOT } from '../config.mjs';
import { getHomeHref, getNavigationLinks, getSourceAction } from '../shared/navigation/model.js';
import { escapeHtml, serializeAttributes } from './html.mjs';
import { renderPageMetadata } from './page-metadata.mjs';
import { resolveOwnedPath } from './paths.mjs';

/** Standard metadata names replaced by the authoritative page contract. */
const MANAGED_NAMES = new Set(['author', 'description', 'robots', 'viewport']);

/**
 * Identifies only metadata owned by the site, including stale social definitions.
 *
 * @param {Element} element Parsed HTML element.
 * @returns {boolean} Whether this element belongs to the metadata contract.
 */
function isManagedMetadata(element) {
  if (element.localName === 'title') {
    return true;
  }
  if (element.localName === 'link') {
    return element.getAttribute('rel')?.toLowerCase().split(/\s+/u).includes('canonical') ?? false;
  }
  if (element.localName !== 'meta') {
    return false;
  }
  const name = element.getAttribute('name')?.toLowerCase() ?? '';
  const property = element.getAttribute('property')?.toLowerCase() ?? '';
  return (
    element.hasAttribute('charset') ||
    element.getAttribute('http-equiv')?.toLowerCase() === 'content-type' ||
    MANAGED_NAMES.has(name) ||
    /^(?:og|twitter):/u.test(name) ||
    /^(?:og|twitter):/u.test(property)
  );
}

/**
 * Replaces owned head elements while preserving every unrelated source byte.
 *
 * Parser locations avoid matching tags inside comments, scripts, styles, or quoted values.
 * Scripts and external resources are never executed or loaded.
 *
 * @param {string} html Complete source document with explicit html and head tags.
 * @param {object} page Explicit public page definition.
 * @returns {string} Idempotently normalized static HTML.
 */
function replacePageMetadata(html, page) {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  try {
    const { document } = dom.window;
    const head = dom.nodeLocation(document.head);
    const root = dom.nodeLocation(document.documentElement);
    if (!head?.startTag || !head.endTag || !root?.startTag) {
      throw new Error('Site metadata requires explicit html and head elements.');
    }
    const removals = [...document.head.children].filter(isManagedMetadata).map((element) => {
      const location = dom.nodeLocation(element);
      let start = location.startOffset;
      while (start > head.startTag.endOffset && /\s/u.test(html[start - 1])) {
        start -= 1;
      }
      return { start, end: location.endOffset };
    });
    let content = html.slice(head.startTag.endOffset, head.endTag.startOffset);
    for (const { start, end } of removals.toSorted((first, second) => second.start - first.start)) {
      content = content.slice(0, start - head.startTag.endOffset) + content.slice(end - head.startTag.endOffset);
    }
    const markup = renderPageMetadata(page);
    const attributes = Object.fromEntries(
      [...document.documentElement.attributes].map(({ name, value }) => [name, value]),
    );
    attributes.lang = SITE_METADATA.language;
    return (
      html.slice(0, root.startTag.startOffset) +
      `<html${serializeAttributes(attributes)}>` +
      html.slice(root.startTag.endOffset, head.startTag.endOffset) +
      `\n${markup}${content}` +
      html.slice(head.endTag.startOffset)
    );
  } finally {
    dom.window.close();
  }
}

/**
 * Injects shared site metadata and navigation into a built page.
 *
 * @param {string} builtRoot Built site-entry root.
 * @param {{ description: string, documentTitle: string, route: string, kind?: string, pages?: object[], sourceUrl?: string, trackerVersion: string }} page Site page descriptor.
 * @returns {Promise<void>} Resolves after page metadata and navigation assets are written.
 */
async function injectSitePageMetadata(builtRoot, page) {
  if (typeof page.trackerVersion !== 'string' || page.trackerVersion.length === 0) {
    throw new Error('Site page metadata requires a Tracker version.');
  }
  const source = getSourceAction(page);
  const descriptor = {
    route: page.route,
    kind: page.kind,
    trackerVersion: page.trackerVersion,
    ...(source === undefined ? {} : { sourceUrl: source.href }),
  };
  const indexPath = resolve(builtRoot, 'index.html');
  const siteStyleName = 'rxt-site-navigation.css';
  const siteScriptName = 'rxt-site-navigation.js';
  await cp(resolve(SITE_ROOT, 'shared/navigation/rxt-site-navigation.css'), resolve(builtRoot, siteStyleName));
  await cp(resolve(SITE_ROOT, 'shared/navigation/rxt-site-navigation.js'), resolve(builtRoot, siteScriptName));
  await cp(resolve(SITE_ROOT, 'shared/navigation/model.js'), resolve(builtRoot, 'model.js'));
  const navigation = `<div class="site-bar"><nav${serializeAttributes({ 'aria-label': 'Site navigation', class: 'site-navigation' })}><span class="site-navigation__identity"><span class="site-navigation__brand">RXT Tracker</span><span class="site-navigation__version">v${escapeHtml(page.trackerVersion)}</span></span><span class="site-navigation__links">${getNavigationLinks(
    page.route,
  )
    .map(
      ({ label, href }) =>
        `<a${serializeAttributes({ class: 'site-navigation__link', href })}>${escapeHtml(label)}</a>`,
    )
    .join(
      '',
    )}</span></nav>${source === undefined ? '' : `<a${serializeAttributes({ class: 'site-source', href: source.href })}>Source</a>`}</div>`;
  const faviconHref = `${getHomeHref(page.route)}favicon.svg`;
  const metadata = `<link${serializeAttributes({ href: faviconHref, rel: 'icon', type: 'image/svg+xml' })}><link${serializeAttributes({ href: `./${siteStyleName}`, rel: 'stylesheet' })}><script>globalThis.RXT_SITE_PAGE=${JSON.stringify(descriptor)};</script><script${serializeAttributes({ src: `./${siteScriptName}`, type: 'module' })}></script>`;
  const html = replacePageMetadata(await readFile(indexPath, 'utf8'), page);
  if (!html.includes('</head>')) {
    throw new Error(`Built site entry at ${builtRoot} has no closing head element.`);
  }
  const withMetadata = html.replace('</head>', `${metadata}</head>`);
  const withNavigation = withMetadata.includes('<!-- SITE_NAVIGATION -->')
    ? withMetadata.replace('<!-- SITE_NAVIGATION -->', navigation)
    : withMetadata.replace(/(<body\b[^>]*>)/u, `$1${navigation}`);
  await writeFile(indexPath, withNavigation);
  for (const child of page.pages ?? []) {
    const childPath = resolveOwnedPath(builtRoot, child.file);
    const childHtml = await readFile(childPath, 'utf8');
    await writeFile(childPath, replacePageMetadata(childHtml, { ...child, route: `${page.route}/${child.file}` }));
  }
}

export { injectSitePageMetadata, replacePageMetadata };
