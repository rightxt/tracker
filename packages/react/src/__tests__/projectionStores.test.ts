import { describe, expect, it, vi } from 'vitest';

import { createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection';
import { createReactProjectionStores } from '../projectionStores.js';

import type {
  TrackerItemView,
  TrackerProjectionCommit,
  TrackerProjectionState,
} from '@rightxt/tracker-core/projection';

/** Creates one minimal immutable renderer-ready item view. */
function createItem(key: string): TrackerItemView {
  return Object.freeze({
    attributes: Object.freeze({}),
    className: 'rxtt-marker',
    key,
    styleVars: Object.freeze({}),
  });
}

/** Creates a detached store graph and its initial projection. */
function createStores(): {
  initial: TrackerProjectionState;
  stores: ReturnType<typeof createReactProjectionStores>;
} {
  const integration = createTrackerProjectionIntegration();
  const initial = integration.getProjection();
  const stores = createReactProjectionStores(initial);

  integration.destroy();

  return { initial, stores };
}

/**
 * Creates a coherent synthetic commit for store-isolation tests.
 *
 * @param initial - Previous coherent state.
 * @param next - Changed state fields.
 * @param changed - Declared changed domains.
 * @returns Synthetic coherent commit.
 */
function createCommit(
  initial: TrackerProjectionState,
  next: Partial<TrackerProjectionState>,
  changed: TrackerProjectionCommit['changed'],
): TrackerProjectionCommit {
  return {
    changed,
    state: Object.freeze({ ...initial, revision: initial.revision + 1, ...next }),
  };
}

describe('React projection stores', () => {
  it('stages every changed React domain before synchronously notifying subscribers', () => {
    const { initial, stores } = createStores();
    const nextMount = Object.freeze({ ...initial.mount, geometryAvailable: !initial.mount.geometryAvailable });
    const nextViewport = Object.freeze({ ...initial.viewport, className: 'staged-viewport' });
    const observedViewport = vi.fn();

    stores.mount.subscribe(() => {
      observedViewport(stores.viewport.getSnapshot());
    });
    stores.applyCommit(createCommit(initial, { mount: nextMount, viewport: nextViewport }, ['mount', 'viewport']));

    expect(observedViewport).toHaveBeenCalledTimes(1);
    expect(observedViewport).toHaveBeenCalledWith(nextViewport);
  });

  it('does not notify the React items store for viewport-only or selection-only commits', () => {
    const { initial, stores } = createStores();
    const items = Object.freeze([createItem('a')]);

    stores.applyCommit(createCommit(initial, { items }, ['items']));

    const itemListener = vi.fn();

    stores.items.subscribe(itemListener);
    const withItems = { ...initial, items, revision: initial.revision + 1 };

    stores.applyCommit(
      createCommit(withItems, { viewport: Object.freeze({ ...initial.viewport, className: 'viewport-only' }) }, [
        'viewport',
      ]),
    );
    stores.applyCommit(
      createCommit(
        { ...withItems, revision: withItems.revision + 1 },
        { selection: Object.freeze({ previousKey: null, selectedKey: 'a' }) },
        ['selection'],
      ),
    );

    expect(itemListener).not.toHaveBeenCalled();
  });

  it('notifies only keyed selection stores whose boolean value changes', () => {
    const { initial, stores } = createStores();
    const items = Object.freeze([createItem('a'), createItem('b'), createItem('c')]);

    stores.applyCommit(createCommit(initial, { items }, ['items']));

    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const thirdListener = vi.fn();

    stores.getItemSelection('a').subscribe(firstListener);
    stores.getItemSelection('b').subscribe(secondListener);
    stores.getItemSelection('c').subscribe(thirdListener);
    const withItems = { ...initial, items, revision: initial.revision + 1 };

    stores.applyCommit(
      createCommit(withItems, { selection: Object.freeze({ previousKey: null, selectedKey: 'a' }) }, ['selection']),
    );
    stores.applyCommit(
      createCommit(
        { ...withItems, revision: withItems.revision + 1 },
        { selection: Object.freeze({ previousKey: 'a', selectedKey: 'b' }) },
        ['selection'],
      ),
    );

    expect(firstListener).toHaveBeenCalledTimes(2);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(thirdListener).not.toHaveBeenCalled();
  });

  it('releases React keyed-selection stores when item ownership leaves the Projection domain', () => {
    const { initial, stores } = createStores();
    const item = createItem('removed-key');

    stores.applyCommit(createCommit(initial, { items: Object.freeze([item]) }, ['items']));
    const retiredSelectionStore = stores.getItemSelection(item.key);
    const withItem = { ...initial, items: Object.freeze([item]), revision: initial.revision + 1 };

    stores.applyCommit(createCommit(withItem, { items: Object.freeze([]) }, ['items']));

    const replacement = stores.getItemSelection(item.key);

    expect(replacement).not.toBe(retiredSelectionStore);
    expect(replacement.getSnapshot()).toBe(false);
  });
});
