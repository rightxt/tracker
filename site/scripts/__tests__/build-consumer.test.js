import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';

import { siteEntries } from '../../catalog.mjs';
import { SITE_ROOT, WORK_ROOT } from '../../config.mjs';
import { buildConsumer } from '../build-consumer.mjs';
import { resolveOwnedPath } from '../paths.mjs';

// Isolate package installation/build processes; exercise the real copying and injection paths.
vi.mock('../process.mjs', () => ({
  runCommand: async (_command, args, { cwd }) => {
    if (args[0] === 'run') {
      await mkdir(resolve(cwd, 'dist'), { recursive: true });
      for (const file of ['index.html', 'child.html']) {
        await cp(resolve(cwd, file), resolve(cwd, 'dist', file));
      }
    }
  },
}));

it('injects consumer and secondary pages while preserving sources in separate staging', async () => {
  await mkdir(WORK_ROOT, { recursive: true });
  const root = await mkdtemp(resolve(WORK_ROOT, 'consumer-output-'));
  try {
    const catalogEntry = siteEntries.find((page) => page.route === 'scenarios/iframe-vanilla');
    if (!catalogEntry) {
      throw new Error('Missing scenarios/iframe-vanilla catalog entry.');
    }
    // This test covers page output and source staging, not debug package export validation.
    const entry = { ...catalogEntry, trackerProfile: 'production' };
    const aggregateRoot = resolve(root, 'pages');
    const sourceSnapshotsRoot = resolve(root, 'snapshots');
    const output = await buildConsumer({
      aggregateRoot,
      entry,
      sourceSnapshotsRoot,
      trackerVersion: '1.0.0',
      workRoot: resolve(root, 'work'),
    });
    for (const page of [{ ...entry, file: 'index.html' }, ...entry.pages]) {
      const dom = new JSDOM(await readFile(resolve(output, page.file), 'utf8'));
      try {
        expect(dom.window.document.title).toBe(page.documentTitle);
        if (page.file === 'child.html') {
          expect(dom.window.document.querySelector('link[rel="canonical"]').href).toMatch(
            /\/scenarios\/iframe-vanilla\/child\.html$/u,
          );
          expect(dom.window.document.querySelector('.site-bar')).toBeNull();
        }
      } finally {
        dom.window.close();
      }
    }
    expect(await readFile(resolve(sourceSnapshotsRoot, entry.route, 'index.html'))).toEqual(
      await readFile(resolve(SITE_ROOT, entry.source, 'index.html')),
    );
    await expect(stat(resolve(aggregateRoot, 'sources', entry.route))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    resolveOwnedPath(WORK_ROOT, root);
    await rm(root, { recursive: true, force: true });
  }
});
