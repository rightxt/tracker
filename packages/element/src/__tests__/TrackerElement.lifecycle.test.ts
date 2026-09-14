// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { CLASS_NAMES, createTrackerElement, stubLayout } from './TrackerElement.testSupport.js';

describe('TrackerElement rendering and lifecycle recovery contract', () => {
  it('removes obsolete keyed markers while preserving the surviving node identity', () => {
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    const element = createTrackerElement();

    firstTarget.className = 'first-target';
    secondTarget.className = 'second-target';
    document.body.append(firstTarget, secondTarget);

    element.replaceOptions({
      clustering: {
        enabled: false,
      },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([
      { label: 'First', selector: '.first-target' },
      { label: 'Second', selector: '.second-target' },
    ]);
    document.body.appendChild(element);

    expect(element.querySelectorAll(`.${CLASS_NAMES.MARKER}`)).toHaveLength(2);

    // Capture the exact identity of both keyed marker nodes before the rule set
    // shrinks. The projected rule label is reflected as the marker `title`.
    const survivingMarker = element.querySelector(`.${CLASS_NAMES.MARKER}[title="Second"]`);
    const obsoleteMarker = element.querySelector(`.${CLASS_NAMES.MARKER}[title="First"]`);

    expect(survivingMarker).toBeInstanceOf(HTMLElement);
    expect(obsoleteMarker).toBeInstanceOf(HTMLElement);

    element.replaceRules([{ label: 'Second', selector: '.second-target' }]);
    element.render();

    const remainingMarkers = Array.from(element.querySelectorAll(`.${CLASS_NAMES.MARKER}`));

    // Exactly one marker remains, and it is the very node captured earlier rather
    // than a rebuilt replacement; the dropped key's node is physically detached.
    expect(remainingMarkers).toHaveLength(1);
    expect(remainingMarkers[0]).toBe(survivingMarker);
    expect(obsoleteMarker?.isConnected).toBe(false);

    element.remove();
    firstTarget.remove();
    secondTarget.remove();
  });

  it('avoids structural marker mutations for stable keys and attribute-only updates', () => {
    const target = document.createElement('div');
    const element = createTrackerElement();

    target.className = 'stable-marker-target';
    document.body.appendChild(target);

    element.replaceOptions({
      clustering: { enabled: false },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ marker: { className: 'initial-marker' }, selector: '.stable-marker-target' }]);
    document.body.appendChild(element);

    const markersLayer = element.querySelector(`.${CLASS_NAMES.MARKERS}`);

    if (markersLayer === null || markersLayer === undefined) {
      throw new Error('Expected an element markers layer.');
    }

    const markerBeforeUpdate = markersLayer.firstElementChild;

    expect(markerBeforeUpdate).toBeInstanceOf(HTMLElement);

    const observer = new MutationObserver(() => {});

    observer.observe(markersLayer, { childList: true });
    element.render();

    expect(observer.takeRecords()).toEqual([]);

    element.replaceRules([{ marker: { className: 'updated-marker' }, selector: '.stable-marker-target' }]);
    element.render();

    expect(observer.takeRecords()).toEqual([]);
    // The stable key keeps its exact node; only presentation changes in place.
    expect(markersLayer.firstElementChild).toBe(markerBeforeUpdate);
    expect(markersLayer.firstElementChild?.classList.contains('updated-marker')).toBe(true);

    observer.disconnect();
    element.remove();
    target.remove();
  });

  it('delivers a retired runtime deferred destroy only to host listeners current after a synchronous reconnect', () => {
    const target = document.createElement('div');
    const element = createTrackerElement();
    const destroyOne = vi.fn();
    const destroyTwo = vi.fn();

    target.className = 'deferred-destroy-target';
    document.body.appendChild(target);

    element.replaceOptions({
      clustering: { enabled: false },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.deferred-destroy-target' }]);
    document.body.appendChild(element);

    element.addEventListener('destroy', destroyOne);
    element.addEventListener('destroy', destroyTwo);

    let hasReconnected = false;

    element.addEventListener('sync:start', () => {
      if (hasReconnected) {
        return;
      }
      hasReconnected = true;

      // Disconnect while the retiring runtime's render dispatch is still active,
      // so Core defers its terminal destroy publication. The synchronous
      // re-append installs a replacement runtime; removeEventListener() then
      // retires destroyOne from the persistent host EventTarget before that
      // deferred destroy finally dispatches.
      element.remove();
      document.body.appendChild(element);
      element.removeEventListener('destroy', destroyOne);
    });

    element.render();

    // Host listener membership is resolved at CustomEvent dispatch time: the
    // removed listener never runs, the retained listener runs exactly once for
    // the retired runtime's terminal publication.
    expect(destroyOne).not.toHaveBeenCalled();
    expect(destroyTwo).toHaveBeenCalledTimes(1);

    // The synchronous reconnect leaves exactly one fresh Element-owned root and a
    // fully usable replacement runtime.
    expect(element.querySelectorAll('.rxtt')).toHaveLength(1);
    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);

    const syncStartAfterReconnect = vi.fn();

    element.addEventListener('sync:start', syncStartAfterReconnect);
    element.render();

    expect(syncStartAfterReconnect).toHaveBeenCalledTimes(1);

    element.remove();
    target.remove();
  });

  it('recreates a connected runtime when later options resolve an initial mount failure', () => {
    const scrollRoot = document.createElement('div');
    const target = document.createElement('div');
    const element = createTrackerElement();
    const errorOutput = vi.fn();

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    stubLayout(scrollRoot);
    target.className = 'options-recovery-target';
    scrollRoot.appendChild(target);
    document.body.appendChild(scrollRoot);

    // Configured while disconnected so the failure surfaces through
    // connectedCallback()'s non-throwing report path, leaving #runtime
    // null, rather than through the scrollRoot setter's connected-remount
    // path, which is documented to throw by design.
    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { output: { error: errorOutput }, warnings: false },
      orientation: 'horizontal',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.options-recovery-target' }]);
    element.scrollRoot = scrollRoot;
    document.body.appendChild(element);

    // The connection failure is reported through the caller-owned diagnostics
    // sink, not thrown from the append reaction.
    expect(errorOutput).toHaveBeenCalledWith(
      'element-lifecycle-error',
      'TrackerElement connection and rollback both failed.',
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(element.querySelector('.rxtt')).toBeNull();
    expect(element.getStats()).toBeNull();

    // A later options replacement reaches #syncRuntimeConfiguration() with
    // #runtime === null and recreates a healthy mounted runtime once the
    // configuration is valid.
    expect(() => {
      element.replaceOptions({
        clustering: { enabled: false },
        diagnostics: { output: { error: errorOutput }, warnings: false },
        orientation: 'vertical',
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      });
    }).not.toThrow();

    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);
    expect(element.getStats()).not.toBeNull();

    element.remove();
    scrollRoot.remove();
  });

  it('retries one failed owned-root removal before creating the replacement runtime during a same-document move', () => {
    const target = document.createElement('div');
    const newParent = document.createElement('div');
    const element = createTrackerElement();

    target.className = 'reconnect-move-target';
    document.body.append(target, newParent);

    element.replaceOptions({
      clustering: { enabled: false },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.reconnect-move-target' }]);
    document.body.appendChild(element);

    const originalRoot = element.querySelector('.rxtt');

    if (originalRoot === null) {
      throw new Error('Expected a mounted root.');
    }

    let removeCallCount = 0;
    const originalRemove = originalRoot.remove.bind(originalRoot);

    originalRoot.remove = () => {
      removeCallCount += 1;

      if (removeCallCount === 1) {
        throw new Error('remove failed once');
      }

      originalRemove();
    };

    expect(() => {
      newParent.appendChild(element);
    }).not.toThrow();

    // The first owned-root removal threw; the replacement connection retried the
    // same root's removal before creating a new one.
    expect(removeCallCount).toBe(2);
    expect(element.querySelectorAll('.rxtt')).toHaveLength(1);
    expect(element.querySelector('.rxtt')).not.toBe(originalRoot);
    expect(originalRoot.isConnected).toBe(false);

    const syncStart = vi.fn();

    element.addEventListener('sync:start', syncStart);
    element.render();

    expect(syncStart).toHaveBeenCalledTimes(1);

    element.remove();
    target.remove();
    newParent.remove();
  });

  it('returns the same normalized immutable committed options independent of connection state', async () => {
    const element = createTrackerElement();

    element.replaceOptions({
      orientation: 'horizontal',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });

    const disconnectedOptions = element.getOptions();

    // Representative committed values: an explicit non-default orientation, the
    // orientation-derived normalized placement, an explicitly disabled update
    // source, and a normalization-supplied default.
    expect(disconnectedOptions.orientation).toBe('horizontal');
    expect(disconnectedOptions.placement).toBe('top');
    expect(disconnectedOptions.updates.mutation.enabled).toBe(false);
    expect(disconnectedOptions.a11y.label).toBe('Content tracker');
    expect(Object.isFrozen(disconnectedOptions.updates.mutation)).toBe(true);

    // Detached view: separate calls are distinct wrappers with equal value, and
    // a frozen nested branch cannot be mutated to influence later reads.
    expect(element.getOptions()).not.toBe(disconnectedOptions);
    expect(element.getOptions()).toEqual(disconnectedOptions);
    expect(() => {
      (disconnectedOptions.updates.mutation as { enabled: boolean }).enabled = true;
    }).toThrow();

    document.body.appendChild(element);
    await Promise.resolve();

    const connectedOptions = element.getOptions();

    // Committed branches are read without optional chaining, which only compiles
    // because getOptions() returns the resolved options type.
    expect(connectedOptions).toEqual(disconnectedOptions);
    expect(connectedOptions.orientation).toBe('horizontal');
    expect(connectedOptions.placement).toBe('top');
    expect(connectedOptions.updates.mutation.enabled).toBe(false);
    expect(Object.isFrozen(connectedOptions.updates.mutation)).toBe(true);

    element.remove();
    await Promise.resolve();

    expect(element.getOptions()).toEqual(disconnectedOptions);
  });
});
