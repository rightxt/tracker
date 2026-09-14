import { afterEach, describe, expect, it } from 'vitest';

import { getInternalDomRegistry } from '../../packages/core/src/dom/internalDomRegistry.ts';
import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';
import { waitFor } from './support/wait-for.js';

/**
 * Waits for the next animation frame.
 *
 * @returns {Promise<void>}
 */
function waitForAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * Waits for the finite retired-root task checkpoint.
 *
 * @returns {Promise<void>}
 */
function waitForTaskCheckpoint() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/** Removes browser fixtures after every scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('render-root isolation', () => {
  it('ignores another Tracker root insertion/removal but observes later application reuse', async () => {
    const observingTracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          mutation: { debounce: 0 },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.isolated-output' }],
    });
    const outputTracker = new Tracker({
      options: {
        track: { className: 'isolated-output' },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
    });

    observingTracker.mount();
    outputTracker.mount();
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(observingTracker.getSnapshot().items).toHaveLength(0);
    expect(observingTracker.getStats().observers.mutation).toBe(0);

    outputTracker.destroy();
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(observingTracker.getSnapshot().items).toHaveLength(0);
    expect(observingTracker.getStats().observers.mutation).toBe(0);

    const applicationNode = document.createElement('div');

    applicationNode.className = 'isolated-output';
    document.body.appendChild(applicationNode);

    await waitFor(
      () => observingTracker.getSnapshot().items.length === 1,
      'an ordinary application mutation after root release',
    );

    expect(observingTracker.getStats().observers.mutation).toBeGreaterThan(0);

    observingTracker.destroy();
  });

  it('releases the old document registry after iframe navigation and destroy', async () => {
    const iframe = await loadInlineFrame('<!doctype html><html><body></body></html>');
    const frameDocument = iframe.contentDocument;

    const frameWindow = frameDocument?.defaultView;

    if (!frameDocument?.body || !frameWindow) {
      throw new Error('Expected the initial iframe document.');
    }

    const tracker = new Tracker({
      options: {
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
    });

    tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

    const root = tracker.root;
    const registry = getInternalDomRegistry(frameDocument);

    if (!root) {
      throw new Error('Expected the iframe-local Tracker root.');
    }

    expect(registry.getRegistrationState(root)).toBe('active');

    const navigated = new Promise((resolve) => {
      iframe.addEventListener('load', resolve, { once: true });
    });

    iframe.srcdoc = '<!doctype html><html><body><p>navigated</p></body></html>';
    await navigated;

    tracker.destroy();

    expect(registry.activeCount).toBe(0);
    expect(registry.isNodeRetired(root)).toBe(true);

    await waitForTaskCheckpoint();

    expect(registry.isNodeRetired(root)).toBe(false);
    expect(iframe.contentDocument?.querySelector('.rxtt')).toBeNull();

    iframe.remove();
  });
});
