// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../Tracker.js';

import type { TrackerHandle } from '../Tracker.js';
import type { TrackerOptions, TrackerRule } from '@rightxt/tracker-core';

/** Deterministic options used by Tracker DOM tests. */
const TEST_OPTIONS = {
  a11y: { enabled: true, keyboard: true },
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
} as const;

/** Flushes Vue rendering and pending Core microtasks. */
async function flush(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Vue Tracker', () => {
  it('rerenders the Vue item wrapper for an items-domain marker-presentation update', async () => {
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const container = document.createElement('div');
    const registry: string[] = [];

    target.className = 'vue-marker-presentation-target';
    sourceRoot.append(target);
    document.body.append(sourceRoot, container);
    const options = shallowRef<Partial<TrackerOptions>>({ ...TEST_OPTIONS, placement: 'left' });
    const app = createApp(
      defineComponent({
        setup: () => () =>
          h(Tracker, {
            options: options.value,
            rules: [{ selector: '.vue-marker-presentation-target' }],
            sourceRoot,
          }),
      }),
    );

    app.mixin({
      beforeUpdate(): void {
        if (this.$options.name) {
          registry.push(this.$options.name);
        }
      },
    });
    app.mount(container);
    await flush();
    registry.length = 0;
    options.value = { ...options.value, marker: { className: 'vue-marker-presentation-updated' } };
    await flush();

    // An items-domain marker-presentation change must invalidate the dedicated Vue item
    // wrapper, not merely the parent chrome component. Core Projection tests own the exact
    // `changed=['items']` commit; this test owns the Vue component consequence.
    expect(registry).toContain('RxtTrackerProjectionItems');
    expect(container.querySelector('.rxtt__marker')?.classList.contains('vue-marker-presentation-updated')).toBe(true);
    app.unmount();
  });

  it('updates the Vue viewport domain without rerendering the item wrapper', async () => {
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const container = document.createElement('div');
    const registry: string[] = [];

    target.className = 'vue-viewport-only-target';
    sourceRoot.append(target);
    document.body.append(sourceRoot, container);
    const options = shallowRef({ ...TEST_OPTIONS, viewport: { enabled: true } });
    const app = createApp(
      defineComponent({
        setup: () => () =>
          h(Tracker, {
            options: options.value,
            rules: [{ selector: '.vue-viewport-only-target' }],
            sourceRoot,
          }),
      }),
    );

    app.mixin({
      beforeUpdate(): void {
        if (this.$options.name) {
          registry.push(this.$options.name);
        }
      },
    });
    app.mount(container);
    await flush();
    registry.length = 0;
    options.value = { ...options.value, viewport: { enabled: false } };
    await flush();

    expect(container.querySelector('.rxtt__viewport')?.hasAttribute('hidden')).toBe(true);
    // The viewport domain updates in isolation: its own component rerenders while the
    // item wrapper is left untouched. Exact sibling-update cardinality/order is not a contract.
    expect(registry).toContain('RxtTrackerProjectionViewport');
    expect(registry).not.toContain('RxtTrackerProjectionItems');
    app.unmount();
  });

  it('updates selection imperatively without rerendering the item wrapper or replacing keyed marker nodes', async () => {
    const sourceRoot = document.createElement('main');
    const container = document.createElement('div');
    const registry: string[] = [];

    ['a', 'b', 'c'].forEach((suffix) => {
      const target = document.createElement('div');

      target.className = 'vue-selection-scope-target';
      target.dataset.suffix = suffix;
      sourceRoot.append(target);
    });
    document.body.append(sourceRoot, container);
    const app = createApp(Tracker, {
      options: TEST_OPTIONS,
      rules: [{ selector: '.vue-selection-scope-target' }],
      sourceRoot,
    });

    app.mixin({
      beforeUpdate(): void {
        if (this.$options.name) {
          registry.push(this.$options.name);
        }
      },
    });
    app.mount(container);
    await flush();
    const trackerRoot = container.querySelector('.rxtt');

    // Establish a non-trivial selection first by moving off the initially selected marker.
    trackerRoot?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    await flush();
    const before = [...container.querySelectorAll('.rxtt__marker')];

    expect(before).toHaveLength(3);
    expect(before[1]?.getAttribute('data-rxtt-selected')).toBe('true');
    const keysBefore = before.map((marker) => marker.getAttribute('data-rxtt-key'));

    registry.length = 0;
    trackerRoot?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    await flush();
    const after = [...container.querySelectorAll('.rxtt__marker')];

    // A selection-only transition never rerenders any component in the tree; the shared
    // `watch(stores.selection)` mutates the selected attribute imperatively instead.
    expect(registry).toEqual([]);
    // Every keyed marker keeps its exact HTMLElement identity and key.
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(after.map((marker) => marker.getAttribute('data-rxtt-key'))).toEqual(keysBefore);
    // The selected attribute moves exactly from the previous key to the next key.
    expect(after[1]?.hasAttribute('data-rxtt-selected')).toBe(false);
    expect(after[2]?.getAttribute('data-rxtt-selected')).toBe('true');
    app.unmount();
  });

  it('reapplies restored configuration after a combined root/configuration update fails during remount', async () => {
    const sourceRootA = document.createElement('main');
    const firstTarget = document.createElement('div');
    const container = document.createElement('div');
    const iframe = document.createElement('iframe');
    const errors: unknown[] = [];

    // sourceRootA deliberately contains only a `.vue-recovery-first-target` element and no
    // `.vue-recovery-second-target` element, so the marker count alone (1 vs. 0) after recovery
    // unambiguously reveals which rule set Core is actually running.
    firstTarget.className = 'vue-recovery-first-target';
    sourceRootA.append(firstTarget);
    document.body.append(sourceRootA, container, iframe);

    const invalidSourceRoot = iframe.contentDocument!.body;
    const rules1 = [{ selector: '.vue-recovery-first-target' }];
    const rules2 = [{ selector: '.vue-recovery-second-target' }];
    const sourceRoot = shallowRef<HTMLElement>(sourceRootA);
    const rules = shallowRef<readonly TrackerRule[]>(rules1);
    const handle = shallowRef<TrackerHandle | null>(null);
    const app = createApp(
      defineComponent({
        setup: () => () =>
          h(Tracker, { options: TEST_OPTIONS, ref: handle, rules: rules.value, sourceRoot: sourceRoot.value }),
      }),
    );

    app.config.errorHandler = (error) => errors.push(error);
    app.mount(container);
    await flush();

    expect(container.querySelectorAll('.rxtt__marker')).toHaveLength(1);
    const trackerRoot = container.querySelector('.rxtt');
    const statsBeforeUpdate = handle.value!.getStats();

    // One framework update changes both the root (to a deliberately invalid, cross-realm root) and
    // the rules together, mirroring a single reactive commit in a real application. Production then:
    //   1. unmounts the current runtime because the roots changed;
    //   2. calls replaceConfiguration(rules2) successfully and immediately checkpoints
    //      appliedRules = rules2;
    //   3. attempts to mount the foreign sourceRoot, which throws ERR_TRACKER_REALM_MISMATCH before
    //      the sourceRoot checkpoint is updated, so appliedSourceRoot stays sourceRootA.
    sourceRoot.value = invalidSourceRoot as unknown as HTMLElement;
    rules.value = rules2;
    await flush();

    // Vue routes the watcher's synchronous throw to the app error handler; the watcher itself survives.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'ERR_TRACKER_REALM_MISMATCH' });
    expect(handle.value!.getState()).toBe('unmounted');

    const statsAfterFailedMount = handle.value!.getStats();

    // rules2 already committed to Core (replaceConfiguration succeeded) before the mount attempt
    // failed; the rules were NOT automatically rolled back at this point.
    expect(statsAfterFailedMount.rules.added - statsBeforeUpdate.rules.added).toBe(1);
    expect(statsAfterFailedMount.rules.removed - statsBeforeUpdate.rules.removed).toBe(1);

    errors.length = 0;
    // Restore the exact original sourceRoot and rules references.
    sourceRoot.value = sourceRootA;
    rules.value = rules1;
    await flush();

    // The sourceRoot checkpoint still holds sourceRootA (the root change is a no-op), but the
    // configuration checkpoint holds rules2, so the watcher sees rules1 !== rules2, rebuilds the
    // configuration, calls replaceConfiguration(rules1) again, and remounts sourceRootA because the
    // runtime is currently unmounted.
    expect(errors).toEqual([]);
    expect(handle.value!.getState()).toBe('mounted');
    // sourceRootA has no `.vue-recovery-second-target` element, so exactly one marker proves rules1 —
    // not rules2 — is the rule set Core is running after recovery.
    expect(container.querySelectorAll('.rxtt__marker')).toHaveLength(1);
    // The component-owned render root is reused across the failed remount and the recovery.
    expect(container.querySelector('.rxtt')).toBe(trackerRoot);
    app.unmount();
  });

  it('rejects a null rules update before mutating the committed Vue runtime', async () => {
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const container = document.createElement('div');
    const errors: unknown[] = [];

    target.className = 'vue-rules-update-target';
    sourceRoot.append(target);
    document.body.append(sourceRoot, container);

    const rules = shallowRef<readonly TrackerRule[] | undefined>([{ selector: '.vue-rules-update-target' }]);
    const handle = shallowRef<TrackerHandle | null>(null);
    const app = createApp(
      defineComponent({
        setup: () => () => h(Tracker, { options: TEST_OPTIONS, ref: handle, rules: rules.value, sourceRoot }),
      }),
    );

    app.config.errorHandler = (error) => errors.push(error);
    app.mount(container);
    await flush();

    const markersBefore = container.querySelectorAll('.rxtt__marker');

    expect(markersBefore).toHaveLength(1);
    const trackerRoot = container.querySelector('.rxtt');
    const marker = markersBefore[0];

    // `null` is an intentional invalid public input, distinct from an absent prop.
    // @ts-expect-error - exercising an invalid runtime value the public type forbids.
    rules.value = null;
    await flush();

    // Validation fails at the top of the watcher (createRuntimeConfiguration) before any
    // unmount / replaceConfiguration / mount side effect touches the committed runtime.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' });
    expect(handle.value!.getState()).toBe('mounted');
    expect(container.querySelector('.rxtt')).toBe(trackerRoot);
    expect(container.querySelectorAll('.rxtt__marker')).toHaveLength(1);
    expect(container.querySelector('.rxtt__marker')).toBe(marker);
    expect(marker?.isConnected).toBe(true);
    app.unmount();
  });
});
