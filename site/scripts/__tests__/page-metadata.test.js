import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { siteEntries, validateSiteEntries } from '../../catalog.mjs';
import { HOME_METADATA, SITE_METADATA } from '../../metadata.mjs';
import { serializeAttributes } from '../html.mjs';
import { renderPageMetadata, resolveCanonicalUrl, resolveSiteUrl } from '../page-metadata.mjs';

describe('page metadata renderer', () => {
  it('renders explicit content, escaped values and consistent social metadata', () => {
    const page = { ...HOME_METADATA, documentTitle: 'A < B & "C"', description: 'Description < & " >' };
    const dom = new JSDOM(`<head>${renderPageMetadata(page)}</head>`);
    try {
      const { document } = dom.window;
      const meta = (key) => document.querySelector(`meta[name="${key}"], meta[property="${key}"]`)?.content;
      expect(document.title).toBe(page.documentTitle);
      expect(meta('description')).toBe(page.description);
      expect(meta('author')).toBe(SITE_METADATA.author);
      expect(meta('robots')).toBe(SITE_METADATA.robots);
      expect(meta('viewport')).toBe(SITE_METADATA.viewport);
      const canonical = document.querySelector('link[rel="canonical"]').href;
      expect(canonical).toBe(resolveCanonicalUrl(page.route));
      expect(meta('og:url')).toBe(canonical);
      expect(meta('og:type')).toBe('website');
      expect(meta('og:site_name')).toBe(SITE_METADATA.name);
      expect(meta('og:locale')).toBe(SITE_METADATA.locale);
      expect(meta('twitter:card')).toBe('summary_large_image');
      for (const prefix of ['og', 'twitter']) {
        expect(meta(`${prefix}:title`)).toBe(page.documentTitle);
        expect(meta(`${prefix}:description`)).toBe(page.description);
        expect(meta(`${prefix}:image`)).toBe(resolveSiteUrl(SITE_METADATA.image.path));
        expect(meta(`${prefix}:image:alt`)).toBe(SITE_METADATA.image.alt);
      }
      for (const key of ['type', 'width', 'height']) {
        expect(meta(`og:image:${key}`)).toBe(SITE_METADATA.image[key]);
      }
    } finally {
      dom.window.close();
    }
  });

  it('sorts and escapes generated attributes', () => {
    expect(serializeAttributes({ name: 'description', content: 'A & "B"' })).toBe(
      ' content="A &amp; &quot;B&quot;" name="description"',
    );
  });

  it.each([
    ['', ''],
    ['/docs//index.html?view=1#top', 'docs/'],
    ['playgrounds/react', 'playgrounds/react/'],
    ['scenarios/iframe-vanilla/child.html#target', 'scenarios/iframe-vanilla/child.html'],
  ])('resolves canonical route %j', (route, path) => {
    expect(resolveCanonicalUrl(route)).toBe(`${SITE_METADATA.baseUrl}${path}`);
  });

  it.each(['../outside', '%2e%2e/outside', 'https://other.invalid/page', 'docs\\other', 'docs/%2foutside'])(
    'rejects unsafe route %s',
    (route) => expect(() => resolveCanonicalUrl(route)).toThrow(),
  );

  it.each(['description', 'documentTitle'])('requires %s without a fallback', (key) => {
    expect(() => renderPageMetadata({ ...HOME_METADATA, [key]: '' })).toThrow(`Missing ${key}`);
  });
});

describe('public page definitions', () => {
  it('keeps every document title explicit and independent of UI labels', () => {
    expect(() => validateSiteEntries(siteEntries)).not.toThrow();
    for (const entry of [HOME_METADATA, ...siteEntries]) {
      for (const page of [entry, ...(entry.pages ?? [])]) {
        expect(page.documentTitle.trim()).not.toBe('');
        expect(page.description.trim()).not.toBe('');
      }
      expect(renderPageMetadata({ ...entry, title: 'Other', navTitle: 'Other', kind: 'other' })).toBe(
        renderPageMetadata(entry),
      );
    }
  });

  it.each([
    { route: '' },
    { documentTitle: '' },
    { documentTitle: undefined },
    { description: '' },
    { pages: [{ file: 'child.html', description: 'Child' }] },
    { pages: [{ file: '../child.html', description: 'Child', documentTitle: 'Child' }] },
  ])('rejects incomplete or unsafe definitions: %j', (change) => {
    const entry = siteEntries.find((page) => page.kind === 'demo');
    expect(() => validateSiteEntries([{ ...entry, ...change }])).toThrow();
  });
});
