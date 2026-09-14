import process from 'node:process';

import { chromium } from 'playwright';

import { siteEntries } from '../catalog.mjs';
import { assertNoPageFailures, observePageFailures } from '../tests/browser/failures.mjs';
import { getLiveRoute } from './artifact-layout.mjs';
import { serve } from './serve.mjs';

const ACCESSIBILITY_SCENARIO_ROUTE = 'scenarios/accessibility';
const BASE_PATH = '/tracker/';
const DOCUMENTATION_ROUTE = 'docs/packages/core';
const MOBILE_VIEWPORT = Object.freeze({ height: 844, width: 390 });
const REPRESENTATIVE_VARIABLE = '--rxtt-marker-bg';
const REPRESENTATIVE_VALUE = '#123456';
const THEME_BUILDER_ROUTE = 'tools/theme-builder';

const requestedBrowser = process.argv.find((argument) => argument.startsWith('--browser='))?.slice('--browser='.length);
if (requestedBrowser !== undefined && requestedBrowser !== 'chromium') {
  throw new Error(`Site browser verification is Chromium-only; received "--browser=${requestedBrowser}".`);
}

/** Returns the loopback origin assigned to a listening test server. */
function getServerOrigin(server) {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Site test server has no TCP listening address.');
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

/** Closes one listening test server after its active requests complete. */
function closeServer(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
  });
}

/**
 * Opens one owned page with a fresh failure collector for a single navigation.
 *
 * @param {import('playwright').Browser} browser Chromium browser under test.
 * @param {string} origin Served origin that owns the boundary.
 * @param {import('playwright').BrowserContextOptions} [options] Isolated page options.
 * @returns {Promise<{ failures: string[], page: import('playwright').Page }>} Page and collector.
 */
async function openBoundary(browser, origin, options = {}) {
  const page = await browser.newPage({ reducedMotion: 'reduce', ...options });
  const failures = [];
  observePageFailures(page, failures, origin);
  return { failures, page };
}

/** Opens one route and requires a successful main-document response. */
async function navigate(page, url, label) {
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (response?.ok() !== true) {
    throw new Error(`${label} returned HTTP ${String(response?.status())}.`);
  }
}

/** Verifies that the assembled catalog is visible from a non-root deployment. */
async function verifySiteShell(browser, origin) {
  const { failures, page } = await openBoundary(browser, origin);
  try {
    await navigate(page, `${origin}${BASE_PATH}`, 'Catalog shell');
    await page.getByRole('heading', { level: 1, name: 'Right eXperience Toolkit Tracker' }).waitFor();
    assertNoPageFailures(failures, 'Catalog shell');
  } finally {
    await page.close();
  }
}

/** Verifies one complete Theme Builder edit/reset flow under the subpath sentinel. */
async function verifyThemeBuilder(browser, origin) {
  const { failures, page } = await openBoundary(browser, origin);
  try {
    await navigate(page, `${origin}${BASE_PATH}${getLiveRoute(THEME_BUILDER_ROUTE)}/`, 'Theme Builder');
    await page.locator('[data-preview-tracker]').waitFor();

    const field = page.locator(`[data-variable-name="${REPRESENTATIVE_VARIABLE}"]`);
    await field.locator('[data-value-input]').fill(REPRESENTATIVE_VALUE);
    await page.waitForFunction(
      ({ name, value }) =>
        document.querySelector('[data-preview-tracker]')?.style.getPropertyValue(name) === value &&
        document.querySelector('[data-css-output]')?.textContent?.includes(`${name}: ${value};`) === true,
      { name: REPRESENTATIVE_VARIABLE, value: REPRESENTATIVE_VALUE },
    );

    await field.getByRole('button', { exact: true, name: `Reset ${REPRESENTATIVE_VARIABLE}` }).click();
    await page.waitForFunction(
      (name) =>
        document.querySelector('[data-preview-tracker]')?.style.getPropertyValue(name) === '' &&
        document.querySelector('[data-css-output]')?.textContent?.includes(`${name}:`) === false,
      REPRESENTATIVE_VARIABLE,
    );

    assertNoPageFailures(failures, 'Theme Builder');
  } finally {
    await page.close();
  }
}

/** Verifies every catalog-owned documentation route at the narrow mobile boundary. */
async function verifyDocumentationReflow(browser, origin) {
  const documents = siteEntries.filter((entry) => entry.kind === 'documentation');
  for (const entry of documents) {
    const { failures, page } = await openBoundary(browser, origin, { viewport: MOBILE_VIEWPORT });
    try {
      await navigate(page, `${origin}${BASE_PATH}${entry.route}/`, entry.route);
      const fitsViewport = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      if (!fitsViewport) {
        throw new Error(`${entry.route} has page-level horizontal overflow at the mobile viewport.`);
      }
      assertNoPageFailures(failures, entry.route);
    } finally {
      await page.close();
    }
  }
}

/** Verifies that essential documentation reading and keyboard navigation work without JavaScript. */
async function verifyDocumentationWithoutJavaScript(browser, origin) {
  const { failures, page } = await openBoundary(browser, origin, {
    javaScriptEnabled: false,
    viewport: MOBILE_VIEWPORT,
  });
  try {
    await navigate(page, `${origin}${BASE_PATH}${DOCUMENTATION_ROUTE}/`, 'Documentation without JavaScript');
    await page.locator('main article h1').waitFor();

    const skipLink = page.getByRole('link', { exact: true, name: 'Skip to content' });
    await page.keyboard.press('Tab');
    if (!(await skipLink.evaluate((link) => link === document.activeElement))) {
      throw new Error('Documentation skip link is not the first keyboard destination.');
    }
    await page.keyboard.press('Enter');
    if (new URL(page.url()).hash !== '#docs-main') {
      throw new Error('Documentation skip link did not target the main content.');
    }

    const details = page.locator('details', {
      has: page.locator('summary', { hasText: 'Documentation navigation' }),
    });
    const summary = details.locator('summary');
    const initiallyOpen = await details.evaluate((element) => element.open);
    await summary.focus();
    await page.keyboard.press('Enter');
    if ((await details.evaluate((element) => element.open)) === initiallyOpen) {
      throw new Error('Documentation navigation summary did not toggle from the keyboard.');
    }
    await page.keyboard.press('Enter');
    if ((await details.evaluate((element) => element.open)) !== initiallyOpen) {
      throw new Error('Documentation navigation summary did not restore its initial state.');
    }

    assertNoPageFailures(failures, 'Documentation without JavaScript');
  } finally {
    await page.close();
  }
}

/** Verifies observer-driven current-section state on a real deep documentation route. */
async function verifyDocumentationScrollspy(browser, origin) {
  const { failures, page } = await openBoundary(browser, origin);
  try {
    await navigate(page, `${origin}${BASE_PATH}${DOCUMENTATION_ROUTE}/`, 'Documentation scrollspy');
    const heading = page.locator('main article h3[id]').first();
    const headingId = await heading.getAttribute('id');
    if (headingId === null) {
      throw new Error('Representative documentation route has no nested section for scrollspy verification.');
    }
    await heading.evaluate((element) => element.scrollIntoView());
    await page.waitForFunction(
      (id) =>
        document.querySelector('nav[aria-label="On this page"] a[aria-current="location"]')?.getAttribute('href') ===
        `#${id}`,
      headingId,
    );
    assertNoPageFailures(failures, 'Documentation scrollspy');
  } finally {
    await page.close();
  }
}

/** Verifies that one real consumer bundle initializes its Tracker integration. */
async function verifyConsumerInitialization(browser, origin) {
  const { failures, page } = await openBoundary(browser, origin);
  try {
    await navigate(
      page,
      `${origin}${BASE_PATH}${getLiveRoute(ACCESSIBILITY_SCENARIO_ROUTE)}/`,
      'Accessibility consumer',
    );
    await page.locator('[aria-label="Demo section navigation"][tabindex="0"]').waitFor();
    await page.waitForFunction(() => document.querySelector('#selection-state')?.value === 'Introduction');
    assertNoPageFailures(failures, 'Accessibility consumer');
  } finally {
    await page.close();
  }
}

let browser = null;
let server = null;

try {
  server = await serve({ basePath: BASE_PATH, port: 0 });
  const origin = getServerOrigin(server);
  browser = await chromium.launch({ headless: true });

  await verifySiteShell(browser, origin);
  await verifyThemeBuilder(browser, origin);
  await verifyDocumentationReflow(browser, origin);
  await verifyDocumentationWithoutJavaScript(browser, origin);
  await verifyDocumentationScrollspy(browser, origin);
  await verifyConsumerInitialization(browser, origin);
} finally {
  await browser?.close();
  if (server !== null) {
    await closeServer(server);
  }
}
