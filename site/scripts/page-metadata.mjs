import { SITE_METADATA } from '../metadata.mjs';
import { escapeHtml, serializeAttributes } from './html.mjs';

/**
 * Resolves a site-relative public path without allowing it to escape the deployment base.
 *
 * @param {string} path Public route or asset path, optionally with query/fragment.
 * @returns {string} Absolute HTTPS URL without query or fragment.
 */
function resolveSiteUrl(path) {
  const clean = path.split(/[?#]/u, 1)[0].replace(/^\/+|\/+$/gu, '');
  if (/^[a-z][a-z\d+.-]*:/iu.test(clean) || /[\\\s]/u.test(clean)) {
    throw new Error(`Invalid public site path: ${path}.`);
  }
  const segments = clean.split('/').filter(Boolean);
  if (segments.some((segment) => /^(?:\.|\.\.)$/u.test(decodeURIComponent(segment)) || /%2f|%5c/iu.test(segment))) {
    throw new Error(`Public site path escapes its route: ${path}.`);
  }
  return new URL(segments.join('/'), SITE_METADATA.baseUrl).href;
}

/**
 * Converts a public route or HTML output path to its self-referencing canonical URL.
 *
 * @param {string} route Site-relative route; index.html is served through its directory.
 * @returns {string} Canonical URL following the site's directory trailing-slash convention.
 */
function resolveCanonicalUrl(route) {
  const url = new URL(resolveSiteUrl(route));
  url.pathname = url.pathname.replace(/(?:^|\/)index\.html$/u, '/');
  if (!url.pathname.endsWith('/') && !url.pathname.endsWith('.html')) {
    url.pathname += '/';
  }
  return url.href;
}

/**
 * Renders the complete static head metadata from an explicit page definition.
 *
 * @param {{ description: string, documentTitle: string, route: string }} page Public page definition.
 * @returns {string} Escaped metadata markup with deterministic attributes.
 */
function renderPageMetadata(page) {
  for (const key of ['documentTitle', 'description']) {
    if (typeof page[key] !== 'string' || page[key].trim() === '') {
      throw new Error(`Missing ${key} for site page ${page.route}.`);
    }
  }
  const canonicalUrl = resolveCanonicalUrl(page.route);
  const imageUrl = resolveSiteUrl(SITE_METADATA.image.path);
  const names = {
    viewport: SITE_METADATA.viewport,
    description: page.description,
    author: SITE_METADATA.author,
    robots: SITE_METADATA.robots,
    'twitter:card': 'summary_large_image',
    'twitter:title': page.documentTitle,
    'twitter:description': page.description,
    'twitter:image': imageUrl,
    'twitter:image:alt': SITE_METADATA.image.alt,
  };
  const properties = {
    'og:title': page.documentTitle,
    'og:type': 'website',
    'og:url': canonicalUrl,
    'og:image': imageUrl,
    'og:description': page.description,
    'og:site_name': SITE_METADATA.name,
    'og:locale': SITE_METADATA.locale,
    'og:image:type': SITE_METADATA.image.type,
    'og:image:width': SITE_METADATA.image.width,
    'og:image:height': SITE_METADATA.image.height,
    'og:image:alt': SITE_METADATA.image.alt,
  };
  return [
    { tag: 'meta', attributes: { charset: 'utf-8' } },
    { tag: 'title', attributes: {}, text: page.documentTitle },
    ...Object.entries(names).map(([name, content]) => ({ tag: 'meta', attributes: { content, name } })),
    { tag: 'link', attributes: { href: canonicalUrl, rel: 'canonical' } },
    ...Object.entries(properties).map(([property, content]) => ({ tag: 'meta', attributes: { content, property } })),
  ]
    .map(
      ({ tag, attributes, text }) =>
        `<${tag}${serializeAttributes(attributes)}>${tag === 'title' ? `${escapeHtml(text)}</title>` : ''}`,
    )
    .join('\n');
}

export { renderPageMetadata, resolveCanonicalUrl, resolveSiteUrl };
