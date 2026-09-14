import { readFile, realpath } from 'node:fs/promises';
import { posix } from 'node:path';

import GithubSlugger from 'github-slugger';
import { JSDOM } from 'jsdom';
import { Marked, Renderer } from 'marked';

import { DOCUMENTATION_GROUPS, siteEntries, validateSiteEntries } from '../catalog.mjs';
import { PUBLIC_URL, REPOSITORY_ROOT, REPOSITORY_URL, SOURCE_REF } from '../config.mjs';
import { escapeHtml } from './html.mjs';
import { resolveOwnedPath } from './paths.mjs';

/**
 * Reads a Markdown source file and rejects symlinks that escape the repository root.
 *
 * @param {string} source Repository-relative .md path without traversal segments.
 * @param {string} repositoryRoot Owning repository root, overridable for fixtures.
 * @returns {Promise<string>} UTF-8 Markdown source.
 */
async function readDocumentationSource(source, repositoryRoot = REPOSITORY_ROOT) {
  if (typeof source !== 'string' || !/^(?:[\w-]+\/)*[\w-]+\.md$/u.test(source)) {
    throw new Error(`Invalid repository Markdown source: ${String(source)}.`);
  }
  const file = await realpath(resolveOwnedPath(repositoryRoot, source));
  resolveOwnedPath(await realpath(repositoryRoot), file);
  return readFile(file, 'utf8');
}

/**
 * Replaces `{{TRACKER_VERSION}}` with the current Tracker version.
 *
 * @param {string} markdown Markdown source.
 * @param {string} trackerVersion Tracker version from the root manifest.
 * @returns {string} Markdown with every placeholder occurrence replaced.
 */
function applyTrackerVersionPlaceholder(markdown, trackerVersion) {
  return markdown.replaceAll('{{TRACKER_VERSION}}', trackerVersion);
}

/**
 * Returns a relative route href that works at any deployment depth.
 *
 * @param {string} fromRoute Current route directory relative to the site root.
 * @param {string} toRoute Destination route directory; an empty string means the catalog.
 * @returns {string} Directory href relative to the current page.
 */
function getRouteHref(fromRoute, toRoute) {
  const target = posix.relative(fromRoute, toRoute);
  return target === '' ? './' : `${target}/`;
}

/**
 * Indexes documentation sources and sorts them by catalog metadata.
 *
 * @param {object[]} entries Validated catalog entries.
 * @param {string} publicUrl Normalized deployment base.
 * @returns {object} Ordered documents and source/route lookup maps.
 */
function createDocumentationContext(entries = siteEntries, publicUrl = PUBLIC_URL) {
  validateSiteEntries(entries);
  const groups = Object.keys(DOCUMENTATION_GROUPS);
  const documents = entries
    .filter((entry) => entry.kind === 'documentation')
    .toSorted((a, b) => groups.indexOf(a.navGroup) - groups.indexOf(b.navGroup) || a.navOrder - b.navOrder);
  const bySource = new Map();
  for (const entry of entries) {
    if (entry.kind === 'documentation') {
      bySource.set(entry.source, entry);
    } else {
      for (const suffix of ['', '/README.md', '/index.html']) {
        bySource.set(`site/${entry.source}${suffix}`, entry);
      }
    }
  }
  return { documents, bySource, byRoute: new Map(entries.map((entry) => [entry.route, entry])), publicUrl };
}

/**
 * Resolves local Markdown links while preserving explicit external and GitHub links.
 *
 * @param {string} href Authored link destination, including any query or fragment.
 * @param {object} entry Source document catalog entry.
 * @param {object} context Catalog indexes and public deployment base.
 * @returns {string} Local route href or preserved external/source URL.
 * @throws {Error} For unknown site routes or paths outside the repository root.
 */
function rewriteDocumentationLink(href, entry, context) {
  if (href.startsWith('#')) {
    return href;
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(href) || href.startsWith('//')) {
    if (!href.startsWith(context.publicUrl)) {
      return href;
    }
    const url = new URL(href);
    const base = new URL(context.publicUrl);
    const route = decodeURIComponent(url.pathname.slice(base.pathname.length)).replace(/\/$/u, '');
    if (route !== '' && !context.byRoute.has(route)) {
      throw new Error(`Unknown Pages route in ${entry.source}: ${href}.`);
    }
    return `${getRouteHref(entry.route, route)}${url.search}${url.hash}`;
  }
  if (href.startsWith('/')) {
    throw new Error(`Root-absolute Markdown destination in ${entry.source}: ${href}.`);
  }
  const url = new URL(href, `https://markdown.invalid/${entry.source}`);
  const source = decodeURIComponent(url.pathname.slice(1)).replace(/\/$/u, '');
  const destination = context.bySource.get(source);
  if (destination) {
    return `${getRouteHref(entry.route, destination.route)}${url.search}${url.hash}`;
  }
  resolveOwnedPath(REPOSITORY_ROOT, posix.dirname(entry.source), decodeURIComponent(href.split(/[?#]/u)[0]));
  return `${REPOSITORY_URL}/blob/${encodeURIComponent(SOURCE_REF)}/${source}${url.search}${url.hash}`;
}

/**
 * Parses Markdown and records headings for the table of contents.
 *
 * @param {string} markdown Markdown source; raw HTML is displayed as text.
 * @param {object} entry Source document catalog entry.
 * @param {object} context Catalog indexes used for structural link resolution.
 * @returns {object} Static HTML, page title, headings, and H2/H3 table of contents.
 * @throws {Error} When the document does not contain exactly one H1.
 */
function renderDocumentation(markdown, entry, context) {
  const headings = [];
  const slugger = new GithubSlugger();
  const renderer = new Renderer();
  const originalLink = renderer.link;
  const originalTable = renderer.table;
  renderer.heading = function heading({ tokens, depth }) {
    const content = this.parser.parseInline(tokens);
    const text = JSDOM.fragment(content).textContent;
    const id = slugger.slug(text);
    headings.push({ depth, id, text });
    return `<h${depth} id="${escapeHtml(id)}">${content}</h${depth}>\n`;
  };
  renderer.link = function link(token) {
    return originalLink.call(this, { ...token, href: rewriteDocumentationLink(token.href, entry, context) });
  };
  renderer.table = function table(token) {
    return `<div class="docs-table">${originalTable.call(this, token)}</div>`;
  };
  renderer.html = ({ text }) => escapeHtml(text);
  const parser = new Marked({ renderer, gfm: true, async: false });
  const html = parser.parse(markdown);
  const titles = headings.filter((heading) => heading.depth === 1);
  if (titles.length !== 1) {
    throw new Error(`${entry.source} must contain exactly one H1; found ${titles.length}.`);
  }
  return { html, headings, title: titles[0].text, toc: headings.filter(({ depth }) => depth === 2 || depth === 3) };
}

/**
 * Resolves a source file to its public site URL.
 *
 * @param {string} source Repository-relative consumer documentation/demo source.
 * @param {object} context Catalog indexes and public deployment base.
 * @returns {string} Absolute public Pages URL; rejects sources without a route.
 */
function getPublicSourceDestination(source, context) {
  const entry = context.bySource.get(source);
  if (!entry) {
    throw new Error(`No catalog route for source destination ${source}.`);
  }
  return new URL(`${entry.route}/`, context.publicUrl).href;
}

export {
  applyTrackerVersionPlaceholder,
  createDocumentationContext,
  getPublicSourceDestination,
  getRouteHref,
  readDocumentationSource,
  renderDocumentation,
  rewriteDocumentationLink,
};
