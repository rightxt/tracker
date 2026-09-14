import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { Marked } from 'marked';

import { siteEntries } from '../../catalog.mjs';
import { REPOSITORY_ROOT } from '../../config.mjs';
import { getNavigationLinks } from '../../shared/navigation/model.js';
import { prepareDocumentation } from '../build-markdown.mjs';
import { getRouteHref } from '../documentation.mjs';
import { requirePath } from './filesystem.mjs';

/**
 * Compares generated and expected values and reports the scoped failure.
 *
 * @param {unknown} actual Observed serializable value.
 * @param {unknown} expected Required serializable value.
 * @param {string} description Route and contract being verified.
 */
function requireEqual(actual, expected, description) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

/**
 * Checks package documentation links while allowing explicit repository source links.
 *
 * @param {object} context Documentation entries and known consumer source destinations.
 */
async function verifyPackageDocumentationLinks(context) {
  for (const entry of context.documents.filter((document) => document.navGroup === 'packages')) {
    const markdown = await readFile(resolve(REPOSITORY_ROOT, entry.source), 'utf8');
    const parser = new Marked({
      walkTokens(token) {
        if (token.type !== 'link') {
          return;
        }
        const href = token.href;
        if (/^(?:\.\.\/)+docs\//u.test(href)) {
          throw new Error(`npm-unsafe documentation link in ${entry.source}: ${href}.`);
        }
        const source = href.replace(/^https:\/\/github\.com\/rightxt\/tracker\/blob\/main\//u, '').split('#')[0];
        if (source !== href && context.bySource.has(source)) {
          throw new Error(`Unreconciled consumer destination in ${entry.source}: ${href}.`);
        }
      },
    });
    parser.parse(markdown);
  }
}

/**
 * Verifies global navigation on the catalog and every registered route.
 *
 * @param {string} artifactRoot Generated candidate root.
 * @param {string} trackerVersion Expected Tracker version shown beside the shared identity.
 */
async function verifyGlobalNavigation(artifactRoot, trackerVersion) {
  for (const entry of [{ route: '' }, ...siteEntries]) {
    const document = JSDOM.fragment(await readFile(resolve(artifactRoot, entry.route, 'index.html'), 'utf8'));
    const navs = document.querySelectorAll('nav[aria-label="Site navigation"]');
    requireEqual(navs.length, 1, `${entry.route || '/'} global navigation count`);
    const navigationText = navs[0].textContent.replace(/\s+/gu, ' ').trim();
    if (!navigationText.includes('RXT Tracker') || !navigationText.includes(`v${trackerVersion}`)) {
      throw new Error(`${entry.route || '/'} global navigation is missing its site identity.`);
    }
    const links = [...navs[0].querySelectorAll('a')].map((link) => ({
      label: link.textContent,
      href: link.getAttribute('href'),
    }));
    requireEqual(links, getNavigationLinks(entry.route), `${entry.route || '/'} global navigation`);
  }
}

/**
 * Checks documentation navigation and local links under a non-root deployment path.
 *
 * @param {string} artifactRoot Generated candidate root containing all catalog routes.
 * @param {string} trackerVersion Expected Tracker version substituted into documentation sources.
 */
async function verifyDocumentationArtifact(artifactRoot, trackerVersion) {
  const context = await prepareDocumentation(trackerVersion);
  const documents = new Map();
  for (const entry of [{ route: '' }, ...siteEntries]) {
    const file = resolve(artifactRoot, entry.route, 'index.html');
    await requirePath(file, `Missing generated route ${entry.route || '/'}.`);
    documents.set(entry.route, JSDOM.fragment(await readFile(file, 'utf8')));
  }
  for (const [index, entry] of context.documents.entries()) {
    const document = documents.get(entry.route);
    const page = context.pages.get(entry.source);
    const tree = document.querySelector('nav[aria-label="Documentation"]');
    requireEqual(
      [...(tree?.querySelectorAll('a[href]') ?? [])].map((link) => link.getAttribute('href')),
      context.documents.map((target) => getRouteHref(entry.route, target.route)),
      `${entry.route} docs tree`,
    );
    requireEqual(
      [...(tree?.querySelectorAll('[aria-current="page"]') ?? [])].map((link) => link.getAttribute('href')),
      ['./'],
      `${entry.route} active page`,
    );
    requireEqual(
      [...document.querySelectorAll('nav[aria-label="On this page"] a[href]')].map((link) => link.getAttribute('href')),
      [...page.toc.map((heading) => `#${heading.id}`), '#docs-main'],
      `${entry.route} TOC`,
    );
    for (const [rel, target] of [
      ['prev', context.documents[index - 1]],
      ['next', context.documents[index + 1]],
    ]) {
      requireEqual(
        [...document.querySelectorAll(`nav[aria-label="Previous and next"] a[rel="${rel}"]`)].map((link) =>
          link.getAttribute('href'),
        ),
        target === undefined ? [] : [getRouteHref(entry.route, target.route)],
        `${entry.route} ${rel}`,
      );
    }

    const base = '/tracker/';
    const location = new URL(`${entry.route}/`, `https://candidate.invalid${base}`);
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      const target = new URL(href, location);
      if (target.origin !== location.origin) {
        if (href.startsWith(context.publicUrl)) {
          throw new Error(`Pages link was not localized in ${entry.route}: ${href}.`);
        }
        continue;
      }
      if (href.startsWith('/') || !target.pathname.startsWith(base)) {
        throw new Error(`Deployment-unsafe link in ${entry.route}: ${href}.`);
      }
      const route = decodeURIComponent(target.pathname.slice(base.length)).replace(/\/$/u, '');
      const destination = documents.get(route);
      if (destination === undefined) {
        throw new Error(`Broken internal route in ${entry.route}: ${href}.`);
      }
      if (target.hash !== '' && destination.getElementById(decodeURIComponent(target.hash.slice(1))) === null) {
        throw new Error(`Broken generated fragment in ${entry.route}: ${href}.`);
      }
    }
  }
  await verifyPackageDocumentationLinks(context);
}

export { verifyDocumentationArtifact, verifyGlobalNavigation, verifyPackageDocumentationLinks };
