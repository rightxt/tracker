import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';

/** Removes browser fixtures after every direct-unmount scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Waits for a Vue tick and at least one macrotask, so any deferred Core
 * operation drain and any Vue post-flush effect have a chance to settle.
 *
 * @returns {Promise<void>} Resolves after the wait.
 */
async function waitForSettledTick() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('Vue direct application unmount from inside a Core callback', () => {
  // REJECTED as a defect (decision recorded 2026-08-05): Vue does not consider
  // the app mounted until app.mount()'s own render() call returns, and the
  // scenario below calls app.unmount() nested inside that same call. Vue's
  // documented no-op-with-warning behavior for "unmount an app that is not
  // mounted" is therefore expected, not a Tracker defect. This case stays as a
  // permanent regression guard for that no-op contract. Vue's dev-mode
  // "[Vue warn]: Cannot unmount an app that is not mounted." console output is
  // an expected part of that contract and is intentionally left visible. The
  // earlier `rule.label`-callback variant of the same app-not-yet-mounted
  // limitation is retired here; `rule.label` framework destruction during
  // initial mount is independently owned by
  // framework-destroy-during-render.browser.test.js, where parent/framework
  // teardown actually occurs.
  it('leaves Core mounted and reports no destroyed state when app.unmount() is attempted from the very first sync:start callback (nested inside app.mount() itself)', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'render-start-unmount-target';
    document.body.append(target, container);

    let handle;
    const app = createApp(
      defineComponent({
        setup() {
          const trackerRef = ref(null);

          return () =>
            h(VueTracker, {
              ref: trackerRef,
              onSyncStart: () => {
                handle = trackerRef.value;
                app.unmount();
              },
              options: {
                clustering: { enabled: false },
                updates: {
                  interval: { enabled: false },
                  mutation: { enabled: false },
                  resize: { enabled: false },
                  scroll: { enabled: false },
                },
              },
              rules: [{ selector: '.render-start-unmount-target' }],
            });
        },
      }),
    );

    app.mount(container);

    await waitForSettledTick();

    // Vue's own app-level `isMounted` flag is not set to `true` until the
    // outer `app.mount()` call's `render()` invocation returns — and the
    // very first `sync:start` fires nested inside that same call (via
    // Tracker's `onMounted` hook). So `app.unmount()` observes `isMounted
    // === false` and is a documented, warning-only no-op (Vue logs "Cannot
    // unmount an app that is not mounted."): Core's destroyed state is
    // never reached, and the Tracker stays fully mounted.
    expect(handle.getState()).toBe('mounted');
    expect(container.querySelector('.rxtt')).not.toBeNull();
  });

  // Core reaches a stable destroyed state through the public lifecycle contract.
  // A consumer that needs a guaranteed terminal notification for this scenario
  // awaits the captured handle's whenRuntimeDestroyed() Promise.
  it('fulfills whenRuntimeDestroyed() exactly once, reaches a stable destroyed state, and rejects further lifecycle calls when app.unmount() is called directly from a later sync-start callback', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'second-render-unmount-target';
    document.body.append(target, container);

    let syncStartCount = 0;
    let handle;
    let destroyedPromise;
    let fulfillmentCount = 0;
    const trackerRef = ref(null);
    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(VueTracker, {
              ref: trackerRef,
              onSyncStart: () => {
                syncStartCount += 1;

                // The app is already fully mounted (`isMounted === true`) by
                // the second sync-start, so this direct app.unmount() call
                // actually runs Vue's real unmount path this time, unlike the
                // first-render scenarios covered above. The handle is
                // captured here, before teardown, per the required
                // capture-then-subscribe sequencing, and its
                // whenRuntimeDestroyed() Promise is retained.
                if (syncStartCount === 2) {
                  handle = trackerRef.value;
                  destroyedPromise = handle.whenRuntimeDestroyed();
                  destroyedPromise.then(() => {
                    fulfillmentCount += 1;
                  });
                  app.unmount();
                }
              },
              options: {
                clustering: { enabled: false },
                updates: {
                  interval: { enabled: false },
                  mutation: { enabled: false },
                  resize: { enabled: false },
                  scroll: { enabled: false },
                },
              },
              rules: [{ selector: '.second-render-unmount-target' }],
            });
        },
      }),
    );

    app.mount(container);
    await waitForSettledTick();

    expect(syncStartCount).toBe(1);

    // Trigger a second Core render directly (not through Vue's own
    // reactivity), from the plain test call stack — so Vue's renderer is
    // not already mid-flush when the nested app.unmount() call happens.
    trackerRef.value.refresh();

    await waitForSettledTick();

    // The terminal Promise fulfills with undefined exactly once.
    await expect(destroyedPromise).resolves.toBeUndefined();
    expect(fulfillmentCount).toBe(1);

    // Repeated whenRuntimeDestroyed() calls return the same Promise object.
    expect(handle.whenRuntimeDestroyed()).toBe(destroyedPromise);

    // The handle reaches the stable destroyed state.
    expect(handle.getState()).toBe('destroyed');

    // Retained final statistics remain readable.
    const finalStats = handle.getStats();

    expect(finalStats).not.toBeNull();
    expect(typeof finalStats).toBe('object');

    // refresh(), requestRefresh() and resetStats() reject through the stable
    // destroyed lifecycle error.
    expect(() => handle.refresh()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }));
    expect(() => handle.requestRefresh()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }));
    expect(() => handle.resetStats()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }));

    // No Tracker DOM or active runtime resources remain: this scenario runs
    // Vue's real unmount path (unlike the two REJECTED scenarios above), so
    // the rendered `.rxtt` root must actually be gone.
    expect(container.querySelector('.rxtt')).toBeNull();
    expect(syncStartCount).toBe(2);
  });
});
