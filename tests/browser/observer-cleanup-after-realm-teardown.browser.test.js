import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';
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

afterEach(() => {
  document.body.replaceChildren();
});

describe('native observer cleanup exception reproducibility after realm teardown', () => {
  it('tears down a Tracker whose MutationObserver/ResizeObserver/window listeners belong to a destroyed iframe realm, without leaving the process unable to mount a fresh instance', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0;">
          <div class="observer-cleanup-target">frame target</div>
        </body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;

    if (frameDocument?.body == null || frameWindow === null) {
      throw new Error('Expected a complete observer-cleanup frame.');
    }

    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
      },
      rules: [{ selector: '.observer-cleanup-target' }],
    });

    tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

    await waitFor(
      () => frameDocument.body.querySelector('.rxtt__marker') !== null,
      'the initial marker inside the observer-cleanup frame',
    );
    expect(tracker.mounted).toBe(true);

    // Destroy the frame's realm outright while the tracker's observers,
    // resize-observers, and window 'resize' listener are still live and
    // bound to it - this is the actual native-exception-generating
    // condition under test, not a monkey-patched/mocked stand-in for it.
    iframe.remove();

    let caughtDestroyError = null;

    try {
      tracker.destroy();
    } catch (error) {
      caughtDestroyError = error;
    }

    // Ground truth verified across the configured browser matrix: native
    // MutationObserver.disconnect()/ResizeObserver.disconnect()/
    // removeEventListener('resize', ...) calls made against handles that
    // belong to an already-destroyed iframe realm do not throw - they are
    // silent no-ops in this scenario, matching the torn-realm behavior for
    // scrollIntoView. destroy() completes without an error to catch.
    // ObserverController's own defensive design (fields captured into
    // locals and nulled BEFORE any native cleanup call is attempted - see
    // ObserverController.ts's disconnect(), and attemptObserverCleanup()
    // never aborting sibling steps even if one did throw) means this
    // conclusion would hold regardless: nothing here depends on the native
    // calls actually succeeding.
    expect(caughtDestroyError).toBeNull();
    expect(tracker.mounted).toBe(false);

    const target = document.createElement('div');

    target.className = 'observer-cleanup-recovery-target';
    document.body.appendChild(target);

    const recoveryTracker = new Tracker({
      options: {
        clustering: { enabled: false },
      },
      rules: [{ selector: '.observer-cleanup-recovery-target' }],
    });

    expect(() => recoveryTracker.mount()).not.toThrow();
    // Default mount() renders the tracker root as a sibling of document.body's
    // children, not nested inside the matched target - the marker itself is
    // what proves a real rule match against `.observer-cleanup-recovery-target`.
    await waitFor(
      () => document.querySelector('.rxtt__marker') !== null,
      'a marker from an independent Tracker mounted after the torn-down-realm teardown',
    );
    expect(recoveryTracker.mounted).toBe(true);

    recoveryTracker.destroy();
  });
});
