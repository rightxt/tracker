import { shallowRef } from 'vue';

import type {
  TrackerChromeView,
  TrackerItemView,
  TrackerMountView,
  TrackerProjectionCommit,
  TrackerProjectionState,
  TrackerSelectionView,
  TrackerViewportView,
} from '@rightxt/tracker-core/projection';
import type { ShallowRef } from 'vue';

/** Independently reactive domains used by the Vue projection integration. */
interface VueProjectionStores {
  /** Root and marker-layer presentation. */
  readonly chrome: ShallowRef<TrackerChromeView>;
  /** Ordered immutable render records. */
  readonly items: ShallowRef<readonly TrackerItemView[]>;
  /** Mount generation and geometry state. */
  readonly mount: ShallowRef<TrackerMountView>;
  /** Isolated selected-key transition. */
  readonly selection: ShallowRef<TrackerSelectionView>;
  /** Independent viewport presentation. */
  readonly viewport: ShallowRef<TrackerViewportView>;
  /** Applies one coherent Core projection commit. */
  applyCommit: (commit: TrackerProjectionCommit) => void;
  /** Returns an isolated boolean ref for one keyed item's selected state. */
  getItemSelection: (key: string) => ShallowRef<boolean>;
}

/**
 * Splits coherent Core commits into independently reactive Vue domains.
 *
 * @param initialState - Initial coherent projection state.
 * @returns Domain refs and their generation-aware commit coordinator.
 */
function createVueProjectionStores(initialState: TrackerProjectionState): VueProjectionStores {
  const chrome = shallowRef(initialState.chrome);
  const items = shallowRef(initialState.items);
  const mount = shallowRef(initialState.mount);
  const selection = shallowRef(initialState.selection);
  const viewport = shallowRef(initialState.viewport);
  const itemSelectionStores = new Map<string, ShallowRef<boolean>>();
  let generation = initialState.generation;
  let revision = initialState.revision;
  let selectedKey = initialState.selection.selectedKey;

  return {
    applyCommit(commit) {
      if (
        commit.state.generation < generation ||
        (commit.state.generation === generation && commit.state.revision <= revision)
      ) {
        return;
      }

      generation = commit.state.generation;
      revision = commit.state.revision;

      commit.changed.forEach((domain) => {
        if (domain === 'chrome') {
          chrome.value = commit.state.chrome;
        } else if (domain === 'items') {
          items.value = commit.state.items;
          const activeKeys = new Set(commit.state.items.map((item) => item.key));

          itemSelectionStores.forEach((_store, key) => {
            if (!activeKeys.has(key)) {
              itemSelectionStores.delete(key);
            }
          });
        } else if (domain === 'mount') {
          mount.value = commit.state.mount;
        } else if (domain === 'selection') {
          const previousStore = itemSelectionStores.get(commit.state.selection.previousKey ?? '');
          const selectedStore = itemSelectionStores.get(commit.state.selection.selectedKey ?? '');

          if (previousStore !== undefined) {
            previousStore.value = false;
          }

          if (selectedStore !== undefined) {
            selectedStore.value = true;
          }

          selectedKey = commit.state.selection.selectedKey;
          selection.value = commit.state.selection;
        } else {
          viewport.value = commit.state.viewport;
        }
      });
    },
    chrome,
    getItemSelection(key) {
      const existing = itemSelectionStores.get(key);

      if (existing !== undefined) {
        return existing;
      }

      const store = shallowRef(selectedKey === key);

      itemSelectionStores.set(key, store);

      return store;
    },
    items,
    mount,
    selection,
    viewport,
  };
}

export type { VueProjectionStores };
export { createVueProjectionStores };
