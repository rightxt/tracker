import { Fragment, defineComponent, h, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

import { assertValidTrackerConfiguration, resolveTrackerOptions } from '@rightxt/tracker-core';

import {
  DATA_ATTRIBUTES,
  createTrackerProjectionIntegration,
  projectTrackerChromeView,
} from '@rightxt/tracker-core/projection';
import { createVueProjectionStores } from './projectionStores.js';
import { reportHostError } from './reportHostError.js';

import type {
  TrackerClusterActivateEventPayload,
  TrackerEventUnsubscribe,
  TrackerMarkerActivateEventPayload,
  TrackerOptions,
  TrackerReadonlyOptions,
  TrackerRule,
  TrackerScrollRoot,
  TrackerSelectionChangeEventPayload,
  TrackerSourceRoot,
  TrackerState,
  TrackerStats,
  TrackerSyncEndEventPayload,
  TrackerSyncStartEventPayload,
  TrackerTrackActivateEventPayload,
  TrackerWarningEventPayload,
} from '@rightxt/tracker-core';
import type {
  TrackerElementView,
  TrackerItemView,
  TrackerProjectionIntegration,
} from '@rightxt/tracker-core/projection';
import type { PropType, ShallowRef, VNode } from 'vue';
import type { VueProjectionStores } from './projectionStores.js';

/** Framework-native public Vue handle. */
interface TrackerHandle {
  /** Returns current runtime state. */
  getState: () => TrackerState;
  /** Returns current diagnostics counters. */
  getStats: () => TrackerStats;
  /** Performs an immediate refresh. */
  refresh: () => void;
  /** Requests a coalesced refresh. */
  requestRefresh: () => void;
  /** Resets diagnostics counters. */
  resetStats: () => void;
  /** Resolves after this Core runtime generation is permanently destroyed. */
  whenRuntimeDestroyed: () => Promise<void>;
}

/** Framework-native Vue component props. */
interface TrackerProps {
  /** Non-rule Tracker options. */
  options?: Partial<TrackerOptions> | undefined;
  /** Authoritative immutable rule list. */
  rules?: readonly TrackerRule[] | undefined;
  /** Represented page or element viewport. Null keeps Core unmounted. */
  scrollRoot?: TrackerScrollRoot | null | undefined;
  /** Source query root. Null keeps Core unmounted. */
  sourceRoot?: TrackerSourceRoot | null | undefined;
}

/** Runtime and domain stores owned by one Vue component generation. */
interface VueProjectionRuntime {
  /** Narrow Core integration. */
  readonly integration: TrackerProjectionIntegration;
  /** Independently reactive Vue domains. */
  readonly stores: VueProjectionStores;
}

/** Vue prop definitions for the Tracker component. */
const TRACKER_PROPS = {
  options: {
    default: () => ({}),
    type: Object as PropType<Partial<TrackerOptions> | undefined>,
  },
  rules: {
    default: undefined,
    type: Array as PropType<readonly TrackerRule[] | undefined>,
  },
  scrollRoot: {
    default: undefined,
    type: Object as PropType<TrackerScrollRoot | null | undefined>,
  },
  sourceRoot: {
    default: undefined,
    type: Object as PropType<TrackerSourceRoot | null | undefined>,
  },
} as const;

/** Vue event validators and public event names. */
const TRACKER_EMITS = {
  'cluster-activate': (_payload: TrackerClusterActivateEventPayload): boolean => true,
  'marker-activate': (_payload: TrackerMarkerActivateEventPayload): boolean => true,
  'selection-change': (_payload: TrackerSelectionChangeEventPayload): boolean => true,
  'sync-end': (_payload: TrackerSyncEndEventPayload): boolean => true,
  'sync-start': (_payload: TrackerSyncStartEventPayload): boolean => true,
  'track-activate': (_payload: TrackerTrackActivateEventPayload): boolean => true,
  warning: (_payload: TrackerWarningEventPayload): boolean => true,
} as const;

/** Delivers one Vue component event without returning a framework rethrow to Core. */
function notifyConsumer(notify: () => void): void {
  try {
    notify();
  } catch (error) {
    reportHostError(error);
  }
}

/**
 * Runs one adapter-owned cleanup without suppressing subsequent cleanup.
 *
 * @param cleanup - Cleanup operation.
 * @param errors - Mutable error collection.
 */
function attemptAdapterCleanup(cleanup: () => void, errors: unknown[]): void {
  try {
    cleanup();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Throws one lifecycle error directly or combines multiple failures.
 *
 * @param errors - Ordered lifecycle errors.
 * @param message - Aggregate error message.
 */
function throwAdapterLifecycleErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, message);
  }
}

/**
 * Creates and validates an immutable complete configuration.
 *
 * @param options - Tracker options.
 * @param rules - Tracker rules.
 * @returns Validated detached configuration.
 */
function createRuntimeConfiguration(
  options: Partial<TrackerOptions>,
  rules: readonly TrackerRule[] | undefined,
): { options: Partial<TrackerOptions>; rules: readonly TrackerRule[] } {
  if (options !== null && typeof options === 'object' && Object.hasOwn(options, 'rules')) {
    throw new TypeError('Vue Tracker rules must be passed through the dedicated rules prop.');
  }

  const configuration = { options, rules: rules === undefined ? [] : rules };

  assertValidTrackerConfiguration(configuration);

  return { options: { ...options }, rules: [...configuration.rules] };
}

/**
 * Creates one Tracker runtime and connects its domain commit coordinator.
 *
 * @param configuration - Initial complete configuration.
 * @param configuration.options - Initial Tracker options.
 * @param configuration.rules - Initial Tracker rules.
 * @returns Runtime and Vue domain stores.
 */
function createProjectionRuntime(configuration: {
  options: Partial<TrackerOptions>;
  rules: readonly TrackerRule[];
}): VueProjectionRuntime {
  const integration = createTrackerProjectionIntegration(configuration);
  const stores = createVueProjectionStores(integration.getProjection());

  integration.subscribeProjection(stores.applyCommit);

  return { integration, stores };
}

/**
 * Builds one item element VNode directly, without a dedicated per-item component instance.
 *
 * The `ref` callback resolves the initial `data-rxtt-selected` state via `resolveSelectedKey`, which
 * must read a plain (non-reactive) variable rather than a ref's `.value`. Vue invokes element `ref`
 * callbacks synchronously from within `patch()`, i.e. still inside the owning component's render
 * effect — reading a reactive `.value` there would register it as a dependency and defeat the point
 * of this component (re-rendering on every selection change). Ongoing selection changes are instead
 * applied imperatively by one shared `watch(stores.selection, ...)` in the caller, which also keeps
 * that same plain variable in sync.
 *
 * @param item - Renderer-ready view for this item.
 * @param elementsByKey - Registry of currently-mounted item elements, keyed by record key.
 * @param resolveSelectedKey - Returns the currently selected key without tracking it reactively.
 * @returns Keyed item VNode.
 */
function createTrackerProjectionItemVNode(
  item: TrackerItemView,
  elementsByKey: Map<string, HTMLElement>,
  resolveSelectedKey: () => string | null,
): VNode {
  return h('div', {
    ...item.attributes,
    class: item.className,
    key: item.key,
    ref: (element) => {
      if (!(element instanceof HTMLElement)) {
        elementsByKey.delete(item.key);
        return;
      }

      elementsByKey.set(item.key, element);

      if (resolveSelectedKey() === item.key) {
        element.setAttribute(DATA_ATTRIBUTES.SELECTED, 'true');
      }
    },
    style: item.styleVars,
  });
}

/**
 * Renders keyed item elements inline (no per-item component instances) and keeps selection
 * updates isolated through one shared element registry and a single selection watcher.
 */
const TrackerProjectionItems = defineComponent({
  name: 'RxtTrackerProjectionItems',
  props: {
    stores: { required: true, type: Object as PropType<VueProjectionStores> },
  },
  setup(props) {
    const elementsByKey = new Map<string, HTMLElement>();
    let selectedKey = props.stores.selection.value.selectedKey;

    watch(props.stores.selection, (view) => {
      selectedKey = view.selectedKey;

      if (view.previousKey !== null) {
        elementsByKey.get(view.previousKey)?.removeAttribute(DATA_ATTRIBUTES.SELECTED);
      }

      if (view.selectedKey !== null) {
        elementsByKey.get(view.selectedKey)?.setAttribute(DATA_ATTRIBUTES.SELECTED, 'true');
      }
    });

    return (): VNode =>
      h(
        Fragment,
        null,
        props.stores.items.value.map((item) =>
          createTrackerProjectionItemVNode(item, elementsByKey, () => selectedKey),
        ),
      );
  },
});

/** Renders the independent viewport domain. */
const TrackerProjectionViewport = defineComponent({
  name: 'RxtTrackerProjectionViewport',
  props: {
    viewport: {
      required: true,
      type: Object as PropType<ShallowRef<TrackerElementView & { readonly hidden: boolean }>>,
    },
  },
  setup(props) {
    return (): VNode => {
      const viewport = props.viewport.value;

      return h('div', {
        ...viewport.attributes,
        class: viewport.className,
        hidden: viewport.hidden,
        style: viewport.styleVars,
      });
    };
  },
});

/** Declarative Vue 3.5 Tracker with inline item VNodes and one shared selection watcher. */
const Tracker = defineComponent({
  name: 'RxtTracker',
  inheritAttrs: false,
  props: TRACKER_PROPS,
  emits: TRACKER_EMITS,
  setup(props, { emit, expose }) {
    const initialConfiguration = createRuntimeConfiguration(props.options, props.rules);
    const runtime = createProjectionRuntime(initialConfiguration);
    const renderRoot = shallowRef<HTMLElement | null>(null);
    let eventUnsubscribes: TrackerEventUnsubscribe[] = [];
    let appliedOptions = props.options;
    let appliedRules = props.rules;
    let appliedScrollRoot = props.scrollRoot;
    let appliedSourceRoot = props.sourceRoot;

    expose({
      getState: runtime.integration.getState,
      getStats: runtime.integration.getStats,
      refresh: runtime.integration.render,
      requestRefresh: runtime.integration.requestRender,
      resetStats: runtime.integration.resetStats,
      whenRuntimeDestroyed: runtime.integration.whenDestroyed,
    } satisfies TrackerHandle);

    watch(
      [() => props.options, () => props.rules, () => props.sourceRoot, () => props.scrollRoot] as const,
      ([options, rules, sourceRoot, scrollRoot]) => {
        const rootsChanged = !Object.is(sourceRoot, appliedSourceRoot) || !Object.is(scrollRoot, appliedScrollRoot);
        const configurationChanged = !Object.is(options, appliedOptions) || !Object.is(rules, appliedRules);
        const configuration = configurationChanged ? createRuntimeConfiguration(options, rules) : null;

        if (rootsChanged && runtime.integration.isMounted()) {
          runtime.integration.unmount();
        }

        if (configuration !== null) {
          runtime.integration.replaceConfiguration(configuration);
          // Checkpoint immediately: replaceConfiguration() already committed, independent of
          // whether the mount attempt below (for a root change bundled into the same update)
          // subsequently succeeds or throws.
          appliedOptions = options;
          appliedRules = rules;

          if (runtime.integration.isMounted()) {
            runtime.integration.flushRender();
          }
        }

        if (rootsChanged || !runtime.integration.isMounted()) {
          if (sourceRoot !== null && scrollRoot !== null && renderRoot.value !== null) {
            runtime.integration.mount({
              ...(sourceRoot === undefined ? {} : { sourceRoot }),
              ...(scrollRoot === undefined ? {} : { scrollRoot }),
              renderRoot: renderRoot.value,
            });
          }

          // Reached only when mount() above either succeeded or was intentionally skipped
          // (null roots); a thrown mount leaves this reflecting the roots of the last
          // actually-mounted generation instead of the rejected candidate.
          appliedScrollRoot = scrollRoot;
          appliedSourceRoot = sourceRoot;
        }
      },
      { flush: 'post' },
    );

    onMounted(() => {
      eventUnsubscribes.push(
        runtime.integration.on('marker:activate', (payload) => notifyConsumer(() => emit('marker-activate', payload))),
      );
      eventUnsubscribes.push(
        runtime.integration.on('cluster:activate', (payload) =>
          notifyConsumer(() => emit('cluster-activate', payload)),
        ),
      );
      eventUnsubscribes.push(
        runtime.integration.on('sync:start', (payload) => notifyConsumer(() => emit('sync-start', payload))),
      );
      eventUnsubscribes.push(
        runtime.integration.on('sync:end', (payload) => notifyConsumer(() => emit('sync-end', payload))),
      );
      eventUnsubscribes.push(
        runtime.integration.on('selection:change', (payload) =>
          notifyConsumer(() => emit('selection-change', payload)),
        ),
      );
      eventUnsubscribes.push(
        runtime.integration.on('track:activate', (payload) => notifyConsumer(() => emit('track-activate', payload))),
      );
      eventUnsubscribes.push(
        runtime.integration.on('warning', (payload) => notifyConsumer(() => emit('warning', payload))),
      );

      // A failed initial mount leaves Core's own runtime rolled back to a live
      // `unmounted` state (see `mountTrackerInstance()`), not destroyed. Keep the
      // runtime and its event bridges intact — rather than destroying them here —
      // so the `watch()` above can recover the same generation once the caller
      // corrects `sourceRoot`/`scrollRoot`. Full destruction stays reserved for
      // genuine teardown in `onBeforeUnmount()`.
      if (props.sourceRoot !== null && props.scrollRoot !== null && renderRoot.value !== null) {
        runtime.integration.mount({
          ...(props.sourceRoot === undefined ? {} : { sourceRoot: props.sourceRoot }),
          ...(props.scrollRoot === undefined ? {} : { scrollRoot: props.scrollRoot }),
          renderRoot: renderRoot.value,
        });
      }
    });

    onBeforeUnmount(() => {
      const errors: unknown[] = [];

      eventUnsubscribes.forEach((unsubscribe) => attemptAdapterCleanup(unsubscribe, errors));
      eventUnsubscribes = [];
      attemptAdapterCleanup(() => runtime.integration.destroy(), errors);

      throwAdapterLifecycleErrors(errors, 'Vue Tracker projection destruction failed in one or more cleanup steps.');
    });

    return (): VNode => {
      const options: TrackerReadonlyOptions = resolveTrackerOptions(props.options);

      const chrome = projectTrackerChromeView(options, runtime.stores.mount.value);
      const root = chrome.root;

      return h('div', { ...root.attributes, class: root.className, ref: renderRoot, style: root.styleVars }, [
        h(TrackerProjectionViewport, { viewport: runtime.stores.viewport }),
        h(
          'div',
          {
            ...chrome.markersLayer.attributes,
            class: chrome.markersLayer.className,
            hidden: chrome.markersLayer.hidden,
            style: chrome.markersLayer.styleVars,
          },
          [h(TrackerProjectionItems, { stores: runtime.stores })],
        ),
      ]);
    };
  },
});

export type { TrackerHandle, TrackerProps };
export { Tracker };
