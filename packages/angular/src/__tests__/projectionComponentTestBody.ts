import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ApplicationRef, ComponentRef } from '@angular/core';
import type { TrackerState, TrackerStats } from '@rightxt/tracker-core';

/** Public contract exercised by the shared Angular Tracker component tests. */
interface TrackerComponentContract {
  /** Returns the current lifecycle state. */
  getState: () => TrackerState;
  /** Returns current diagnostics. */
  getStats: () => TrackerStats;
  /** Performs an immediate refresh. */
  refresh: () => void;
  /** Resolves after this Core runtime generation is permanently destroyed. */
  whenRuntimeDestroyed: () => Promise<void>;
}

/** One bootstrapped Tracker component test fixture. */
interface MountedTrackerComponent<TComponent extends TrackerComponentContract = TrackerComponentContract> {
  /** Owning Angular application. */
  application: ApplicationRef;
  /** Tracker component reference. */
  component: ComponentRef<TComponent>;
  /** Runs synchronous change detection for the mounted root component. */
  detectChanges: () => void;
  /** Component host element. */
  host: HTMLElement;
}

/** Bootstraps one Tracker fixture under a given zoneful/zoneless mode. */
type MountTracker<TComponent extends TrackerComponentContract = TrackerComponentContract> = () => Promise<
  MountedTrackerComponent<TComponent>
>;

/** Update sources disabled so each test drives Core synchronously through refresh(). */
const DISABLED_UPDATE_SOURCES = {
  interval: { enabled: false },
  mutation: { enabled: false },
  resize: { enabled: false },
  scroll: { enabled: false },
} as const;

/** Minimal observer double for component tests that do not exercise browser resize delivery. */
class InertResizeObserver {
  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}
}

/** Installs the observer double when the current test environment has no native implementation. */
function ensureTestResizeObserver(): void {
  if (globalThis.ResizeObserver === undefined) {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: InertResizeObserver,
      writable: true,
    });
  }
}

/** Destroys a mounted test fixture and removes its host. */
function destroyTracker(mounted: MountedTrackerComponent): void {
  mounted.application.destroy();
  mounted.host.remove();
}

/**
 * Runs the shared Tracker component correctness suite against one bootstrap
 * strategy, so identical assertions execute under both zoneless and zoneful
 * (zone.js-loaded) Angular change detection.
 *
 * The suite owns Angular-wrapper semantics that genuinely differ from Core:
 * immutable-input reconciliation, `undefined`-vs-`null` handling, the dedicated
 * rules channel, checkpoint ordering across a bundled root remount, and
 * imperative-handle lifetime through framework teardown. Real event bridges,
 * clustering, and pointer activation are owned by Browser Mode; canonical
 * option/rule value validation is owned by Core.
 *
 * @param mountTracker - Bootstraps one Tracker fixture in the current mode.
 */
function defineTrackerComponentTests<TComponent extends TrackerComponentContract>(
  mountTracker: MountTracker<TComponent>,
): void {
  describe('Angular TrackerComponent', () => {
    const originalResizeObserver = globalThis.ResizeObserver;

    beforeAll(ensureTestResizeObserver);

    afterAll(() => {
      if (originalResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
      }
    });

    it('treats undefined options as omission but rejects null without replacing the Angular-owned root', async () => {
      const mounted = await mountTracker();

      mounted.component.setInput('options', {
        orientation: 'horizontal',
        placement: 'top',
        updates: DISABLED_UPDATE_SOURCES,
      });
      mounted.detectChanges();

      const trackerRoot = mounted.host.querySelector('.rxtt');

      expect(trackerRoot).toBeInstanceOf(HTMLElement);
      expect(trackerRoot?.getAttribute('data-rxtt-orientation')).toBe('horizontal');
      expect(trackerRoot?.getAttribute('data-rxtt-placement')).toBe('top');

      // `null` is an intentional invalid runtime value the public input type forbids.
      mounted.component.setInput('options', null);

      expect(() => mounted.detectChanges()).toThrow(
        expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
      );
      // The rejected configuration never replaces the root or mutates committed state.
      expect(mounted.host.querySelector('.rxtt')).toBe(trackerRoot);
      expect(trackerRoot?.isConnected).toBe(true);
      expect(trackerRoot?.getAttribute('data-rxtt-orientation')).toBe('horizontal');
      expect(trackerRoot?.getAttribute('data-rxtt-placement')).toBe('top');

      // Explicit `undefined` means omission: the same root returns to canonical defaults.
      mounted.component.setInput('options', undefined);
      mounted.detectChanges();

      expect(mounted.host.querySelector('.rxtt')).toBe(trackerRoot);
      expect(trackerRoot?.getAttribute('data-rxtt-orientation')).toBe('vertical');
      expect(trackerRoot?.getAttribute('data-rxtt-placement')).toBe('left');

      destroyTracker(mounted);
    });

    it('keeps the imperative handle bound to one Core runtime generation through Angular teardown', async () => {
      const mounted = await mountTracker();
      const instance = mounted.component.instance;

      expect(instance.getState()).toBe('mounted');

      const rendersBeforeRefresh = instance.getStats().renders.completed;

      instance.refresh();
      mounted.detectChanges();

      // The same retained handle drives another completed render on one generation.
      expect(instance.getStats().renders.completed).toBeGreaterThan(rendersBeforeRefresh);

      const destroyed = instance.whenRuntimeDestroyed();

      // Repeated calls observe one stable terminal Promise for this generation.
      expect(instance.whenRuntimeDestroyed()).toBe(destroyed);

      destroyTracker(mounted);

      await expect(destroyed).resolves.toBeUndefined();
      expect(instance.getState()).toBe('destroyed');
      expect(() => instance.refresh()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }));
    });

    it('rejects rules tunneled through options instead of the dedicated rules input', async () => {
      const mounted = await mountTracker();

      mounted.component.setInput('options', {
        rules: [{ selector: '.angular-tunneled-rule-target' }],
      });

      expect(() => mounted.detectChanges()).toThrow(
        'Angular Tracker rules must be passed through the dedicated rules input.',
      );
      // The wrapper rejects before Core sees the tunneled rule, so nothing is published.
      expect(mounted.host.querySelector('.rxtt__marker')).toBeNull();

      // The component stays usable once the caller moves the rule to its own input.
      mounted.component.setInput('options', {});
      mounted.component.setInput('rules', []);

      expect(() => mounted.detectChanges()).not.toThrow();
      expect(mounted.host.querySelector('.rxtt')).toBeInstanceOf(HTMLElement);

      destroyTracker(mounted);
    });

    it('distinguishes null and undefined rules before checkpointing a simultaneous sourceRoot update', async () => {
      const firstSourceRoot = document.createElement('div');
      const secondSourceRoot = document.createElement('div');
      const mounted = await mountTracker();

      firstSourceRoot.innerHTML = '<div class="angular-rules-checkpoint-target"></div>';
      secondSourceRoot.innerHTML =
        '<div class="angular-rules-checkpoint-target"></div><div class="angular-rules-checkpoint-target"></div>';
      document.body.append(firstSourceRoot, secondSourceRoot);

      const rules1 = [{ selector: '.angular-rules-checkpoint-target' }];

      mounted.component.setInput('options', { clustering: { enabled: false }, updates: DISABLED_UPDATE_SOURCES });
      mounted.component.setInput('rules', rules1);
      mounted.component.setInput('sourceRoot', firstSourceRoot);
      mounted.detectChanges();

      const trackerRoot = mounted.host.querySelector('.rxtt');

      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(1);

      // One update set proposes an invalid rules value together with a new source root.
      mounted.component.setInput('rules', null);
      mounted.component.setInput('sourceRoot', secondSourceRoot);

      expect(() => mounted.detectChanges()).toThrow(
        expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
      );
      // The failed configuration evaluation checkpointed neither the root nor the mount.
      expect(mounted.host.querySelector('.rxtt')).toBe(trackerRoot);
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(1);

      // Explicit `undefined` rules means an empty rule list, not an own-undefined rejection.
      mounted.component.setInput('rules', undefined);
      mounted.detectChanges();
      mounted.component.instance.refresh();
      mounted.detectChanges();

      expect(mounted.host.querySelector('.rxtt')).toBe(trackerRoot);
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(0);

      // The still-current second root reconciles once the rules become valid again.
      mounted.component.setInput('rules', rules1);
      mounted.detectChanges();
      mounted.component.instance.refresh();
      mounted.detectChanges();

      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(2);

      destroyTracker(mounted);
      firstSourceRoot.remove();
      secondSourceRoot.remove();
    });

    it('recovers a fail-closed root-only remount when the last committed sourceRoot is requested again', async () => {
      const iframe = document.createElement('iframe');
      const sourceRoot = document.createElement('div');
      const target = document.createElement('div');
      const mounted = await mountTracker();

      target.className = 'angular-root-recovery-target';
      sourceRoot.appendChild(target);
      document.body.append(iframe, sourceRoot);

      const foreignSourceRoot = iframe.contentDocument?.body;

      if (!foreignSourceRoot) {
        throw new Error('Expected iframe source root.');
      }

      mounted.component.setInput('options', { clustering: { enabled: false }, updates: DISABLED_UPDATE_SOURCES });
      mounted.component.setInput('rules', [{ selector: '.angular-root-recovery-target' }]);
      mounted.component.setInput('sourceRoot', sourceRoot);
      mounted.detectChanges();

      expect(mounted.component.instance.getState()).toBe('mounted');
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(1);

      mounted.component.setInput('sourceRoot', foreignSourceRoot);

      expect(() => mounted.detectChanges()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH' }));
      mounted.detectChanges();

      // Fail-closed: the rejected root leaves no mount and a live, unmounted handle.
      expect(mounted.component.instance.getState()).toBe('unmounted');
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(0);

      // Requesting the exact last-committed root identity again recovers this generation.
      mounted.component.setInput('sourceRoot', sourceRoot);
      mounted.detectChanges();

      expect(mounted.component.instance.getState()).toBe('mounted');
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(1);
      expect(() => mounted.component.instance.refresh()).not.toThrow();

      destroyTracker(mounted);
      iframe.remove();
      sourceRoot.remove();
    });

    it('keeps a successfully committed rule replacement after the bundled root remount fails, until the caller restores it', async () => {
      const iframe = document.createElement('iframe');
      const sourceRootA = document.createElement('div');
      const firstTarget = document.createElement('div');
      const mounted = await mountTracker();

      firstTarget.className = 'angular-config-survival-rules1-target';
      sourceRootA.appendChild(firstTarget);
      document.body.append(iframe, sourceRootA);

      const foreignSourceRoot = iframe.contentDocument?.body;

      if (!foreignSourceRoot) {
        throw new Error('Expected iframe source root.');
      }

      const rules1 = [{ selector: '.angular-config-survival-rules1-target' }];
      const rules2 = [{ selector: '.angular-config-survival-rules2-target' }];

      mounted.component.setInput('options', { clustering: { enabled: false }, updates: DISABLED_UPDATE_SOURCES });
      mounted.component.setInput('rules', rules1);
      mounted.component.setInput('sourceRoot', sourceRootA);
      mounted.detectChanges();

      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(1);

      // One update set swaps the rules and moves to a foreign, cross-realm root.
      mounted.component.setInput('rules', rules2);
      mounted.component.setInput('sourceRoot', foreignSourceRoot);

      expect(() => mounted.detectChanges()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH' }));
      mounted.detectChanges();

      expect(mounted.component.instance.getState()).toBe('unmounted');
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(0);

      // Restoring only the root remounts, but rules2 stays the committed rule list:
      // sourceRootA has no rules2 target, so the recovered mount renders zero markers.
      mounted.component.setInput('sourceRoot', sourceRootA);
      mounted.detectChanges();

      expect(mounted.component.instance.getState()).toBe('mounted');
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(0);

      // Only an explicit rules1 restore by the caller brings the marker back.
      mounted.component.setInput('rules', rules1);
      mounted.detectChanges();
      mounted.component.instance.refresh();
      mounted.detectChanges();

      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(1);
      expect(() => mounted.component.instance.refresh()).not.toThrow();

      destroyTracker(mounted);
      iframe.remove();
      sourceRootA.remove();
    });
  });
}

export type { MountTracker, MountedTrackerComponent, TrackerComponentContract };
export { defineTrackerComponentTests, ensureTestResizeObserver };
