/* eslint-disable no-console -- Standalone distribution smoke reports its verified browser artifacts. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

/** Workspace root served read-only to the built-artifact browser page. */
const ROOT_DIRECTORY = resolve(import.meta.dirname, '../..');

/** Browser viewport used for deterministic layout availability. */
const VIEWPORT = Object.freeze({ height: 720, width: 1280 });

/** Minimal same-origin document used for both standalone package checks. */
const DOCUMENT_SHELL = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

/** Content types needed by the fixture server. */
const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
});

/** Returns a response content type for one served path. */
function getContentType(path) {
  const extension = Object.keys(CONTENT_TYPES).find((candidate) => path.endsWith(candidate));

  return extension === undefined ? 'application/octet-stream' : CONTENT_TYPES[extension];
}

/** Starts a read-only same-origin server for current package distribution files. */
function startFixtureServer() {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');

        if (url.pathname === '/dist-browser.html') {
          response.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] });
          response.end(DOCUMENT_SHELL);
          return;
        }

        const filePath = resolve(ROOT_DIRECTORY, `.${decodeURIComponent(url.pathname)}`);
        const workspaceRelativePath = relative(ROOT_DIRECTORY, filePath);

        if (workspaceRelativePath.startsWith('..') || isAbsolute(workspaceRelativePath)) {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }

        const content = await readFile(filePath);

        response.writeHead(200, { 'content-type': getContentType(filePath) });
        response.end(content);
      } catch {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        response.writeHead(404);
        response.end('Not found');
      }
    });

    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        server.close();
        rejectServer(new Error('Distribution fixture server did not expose a TCP port.'));
        return;
      }

      resolveServer({
        close: () =>
          new Promise((resolveClose) => {
            server.close(resolveClose);
          }),
        origin: `http://127.0.0.1:${String(address.port)}`,
      });
    });
  });
}

/**
 * Reports whether a diagnostic source URL is provably outside the owned fixture origin,
 * using only structured URL parsing (never message text or stack content).
 *
 * Missing, non-string, or unparseable source URLs are treated as unknown provenance and
 * are therefore NOT provably foreign, so callers keep failing closed on them.
 */
function isProvablyForeignSource(sourceUrl, ownedOrigin) {
  if (typeof sourceUrl !== 'string' || sourceUrl === '') {
    return false;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (parsedUrl.origin === ownedOrigin) {
    return false;
  }

  if (parsedUrl.origin !== 'null') {
    return true;
  }

  return parsedUrl.protocol === 'file:' || parsedUrl.protocol.endsWith('-extension:');
}

/** Creates a fresh page and collects uncaught and console diagnostic failures. */
async function createFixturePage(browser, origin) {
  const failures = [];
  const page = await browser.newPage({ viewport: VIEWPORT });

  page.context().on('weberror', (webError) => {
    if (webError.page() !== page) {
      return;
    }

    const sourceUrl = webError.location().url;

    if (isProvablyForeignSource(sourceUrl, origin)) {
      return;
    }

    failures.push({ kind: 'uncaught web error', message: webError.error().message, sourceUrl });
  });
  page.on('console', (message) => {
    const type = message.type();

    if (type !== 'error' && type !== 'warning') {
      return;
    }

    const sourceUrl = message.location().url;

    if (isProvablyForeignSource(sourceUrl, origin)) {
      return;
    }

    failures.push({
      kind: type === 'warning' ? 'console warning' : 'console error',
      message: message.text(),
      sourceUrl,
    });
  });
  await page.goto(`${origin}/dist-browser.html`);

  return { failures, page };
}

/** Verifies the built Vanilla standalone browser artifact and canonical CSS. */
async function checkVanillaArtifact(browser, origin) {
  const { failures, page } = await createFixturePage(browser, origin);

  try {
    await page.addStyleTag({ url: `${origin}/packages/vanilla/dist/rxt-tracker.css` });
    await page.addScriptTag({ url: `${origin}/packages/vanilla/dist/rxt-tracker-vanilla.js` });

    const result = await page.evaluate(() => {
      const sourceRoot = document.createElement('main');

      sourceRoot.innerHTML = '<section class="dist-probe"></section><section class="dist-probe"></section>';
      document.body.append(sourceRoot);

      const tracker = new window.RXTTracker({
        options: {
          clustering: { enabled: false },
          updates: {
            interval: { enabled: false },
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
          },
        },
        rules: [{ selector: '.dist-probe' }],
      });

      tracker.mount({ sourceRoot });

      const root = document.querySelector('.rxtt');
      const markerCount = root?.querySelectorAll('.rxtt__marker').length ?? 0;
      const rootPosition = root === null ? null : getComputedStyle(root).position;

      tracker.destroy();

      return {
        constructorType: typeof window.RXTTracker,
        markerCount,
        rootPosition,
        rootRemoved: document.querySelector('.rxtt') === null,
      };
    });

    assert.deepEqual(result, {
      constructorType: 'function',
      markerCount: 2,
      rootPosition: 'fixed',
      rootRemoved: true,
    });
    assert.deepEqual(failures, []);
  } finally {
    await page.close();
  }
}

/** Verifies the built Element standalone artifact, registration, rendering, and teardown. */
async function checkElementArtifact(browser, origin) {
  const { failures, page } = await createFixturePage(browser, origin);

  try {
    await page.addStyleTag({ url: `${origin}/packages/element/dist/rxt-tracker.css` });
    await page.addScriptTag({ url: `${origin}/packages/element/dist/rxt-tracker-element.js` });
    await page.evaluate(() => customElements.whenDefined('rxt-tracker'));

    await page.evaluate(() => {
      const sourceRoot = document.createElement('main');
      const probe = document.createElement('section');
      const tracker = document.createElement('rxt-tracker');

      probe.className = 'dist-element-probe';
      sourceRoot.append(probe);
      document.body.append(sourceRoot);
      tracker.replaceOptions({
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      });
      tracker.replaceRules([{ selector: '.dist-element-probe' }]);
      tracker.sourceRoot = sourceRoot;
      document.body.append(tracker);
    });
    await page.waitForFunction(() => document.querySelector('rxt-tracker .rxtt__marker') !== null);

    const result = await page.evaluate(() => {
      const tracker = document.querySelector('rxt-tracker');
      const markerCount = tracker?.querySelectorAll('.rxtt__marker').length ?? 0;

      tracker?.remove();

      return {
        constructorType: typeof window.RXTTrackerElement,
        markerCount,
        registered: customElements.get('rxt-tracker') === window.RXTTrackerElement,
        rootRemoved: tracker?.querySelector('.rxtt') === null,
      };
    });

    assert.deepEqual(result, {
      constructorType: 'function',
      markerCount: 1,
      registered: true,
      rootRemoved: true,
    });
    assert.deepEqual(failures, []);
  } finally {
    await page.close();
  }
}

const BROWSER_ENGINES = Object.freeze([
  ['Chromium', chromium],
  ['Firefox', firefox],
  ['WebKit', webkit],
]);

const server = await startFixtureServer();

try {
  for (const [name, browserType] of BROWSER_ENGINES) {
    const browser = await browserType.launch({ headless: true });

    try {
      await checkVanillaArtifact(browser, server.origin);
      await checkElementArtifact(browser, server.origin);
      console.log(`Built Vanilla and Element browser artifacts passed ${name} smoke checks.`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
