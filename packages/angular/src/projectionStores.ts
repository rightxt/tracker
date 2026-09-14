import { signal } from '@angular/core';

import type { Signal, WritableSignal } from '@angular/core';
import type {
  TrackerChromeView,
  TrackerItemView,
  TrackerMountView,
  TrackerProjectionCommit,
  TrackerProjectionState,
  TrackerSelectionView,
  TrackerViewportView,
} from '@rightxt/tracker-core/projection';

/** Independently reactive domains used by the Angular projection integration. */
interface AngularProjectionStores {
  /** Root and marker-layer presentation. */
  readonly chrome: Signal<TrackerChromeView>;
  /** Ordered immutable render records. */
  readonly items: Signal<readonly TrackerItemView[]>;
  /** Mount generation and geometry state. */
  readonly mount: Signal<TrackerMountView>;
  /** Isolated selected-key transition. */
  readonly selection: Signal<TrackerSelectionView>;
  /** Independent viewport presentation. */
  readonly viewport: Signal<TrackerViewportView>;
  /** Applies one coherent Core projection commit. */
  applyCommit: (commit: TrackerProjectionCommit) => void;
  /** Returns an isolated boolean signal for one keyed item's selected state. */
  getItemSelection: (key: string) => Signal<boolean>;
}

/**
 * Splits coherent Core commits into independently reactive Angular signals.
 *
 * @param initialState - Initial coherent projection state.
 * @returns Domain signals and their generation-aware commit coordinator.
 */
function createAngularProjectionStores(initialState: TrackerProjectionState): AngularProjectionStores {
  const chrome = signal(initialState.chrome);
  const items = signal(initialState.items);
  const mount = signal(initialState.mount);
  const selection = signal(initialState.selection);
  const viewport = signal(initialState.viewport);
  const itemSelectionStores = new Map<string, WritableSignal<boolean>>();
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
          chrome.set(commit.state.chrome);
        } else if (domain === 'items') {
          items.set(commit.state.items);
          const activeKeys = new Set(commit.state.items.map((item) => item.key));

          itemSelectionStores.forEach((_store, key) => {
            if (!activeKeys.has(key)) {
              itemSelectionStores.delete(key);
            }
          });
        } else if (domain === 'mount') {
          mount.set(commit.state.mount);
        } else if (domain === 'selection') {
          const previousStore = itemSelectionStores.get(commit.state.selection.previousKey ?? '');
          const selectedStore = itemSelectionStores.get(commit.state.selection.selectedKey ?? '');

          if (previousStore !== undefined) {
            previousStore.set(false);
          }

          if (selectedStore !== undefined) {
            selectedStore.set(true);
          }

          selectedKey = commit.state.selection.selectedKey;
          selection.set(commit.state.selection);
        } else {
          viewport.set(commit.state.viewport);
        }
      });
    },
    chrome,
    getItemSelection(key) {
      const existing = itemSelectionStores.get(key);

      if (existing !== undefined) {
        return existing;
      }

      const store = signal(selectedKey === key);

      itemSelectionStores.set(key, store);

      return store;
    },
    items,
    mount,
    selection,
    viewport,
  };
}

export type { AngularProjectionStores };
export { createAngularProjectionStores };
