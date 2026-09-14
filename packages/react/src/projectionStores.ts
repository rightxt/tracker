import type {
  TrackerChromeView,
  TrackerItemView,
  TrackerMountView,
  TrackerProjectionCommit,
  TrackerProjectionState,
  TrackerSelectionView,
  TrackerViewportView,
} from '@rightxt/tracker-core/projection';

/** Minimal external-store contract consumed by React. */
interface ReactProjectionStore<TValue> {
  /** Returns the current immutable domain value. */
  getSnapshot: () => TValue;
  /** Subscribes to domain-reference changes. */
  subscribe: (listener: () => void) => () => void;
}

/** Mutable owner used only by the projection commit coordinator. */
interface MutableReactProjectionStore<TValue> extends ReactProjectionStore<TValue> {
  /** Notifies listeners after a coherent multi-domain commit is staged. */
  notify: () => void;
  /** Replaces the domain reference without notifying listeners. */
  replace: (value: TValue) => boolean;
}

/** Independent stores used by the React projection integration. */
interface ReactProjectionStores {
  /** Root and marker-layer presentation. */
  readonly chrome: ReactProjectionStore<TrackerChromeView>;
  /** Ordered keyed item views. */
  readonly items: ReactProjectionStore<readonly TrackerItemView[]>;
  /** Mount generation and geometry state. */
  readonly mount: ReactProjectionStore<TrackerMountView>;
  /** Isolated selected-key transition. */
  readonly selection: ReactProjectionStore<TrackerSelectionView>;
  /** Independent viewport presentation. */
  readonly viewport: ReactProjectionStore<TrackerViewportView>;
  /** Applies one coherent Core projection commit. */
  applyCommit: (commit: TrackerProjectionCommit) => void;
  /** Returns an isolated boolean store for one keyed item's selected state. */
  getItemSelection: (key: string) => ReactProjectionStore<boolean>;
}

/**
 * Creates one referential external store without framework dependencies.
 *
 * @param initialValue - Initial immutable domain value.
 * @returns Mutable store retained privately by the commit coordinator.
 */
function createReactProjectionStore<TValue>(initialValue: TValue): MutableReactProjectionStore<TValue> {
  let value = initialValue;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => value,
    notify() {
      [...listeners].forEach((listener) => listener());
    },
    replace(nextValue) {
      if (Object.is(value, nextValue)) {
        return false;
      }

      value = nextValue;

      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      let active = true;

      return () => {
        if (!active) {
          return;
        }

        active = false;
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Splits coherent Core commits into independently observable React domains.
 *
 * @param initialState - Initial coherent projection state.
 * @returns Domain stores and their generation-aware commit coordinator.
 */
function createReactProjectionStores(initialState: TrackerProjectionState): ReactProjectionStores {
  const chrome = createReactProjectionStore(initialState.chrome);
  const items = createReactProjectionStore(initialState.items);
  const mount = createReactProjectionStore(initialState.mount);
  const selection = createReactProjectionStore(initialState.selection);
  const viewport = createReactProjectionStore(initialState.viewport);
  const itemSelectionStores = new Map<string, MutableReactProjectionStore<boolean>>();
  let generation = initialState.generation;
  let revision = initialState.revision;

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
      const changedStores = new Set<MutableReactProjectionStore<unknown>>();

      /**
       * Retains a store for notification when its reference changed.
       *
       * @param store - Mutable domain store.
       * @param value - Next immutable domain value.
       */
      const replace = <TValue>(store: MutableReactProjectionStore<TValue>, value: TValue): void => {
        if (store.replace(value)) {
          changedStores.add(store as MutableReactProjectionStore<unknown>);
        }
      };

      commit.changed.forEach((domain) => {
        if (domain === 'chrome') {
          replace(chrome, commit.state.chrome);
        } else if (domain === 'items') {
          replace(items, commit.state.items);
          const activeKeys = new Set(commit.state.items.map((item) => item.key));

          itemSelectionStores.forEach((_store, key) => {
            if (!activeKeys.has(key)) {
              itemSelectionStores.delete(key);
            }
          });
        } else if (domain === 'mount') {
          replace(mount, commit.state.mount);
        } else if (domain === 'selection') {
          const previousStore = itemSelectionStores.get(commit.state.selection.previousKey ?? '');
          const selectedStore = itemSelectionStores.get(commit.state.selection.selectedKey ?? '');

          if (previousStore !== undefined) {
            replace(previousStore, false);
          }

          if (selectedStore !== undefined) {
            replace(selectedStore, true);
          }

          replace(selection, commit.state.selection);
        } else {
          replace(viewport, commit.state.viewport);
        }
      });

      changedStores.forEach((store) => store.notify());
    },
    chrome,
    getItemSelection(key) {
      const existing = itemSelectionStores.get(key);

      if (existing !== undefined) {
        return existing;
      }

      const store = createReactProjectionStore(selection.getSnapshot().selectedKey === key);

      itemSelectionStores.set(key, store);

      return store;
    },
    items,
    mount,
    selection,
    viewport,
  };
}

export type { ReactProjectionStore, ReactProjectionStores };
export { createReactProjectionStores };
