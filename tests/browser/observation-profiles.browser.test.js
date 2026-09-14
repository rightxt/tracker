import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';
import { settleFrames } from './support/settle-frames.js';
import { waitFor as pollUntil } from './support/wait-for.js';

/**
 * Waits until a condition becomes true within this suite's 3-second deadline.
 *
 * @param {() => boolean} condition - Success condition.
 * @param {string} description - Failure description.
 * @returns {Promise<void>}
 */
function waitFor(condition, description) {
  return pollUntil(condition, description, { timeoutMs: 3000 });
}

/**
 * Waits long enough for any pending zero-debounce observer work to flush.
 *
 * @param {Window} runtimeWindow - Active runtime window.
 * @returns {Promise<void>}
 */
async function settleObservers(runtimeWindow) {
  await settleFrames(runtimeWindow, 2);
  await new Promise((resolve) => {
    setTimeout(resolve, 150);
  });
}

/** Removes all browser fixtures after each observation-profile scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('observation profiles', () => {
  it('remeasures sticky markers when the authoritative element root scrolls', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0;">
          <div id="scroller" style="height: 200px; overflow-y: auto;">
            <div style="height: 300px;"></div>
            <div class="sticky-observation-target" style="position: sticky; top: 0; height: 40px;">target</div>
            <div style="height: 600px;"></div>
          </div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    const scroller = frameDocument?.getElementById('scroller');

    if (frameWindow === null || frameDocument === null || !(scroller instanceof frameWindow.HTMLElement)) {
      throw new Error('Expected a complete sticky-scroller frame.');
    }

    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
      },
      rules: [{ selector: '.sticky-observation-target' }],
    });

    tracker.mount({
      renderHost: frameDocument.body,
      scrollRoot: scroller,
      sourceRoot: scroller,
    });
    await settleObservers(frameWindow);

    const markerBefore = frameDocument.querySelector('.rxtt__marker');

    if (!(markerBefore instanceof frameWindow.HTMLElement)) {
      throw new Error('Expected a sticky marker before scrolling.');
    }

    const markerStartBefore = Number.parseFloat(markerBefore.style.getPropertyValue('--rxtt-marker-start'));
    const statsBefore = tracker.getStats();

    scroller.scrollTop = 450;

    await waitFor(
      () => tracker.getStats().observers.scroll > statsBefore.observers.scroll,
      'the authoritative element scroll observer event',
    );
    await settleObservers(frameWindow);

    const markerAfter = frameDocument.querySelector('.rxtt__marker');

    if (!(markerAfter instanceof frameWindow.HTMLElement)) {
      throw new Error('Expected a sticky marker after scrolling.');
    }

    const markerStartAfter = Number.parseFloat(markerAfter.style.getPropertyValue('--rxtt-marker-start'));

    expect(markerStartAfter).toBeGreaterThan(markerStartBefore + 5);

    tracker.destroy();
    iframe.remove();
  });

  it('invalidates markers when a live nested scroller inside the source root scrolls', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0;">
          <div id="source" style="position: relative;">
            <div id="scroller" style="height: 200px; overflow-y: scroll;">
              <div style="height: 400px;"></div>
              <div class="observation-target" style="height: 50px;">target</div>
              <div style="height: 400px;"></div>
            </div>
          </div>
          <div style="height: 1500px;"></div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    const source = frameDocument?.getElementById('source');
    const scroller = frameDocument?.getElementById('scroller');

    if (frameWindow === null || frameDocument === null || source == null || scroller == null) {
      throw new Error('Expected a complete nested-scroller frame.');
    }

    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
      },
      rules: [{ selector: '.observation-target' }],
    });

    tracker.mount({ scrollRoot: frameWindow, sourceRoot: source });
    await settleObservers(frameWindow);

    const markerBefore = frameDocument.querySelector('.rxtt__marker');

    if (markerBefore === null) {
      throw new Error('Expected a marker before nested scrolling.');
    }

    const markerStartBefore = Number.parseFloat(markerBefore.style.getPropertyValue('--rxtt-marker-start'));
    const statsBefore = tracker.getStats();

    // Synchronous burst: the descendant handler coalesces it per frame.
    scroller.scrollTop = 100;
    scroller.scrollTop = 200;
    scroller.scrollTop = 300;

    await waitFor(
      () => tracker.getStats().observers.scroll > statsBefore.observers.scroll,
      'a descendant scroll observer event',
    );
    await settleObservers(frameWindow);

    const statsAfter = tracker.getStats();
    const markerAfter = frameDocument.querySelector('.rxtt__marker');

    if (markerAfter === null) {
      throw new Error('Expected a marker after nested scrolling.');
    }

    const markerStartAfter = Number.parseFloat(markerAfter.style.getPropertyValue('--rxtt-marker-start'));

    expect(statsAfter.renders.requested).toBeGreaterThan(statsBefore.renders.requested);
    // The target moved up in document space, so its track position decreases.
    expect(markerStartAfter).toBeLessThan(markerStartBefore - 5);

    tracker.destroy();
    iframe.remove();
  });

  it('keeps the scoped default profile silent for unrelated mutations and reacts under the broad recipe', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0;">
          <div id="source">
            <p class="observation-target">inside</p>
            <p class="additional-observation-target">extra</p>
          </div>
          <div id="unrelated"></div>
          <div style="height: 1500px;"></div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    const source = frameDocument?.getElementById('source');
    const unrelated = frameDocument?.getElementById('unrelated');

    if (frameWindow === null || frameDocument === null || source == null || unrelated == null) {
      throw new Error('Expected a complete observation-profiles frame.');
    }

    const scopedTracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: { mutation: { debounce: 0 } },
      },
      rules: [{ selector: '.observation-target' }],
    });

    scopedTracker.mount({ scrollRoot: frameWindow, sourceRoot: source });
    await settleObservers(frameWindow);

    const scopedBefore = scopedTracker.getStats();

    unrelated.appendChild(frameDocument.createElement('div'));
    await settleObservers(frameWindow);

    expect(scopedTracker.getStats().observers.mutation).toBe(scopedBefore.observers.mutation);
    expect(scopedTracker.getStats().renders.requested).toBe(scopedBefore.renders.requested);

    source.appendChild(frameDocument.createElement('span'));
    await waitFor(
      () => scopedTracker.getStats().observers.mutation > scopedBefore.observers.mutation,
      'a scoped source-root mutation observer event',
    );

    scopedTracker.destroy();
    await settleObservers(frameWindow);

    const broadTracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          mutation: {
            debounce: 0,
            targets: ({ document: activeDocument }) => [activeDocument.body],
          },
        },
      },
      rules: [{ selector: '.observation-target' }],
    });

    broadTracker.mount({ scrollRoot: frameWindow, sourceRoot: source });
    await settleObservers(frameWindow);

    const broadBefore = broadTracker.getStats();

    unrelated.appendChild(frameDocument.createElement('div'));
    await waitFor(
      () => broadTracker.getStats().observers.mutation > broadBefore.observers.mutation,
      'a broad body mutation observer event',
    );
    await waitFor(
      () => broadTracker.getStats().renders.requested > broadBefore.renders.requested,
      'a broad-profile render request',
    );
    await settleObservers(frameWindow);

    const internalBefore = broadTracker.getStats();

    // Internal marker DOM growth inside body must stay excluded in broad mode.
    broadTracker.addRule({ selector: '.additional-observation-target' });
    broadTracker.render();
    await settleObservers(frameWindow);

    expect(frameDocument.querySelectorAll('.rxtt__marker').length).toBe(2);
    expect(broadTracker.getStats().observers.mutation).toBe(internalBefore.observers.mutation);

    broadTracker.destroy();
    iframe.remove();
  });

  it('observes only the local iframe realm and explicit open shadow roots', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0;">
          <div id="source">
            <p class="observation-target">inside</p>
            <div id="shadow-host"></div>
          </div>
          <div style="height: 1500px;"></div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    const source = frameDocument?.getElementById('source');
    const host = frameDocument?.getElementById('shadow-host');

    if (frameWindow === null || frameDocument === null || source == null || host == null) {
      throw new Error('Expected a complete observer-realm frame.');
    }

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const shadowContent = frameDocument.createElement('div');

    shadowRoot.appendChild(shadowContent);

    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          mutation: {
            debounce: 0,
            targets: (context) => [...context.defaultTargets, shadowRoot],
          },
        },
      },
      rules: [{ selector: '.observation-target' }],
    });

    tracker.mount({ scrollRoot: frameWindow, sourceRoot: source });
    await settleObservers(frameWindow);

    const statsBefore = tracker.getStats();

    document.body.appendChild(document.createElement('div'));
    await settleObservers(frameWindow);

    expect(tracker.getStats().observers.mutation).toBe(statsBefore.observers.mutation);

    shadowContent.appendChild(frameDocument.createElement('span'));
    await waitFor(
      () => tracker.getStats().observers.mutation > statsBefore.observers.mutation,
      'an explicit shadow-root mutation observer event',
    );

    tracker.destroy();
    iframe.remove();
  });
});
