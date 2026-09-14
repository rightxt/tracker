/**
 * Classifies a browser diagnostic source as provably foreign to the owned site origin.
 *
 * Fail-closed: only a structurally parseable source that resolves to a concrete
 * non-owned origin (or an opaque `file:` / browser-extension source) counts as
 * foreign. An empty, unparseable, owned, or otherwise unknown source is not
 * foreign, so the diagnostic it produced keeps failing the active boundary.
 *
 * @param {string | undefined} sourceUrl Structured Playwright source URL for the diagnostic.
 * @param {string} ownedOrigin Origin serving the active site boundary.
 * @returns {boolean} Whether the diagnostic provably originates outside the owned boundary.
 */
function isProvablyForeignSource(sourceUrl, ownedOrigin) {
  if (typeof sourceUrl !== 'string' || sourceUrl === '') {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (parsed.origin === ownedOrigin) {
    return false;
  }
  if (parsed.origin !== 'null') {
    return true;
  }
  return parsed.protocol === 'file:' || parsed.protocol.endsWith('-extension:');
}

/**
 * Collects owned browser failures for one page bound to a single site boundary.
 *
 * Console errors/warnings and uncaught page errors fail the boundary unless their
 * structured Playwright source is provably foreign. Same-origin request failures
 * fail the boundary unconditionally. Each retained flow performs exactly one
 * navigation on a fresh page, so no cross-navigation request-lifetime tracking is
 * needed to preserve those semantics.
 *
 * @param {import('playwright').Page} page Page whose owned failures are observed.
 * @param {string[]} failures Mutable collector scoped to the current boundary.
 * @param {string} origin Served origin that owns the active boundary.
 * @returns {void}
 */
function observePageFailures(page, failures, origin) {
  const ownedOrigin = new URL(origin).origin;

  page.context().on('weberror', (webError) => {
    if (webError.page() !== page) {
      return;
    }
    if (isProvablyForeignSource(webError.location()?.url, ownedOrigin)) {
      return;
    }
    failures.push(`pageerror: ${webError.error().message}`);
  });

  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') {
      return;
    }
    if (isProvablyForeignSource(message.location()?.url, ownedOrigin)) {
      return;
    }
    failures.push(`console.${type === 'warning' ? 'warn' : 'error'}: ${message.text()}`);
  });

  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin !== ownedOrigin) {
      return;
    }
    failures.push(`requestfailed: ${request.url()} (${request.failure()?.errorText})`);
  });
}

/**
 * Fails one completed boundary when its collector contains owned browser failures.
 *
 * @param {string[]} failures Failures collected for the boundary.
 * @param {string} label Boundary label used in the thrown message.
 * @returns {void}
 */
function assertNoPageFailures(failures, label) {
  if (failures.length > 0) {
    throw new Error(`${label} emitted browser failures:\n- ${failures.join('\n- ')}`);
  }
}

export { assertNoPageFailures, observePageFailures };
