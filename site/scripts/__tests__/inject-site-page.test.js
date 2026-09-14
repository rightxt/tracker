import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WORK_ROOT } from '../../config.mjs';
import { injectSitePageMetadata } from '../inject-site-page.mjs';
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

    await injectSitePageMetadata(pageRoot, { route, trackerVersion: '1.0.0' });

    const html = await readFile(resolve(pageRoot, 'index.html'), 'utf8');
    expect(html).toContain(`<link rel="icon" href="${expectedHref}" type="image/svg+xml">`);
  });
});
