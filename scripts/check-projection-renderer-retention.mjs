import { JSDOM } from 'jsdom';

/** Number of forced-GC turns used for each observation. */
const GC_ATTEMPTS = 20;

/**
 * Installs jsdom globals so Tracker's compiled dist code can run in Node.
 *
 * @param {JSDOM} dom - jsdom instance backing the retention experiment.
 * @returns {void}
 */
function installDomGlobals(dom) {
  Object.assign(globalThis, {
    CSSStyleSheet: dom.window.CSSStyleSheet,
    CustomEvent: dom.window.CustomEvent,
    Document: dom.window.Document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    ShadowRoot: dom.window.ShadowRoot,
    document: dom.window.document,
    window: dom.window,
  });
}

/**
 * Gives V8 repeated full-GC opportunities separated by macrotasks.
 *
 * @returns {Promise<void>}
 */
async function runGcCycles() {
  for (let attempt = 0; attempt < GC_ATTEMPTS; attempt += 1) {
    globalThis.gc();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Checks that the projection integration releases its source Element after unmount and destroy.
 *
 * The integration handle stays alive to cover callers that await `whenDestroyed()`.
 *
 * @returns {Promise<{ afterDestroyCollected: boolean, afterUnmountCollected: boolean }>}
 */
async function measureProjectionRendererRetention() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });

  installDomGlobals(dom);

  const { createTrackerProjectionIntegration } = await import('../packages/core/dist/projection.mjs');

  const sourceRoot = document.createElement('main');
  let target = document.createElement('div');

  target.className = 'retention-probe';
  sourceRoot.append(target);

  const renderRoot = document.createElement('div');

  document.body.append(sourceRoot, renderRoot);

  const targetReference = new WeakRef(target);
  const integration = createTrackerProjectionIntegration({
    options: {
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    },
    rules: [{ selector: '.retention-probe' }],
  });

  integration.mount({ renderRoot, sourceRoot });

  if (integration.getProjection().items.length !== 1) {
    throw new Error('Projection renderer did not publish the expected initial item.');
  }

  integration.unmount();
  sourceRoot.removeChild(target);
  target = null;

  // jsdom's nwsapi selector engine caches querySelectorAll matches on the
  // document and only drops stale entries on the next query after a
  // mutation; without this it would look like Tracker retains the element
  // even once every internal reference has actually been released.
  document.querySelectorAll('.retention-probe');
  await runGcCycles();

  const afterUnmountCollected = targetReference.deref() === undefined;

  integration.destroy();
  document.querySelectorAll('.retention-probe');
  await runGcCycles();

  const afterDestroyCollected = targetReference.deref() === undefined;

  return { afterDestroyCollected, afterUnmountCollected };
}

if (typeof globalThis.gc !== 'function') {
  throw new Error('Run this diagnostic with node --expose-gc scripts/check-projection-renderer-retention.mjs.');
}

const result = await measureProjectionRendererRetention();

process.stdout.write(`${JSON.stringify(result)}\n`);

if (!result.afterUnmountCollected || !result.afterDestroyCollected) {
  process.exitCode = 1;
}
