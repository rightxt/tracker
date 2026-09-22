import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WORK_ROOT } from '../../config.mjs';
import { siteEntries } from '../../catalog.mjs';
import { HOME_METADATA, SITE_METADATA } from '../../metadata.mjs';
import { buildMarkdown, prepareDocumentation } from '../build-markdown.mjs';
import { createDocumentationContext } from '../documentation.mjs';
import { injectSitePageMetadata, replacePageMetadata } from '../inject-site-page.mjs';
import { resolveOwnedPath } from '../paths.mjs';

let temporaryRoot;

beforeAll(async () => {
  await mkdir(WORK_ROOT, { recursive: true });
  temporaryRoot = await mkdtemp(resolve(WORK_ROOT, 'inject-site-page-'));
});

afterAll(async () => {
  if (temporaryRoot !== undefined) {
    resolveOwnedPath(WORK_ROOT, temporaryRoot);
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

describe('site page favicon metadata', () => {
  it.each([
    ['', './favicon.svg'],
    ['docs', '../favicon.svg'],
    ['recipes/document', '../../favicon.svg'],
  ])('injects a depth-relative favicon link for route %j', async (route, expectedHref) => {
    const pageRoot = resolve(temporaryRoot, route === '' ? 'root' : route.replaceAll('/', '-'));
    await mkdir(pageRoot, { recursive: true });
    await writeFile(resolve(pageRoot, 'index.html'), '<!doctype html><html><head></head><body></body></html>');

    const page = route === '' ? HOME_METADATA : siteEntries.find((entry) => entry.route === route);
    await injectSitePageMetadata(pageRoot, { ...page, trackerVersion: '1.0.0' });

    const html = await readFile(resolve(pageRoot, 'index.html'), 'utf8');
    const dom = new JSDOM(html);
    try {
      const icon = dom.window.document.head.querySelector('link[rel="icon"]');
      expect(dom.window.document.title).toBe(page.documentTitle);
      expect(icon.getAttribute('href')).toBe(expectedHref);
      expect(icon.getAttribute('type')).toBe('image/svg+xml');
    } finally {
      dom.window.close();
    }
  });

  it('replaces managed tags while preserving unrelated head content and remaining idempotent', () => {
    const resources =
      '<!-- <title>Comment</title> --><script>const x = "<title>Script</title>";</script><link href="a.css" rel="stylesheet"><link rel="modulepreload" href="a.js"><meta name="custom" content="keep">';
    const html = `<html lang="fr"><head><title>Old</title><title>Duplicate</title><meta name="description" content="Old"><meta property="og:title" content="Old"><link rel="canonical" href="https://old.invalid/">${resources}</head><body>Unchanged</body></html>`;
    const result = replacePageMetadata(html, HOME_METADATA);
    expect(result).toContain(resources);
    expect(result).toContain('<body>Unchanged</body>');
    expect(replacePageMetadata(result, HOME_METADATA)).toBe(result);
    const dom = new JSDOM(result);
    try {
      const { document } = dom.window;
      expect(document.documentElement.lang).toBe(SITE_METADATA.language);
      for (const selector of [
        'title',
        'meta[name="description"]',
        'meta[property="og:title"]',
        'link[rel="canonical"]',
      ]) {
        expect(document.head.querySelectorAll(selector)).toHaveLength(1);
      }
    } finally {
      dom.window.close();
    }
  });

  it('injects a Markdown page title independently of its H1', async () => {
    const entry = siteEntries.find((page) => page.route === 'docs/guides/custom-integration');
    const context = await prepareDocumentation('1.0.0', { ...createDocumentationContext(), documents: [entry] });
    const output = await buildMarkdown({ aggregateRoot: temporaryRoot, entry, context, trackerVersion: '1.0.0' });
    const dom = new JSDOM(await readFile(resolve(output, 'index.html'), 'utf8'));
    try {
      expect(dom.window.document.title).toBe(entry.documentTitle);
      expect(dom.window.document.querySelector('h1').textContent).toBe('Building a custom integration');
    } finally {
      dom.window.close();
    }
  });
});
