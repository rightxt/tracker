import { JSDOM } from 'jsdom';

import { createTrackerRendererIntegration } from '../packages/core/dist/renderer.mjs';

/** Number of forced-GC turns used for each observation. */
const GC_ATTEMPTS = 20;

/** ResizeObserver model sufficient for a retention experiment that never delivers resize records. */
class InertResizeObserver {
  disconnect() {}

  observe() {}

  unobserve() {}
}

/** Renderer that adopts an explicitly supplied root for the diagnostic. */
const ROOT_RENDERER = Object.freeze({
  mount: (context) => context.target.root ?? null,
  unmount: () => undefined,
});

/**
 * Installs the jsdom constructors used by Core runtime guards.
 *
 * @param {JSDOM} dom - DOM realm backing the retention scenario.
 * @returns {void}
 */
function installDomGlobals(dom) {
  Object.defineProperty(dom.window, 'ResizeObserver', {
    configurable: true,
    value: InertResizeObserver,
    writable: true,
  });
  Object.assign(globalThis, {
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
 * Runs the pending-handler retention experiment through the supported renderer facade.
 *
 * @returns {Promise<{ pendingRetained: boolean, settledCollected: boolean }>}
 */
async function measurePromiseReactionRetention() {
  const dom = new JSDOM('<main id="source"><div class="retention-probe"></div></main><aside id="root"></aside>');

  installDomGlobals(dom);

  const root = dom.window.document.querySelector('#root');
  const sourceRoot = dom.window.document.querySelector('#source');
  let resolveHandlerPromise = () => {};
  const handlerPromise = new Promise((resolve) => {
    resolveHandlerPromise = resolve;
  });
  let payloadReference = null;
  let integration = createTrackerRendererIntegration(
    { rules: [{ selector: '.retention-probe' }] },
    { renderer: ROOT_RENDERER },
  );

  integration.on('marker:activate', (payload) => {
    payloadReference = new WeakRef(payload);

    return handlerPromise;
  });
  integration.mount({ rendererTarget: { kind: 'root', root }, sourceRoot });

  const [item] = integration.getSnapshot().items;

  if (item === undefined || !integration.activateItem(item.key)) {
    throw new Error('The Direct Renderer facade did not activate the retention probe.');
  }

  integration.destroy();
  integration = null;

  await runGcCycles();

  const pendingRetained = payloadReference?.deref() !== undefined;

  resolveHandlerPromise();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await runGcCycles();

  return {
    pendingRetained,
    settledCollected: payloadReference?.deref() === undefined,
  };
}

if (typeof globalThis.gc !== 'function') {
  throw new Error('Run this diagnostic with node --expose-gc scripts/check-promise-retention.mjs.');
}

const result = await measurePromiseReactionRetention();

process.stdout.write(`${JSON.stringify(result)}\n`);

if (!result.pendingRetained || !result.settledCollected) {
  process.exitCode = 1;
}
