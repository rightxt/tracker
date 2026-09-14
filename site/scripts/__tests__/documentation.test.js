import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DOCUMENTATION_GROUPS,
  TRACKER_PROFILE_BY_DEMO_KIND,
  demos,
  siteEntries,
  validateSiteEntries,
} from '../../catalog.mjs';
import { DEFAULT_PUBLIC_URL, SOURCE_REF, WORK_ROOT, normalizePublicUrl } from '../../config.mjs';
import { getNavigationLinks, getSourceAction } from '../../shared/navigation/model.js';
import { getPublishedDemoSourceUrl, getRepositorySourceUrl } from '../artifact-layout.mjs';
import { renderDocumentationTree } from '../build-markdown.mjs';
import {
  applyTrackerVersionPlaceholder,
  createDocumentationContext,
  getPublicSourceDestination,
  getRouteHref,
  readDocumentationSource,
  renderDocumentation,
  rewriteDocumentationLink,
} from '../documentation.mjs';
import { resolveOwnedPath } from '../paths.mjs';

const context = createDocumentationContext();
const overview = context.documents[0];
const core = context.byRoute.get('docs/packages/core');
let temporaryRoot;
const getSourceUrl = (entry) =>
  getRepositorySourceUrl(entry.source, SOURCE_REF, { file: entry.kind === 'documentation' });

beforeAll(async () => {
  await mkdir(WORK_ROOT, { recursive: true });
  temporaryRoot = await mkdtemp(resolve(WORK_ROOT, 'documentation-sources-'));
});

afterAll(async () => {
  if (temporaryRoot !== undefined) {
    resolveOwnedPath(WORK_ROOT, temporaryRoot);
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

describe('documentation registry and sources', () => {
  it('indexes registered documents in catalog navigation order and derives demo profiles', () => {
    const registeredDocuments = siteEntries.filter((entry) => entry.kind === 'documentation');
    const groups = Object.keys(DOCUMENTATION_GROUPS);
    const expectedOrder = registeredDocuments.toSorted(
      (first, second) =>
        groups.indexOf(first.navGroup) - groups.indexOf(second.navGroup) || first.navOrder - second.navOrder,
    );

    expect(context.documents).toEqual(expectedOrder);
    expect(new Set(context.documents.map((entry) => entry.route)).size).toBe(context.documents.length);
    expect(new Set(context.documents.map((entry) => entry.source)).size).toBe(context.documents.length);
    for (const entry of context.documents) {
      expect(context.byRoute.get(entry.route)).toBe(entry);
      expect(context.bySource.get(entry.source)).toBe(entry);
    }
    for (const entry of demos) {
      expect(entry.trackerProfile).toBe(TRACKER_PROFILE_BY_DEMO_KIND[entry.demoKind]);
    }
  });

  it.each([
    { route: '../outside' },
    { route: '/docs' },
    { route: 'docs/' },
    { buildKind: 'consumer' },
    { kind: 'unknown' },
    { navGroup: 'missing' },
    { navOrder: -1 },
    { navOrder: 1.5 },
    { source: '../README.md' },
    { source: 'C:/README.md' },
    { source: 'README.html' },
  ])('rejects malformed documentation entries: %j', (change) => {
    expect(() => validateSiteEntries([{ ...overview, ...change }])).toThrow();
  });

  it('rejects duplicate routes, sources, navigation positions and invalid demo profiles', () => {
    expect(() => validateSiteEntries([overview, overview])).toThrow('Duplicate site route');
    expect(() => validateSiteEntries([overview, { ...overview, route: 'other', navOrder: 2 }])).toThrow(
      'Duplicate documentation source',
    );
    expect(() => validateSiteEntries([overview, { ...overview, route: 'other', source: 'other.md' }])).toThrow(
      'navigation position',
    );
    expect(() => validateSiteEntries([{ ...demos[0], demoKind: 'missing', trackerProfile: undefined }])).toThrow(
      'Tracker profile',
    );
  });

  it('substitutes every TRACKER_VERSION placeholder and leaves other content unchanged', () => {
    const markdown = 'See @rightxt/tracker-vanilla@{{TRACKER_VERSION}} and {{TRACKER_VERSION}}/dist. Untouched text.';

    expect(applyTrackerVersionPlaceholder(markdown, '1.0.0')).toBe(
      'See @rightxt/tracker-vanilla@1.0.0 and 1.0.0/dist. Untouched text.',
    );
    expect(applyTrackerVersionPlaceholder('No placeholder here.', '1.0.0')).toBe('No placeholder here.');
  });

  it('rejects missing, traversing and symlink-escaping source files', async () => {
    const owner = resolve(temporaryRoot, 'source-owner');
    const outside = resolve(temporaryRoot, 'outside');
    await mkdir(owner);
    await mkdir(outside);
    await writeFile(resolve(outside, 'README.md'), '# Outside');
    await symlink(outside, resolve(owner, 'linked'), 'junction');

    await expect(readDocumentationSource('README.md', owner)).rejects.toThrow();
    await expect(readDocumentationSource('../outside/README.md', owner)).rejects.toThrow('Invalid repository Markdown');
    await expect(readDocumentationSource('linked/README.md', owner)).rejects.toThrow('escapes its owner directory');
  });
});

describe('Markdown rendering and links', () => {
  it('renders supported Markdown with unique IDs and an H2/H3-only TOC', () => {
    const page = renderDocumentation(
      '# **Title**\n\n## Repeat `code`\n\n### Repeat code\n\n#### Detail\n\n> Quote\n\n- *Item*\n\n```js\nconst value = "<button>";\n```\n\n| Name | Value |\n| --- | --- |\n| `a` | **b** |\n\n<script>alert(1)</script>\n',
      overview,
      context,
    );
    const document = JSDOM.fragment(page.html);

    expect(page.title).toBe('Title');
    expect(page.headings.map((heading) => heading.id)).toEqual(['title', 'repeat-code', 'repeat-code-1', 'detail']);
    expect(page.toc.map((heading) => heading.id)).toEqual(['repeat-code', 'repeat-code-1']);
    expect(document.querySelector('pre code.language-js').textContent).toContain('<button>');
    expect(document.querySelector('blockquote').textContent).toContain('Quote');
    expect(document.querySelector('li em').textContent).toBe('Item');
    expect(document.querySelector('table td code').textContent).toBe('a');
    expect(document.querySelector('script')).toBeNull();
  });

  it.each(['No heading', '# One\n\n# Two'])('requires exactly one H1: %s', (markdown) => {
    expect(() => renderDocumentation(markdown, overview, context)).toThrow('exactly one H1');
  });

  it('renders a complete route-safe documentation tree from the catalog', () => {
    const pages = new Map(context.documents.map((entry) => [entry.source, { title: entry.navTitle ?? entry.route }]));
    const tree = JSDOM.fragment(renderDocumentationTree(core, { ...context, pages }));
    const links = [...tree.querySelectorAll('a')];

    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      context.documents.map((entry) => getRouteHref(core.route, entry.route)),
    );
    expect(
      links.filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('href')),
    ).toEqual(['./']);
  });

  it('rewrites known source and site URLs while preserving query and fragment', () => {
    expect(rewriteDocumentationLink('../../docs/reference/core-api.md#events', core, context)).toBe(
      '../../reference/core-api/#events',
    );
    expect(rewriteDocumentationLink('packages/react/README.md', overview, context)).toBe('packages/react/');
    expect(rewriteDocumentationLink('site/demos/scenarios/styling/README.md', overview, context)).toBe(
      '../scenarios/styling/',
    );
    expect(rewriteDocumentationLink(`${DEFAULT_PUBLIC_URL}docs/reference/core-api/?mode=1#events`, core, context)).toBe(
      '../../reference/core-api/?mode=1#events',
    );
    expect(rewriteDocumentationLink(`${DEFAULT_PUBLIC_URL}#demos`, core, context)).toBe('../../../#demos');
    expect(rewriteDocumentationLink('#events', core, context)).toBe('#events');
  });

  it('preserves external links and rejects unsafe authored destinations', () => {
    for (const href of [
      'https://example.com/page#anchor',
      'https://github.com/rightxt/tracker/blob/main/packages/core/src/index.ts',
      'mailto:example@example.com',
    ]) {
      expect(rewriteDocumentationLink(href, overview, context)).toBe(href);
    }
    expect(() => rewriteDocumentationLink(`${DEFAULT_PUBLIC_URL}missing/`, core, context)).toThrow(
      'Unknown Pages route',
    );
    expect(() => rewriteDocumentationLink('/docs/', core, context)).toThrow('Root-absolute');
    expect(() => rewriteDocumentationLink('../outside.md', overview, context)).toThrow('escapes its owner');
  });

  it('normalizes public bases and resolves public source destinations', () => {
    const base = normalizePublicUrl('https://example.com/custom');

    expect(base).toBe('https://example.com/custom/');
    expect(rewriteDocumentationLink(`${base}docs/`, core, createDocumentationContext(siteEntries, base))).toBe(
      '../../',
    );
    expect(getPublicSourceDestination(core.source, context)).toBe(new URL(`${core.route}/`, DEFAULT_PUBLIC_URL).href);
    for (const invalid of [
      'http://example.com',
      '/tracker/',
      'https://user@example.com',
      'https://example.com/?query',
      'https://example.com/#hash',
    ]) {
      expect(() => normalizePublicUrl(invalid)).toThrow();
    }
  });

  it('keeps repository and publication Source destinations distinct', () => {
    expect(getSourceUrl(core)).toBe(
      `https://github.com/rightxt/tracker/blob/${encodeURIComponent(SOURCE_REF)}/packages/core/README.md`,
    );
    expect(getRepositorySourceUrl('demos/recipes/document', 'topic/docs')).toBe(
      'https://github.com/rightxt/tracker/tree/topic%2Fdocs/site/demos/recipes/document',
    );
    expect(getPublishedDemoSourceUrl('recipes/document', 'published-sources')).toBe(
      'https://github.com/rightxt/tracker/tree/published-sources/sources/recipes/document',
    );
  });

  it('computes global navigation for root and deep routes', () => {
    expect(getNavigationLinks('')).toEqual([
      { label: 'Home', href: './' },
      { label: 'Docs', href: './docs/' },
      { label: 'Demos', href: './#demos' },
      { label: 'Theme Builder', href: './tools/theme-builder/' },
    ]);
    expect(getNavigationLinks('docs/guides/custom-integration')).toEqual([
      { label: 'Home', href: '../../../' },
      { label: 'Docs', href: '../../../docs/' },
      { label: 'Demos', href: '../../../#demos' },
      { label: 'Theme Builder', href: '../../../tools/theme-builder/' },
    ]);
  });

  it('exposes Source only for a configured demo', () => {
    const sourceUrl = 'https://example.com/source';

    expect(getSourceAction({ kind: 'demo', sourceUrl })).toEqual({ label: 'Source', href: sourceUrl });
    expect(getSourceAction({ kind: 'demo', showSource: false, sourceUrl })).toBeUndefined();
    expect(getSourceAction({ kind: 'documentation', sourceUrl })).toBeUndefined();
    expect(getSourceAction({ kind: 'tool', sourceUrl })).toBeUndefined();
    expect(getSourceAction({ kind: 'demo' })).toBeUndefined();
  });
});
