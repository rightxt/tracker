import { memo, useImperativeHandle, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { assertValidTrackerConfiguration, resolveTrackerOptions } from '@rightxt/tracker-core';

import {
  DATA_ATTRIBUTES,
  createTrackerProjectionIntegration,
  projectTrackerChromeView,
} from '@rightxt/tracker-core/projection';
import { createReactProjectionStores } from './projectionStores.js';
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
import type { CSSProperties, HTMLAttributes, ReactElement, Ref } from 'react';
import type { ReactProjectionStore, ReactProjectionStores } from './projectionStores.js';

/** Framework-native public React handle. */
interface TrackerHandle {
  /** Returns current runtime state. */
  getState: () => TrackerState;
  /** Returns current diagnostics counters. */
  getStats: () => TrackerStats;
  /** Performs an immediate refresh. */
  refresh: () => void;
  /** Resolves after this Core runtime generation is permanently destroyed. */
  whenRuntimeDestroyed: () => Promise<void>;
  /** Resets diagnostics counters. */
  resetStats: () => void;
  /** Requests a coalesced refresh. */
  requestRefresh: () => void;
}

/** Framework-native React component props. */
interface TrackerProps {
  /** Called when a marker cluster is activated. */
  onClusterActivate?: (payload: TrackerClusterActivateEventPayload) => void;
  /** Called when a marker is activated. */
  onMarkerActivate?: (payload: TrackerMarkerActivateEventPayload) => void;
  /** Called when the committed logical selection changes. */
  onSelectionChange?: (payload: TrackerSelectionChangeEventPayload) => void;
  /** Called after a Core synchronization transaction succeeds. */
  onSyncEnd?: (payload: TrackerSyncEndEventPayload) => void;
  /** Called when a Core synchronization transaction starts. */
  onSyncStart?: (payload: TrackerSyncStartEventPayload) => void;
  /** Called when the track is activated to scroll to a position. */
  onTrackActivate?: (payload: TrackerTrackActivateEventPayload) => void;
  /** Called when runtime validation or diagnostics emit a warning. */
  onWarning?: (payload: TrackerWarningEventPayload) => void;
  /** Non-rule Tracker options. */
  options?: Partial<TrackerOptions> | undefined;
  /** React 19 ref-as-prop handle. */
  ref?: Ref<TrackerHandle> | undefined;
  /** Authoritative immutable rule list. */
  rules?: readonly TrackerRule[] | undefined;
  /** Represented page or element viewport. Null keeps Core unmounted. */
  scrollRoot?: TrackerScrollRoot | null | undefined;
  /** Source query root. Null keeps Core unmounted. */
  sourceRoot?: TrackerSourceRoot | null | undefined;
}

/** Runtime and domain stores owned by one React component generation. */
interface ReactProjectionRuntime {
  /** Narrow Core integration. */
  readonly integration: TrackerProjectionIntegration;
  /** Independently observable React domains. */
  readonly stores: ReactProjectionStores;
}

/** Stable omitted-options value. */
const EMPTY_OPTIONS: Partial<TrackerOptions> = {};

/** Delivers one React callback prop without returning consumer failures to Core. */
function notifyConsumer<TPayload>(callback: ((payload: TPayload) => void) | undefined, payload: TPayload): void {
  try {
    callback?.(payload);
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
 * Runs deferred teardown without throwing outside React's lifecycle.
 *
 * @param cleanup - Deferred cleanup operation.
 */
function attemptDeferredAdapterCleanup(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    // Deferred teardown has no active React error boundary.
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

/** Converts framework-neutral attributes to React DOM props. */
function createReactAttributes(attributes: Readonly<Record<string, string>>): HTMLAttributes<HTMLDivElement> {
  const { tabindex, ...rest } = attributes;

  return {
    ...rest,
    ...(tabindex === undefined ? {} : { tabIndex: Number(tabindex) }),
  } as HTMLAttributes<HTMLDivElement>;
}

/** Converts framework-neutral CSS variables to React style props. */
function createReactStyle(styleVars: Readonly<Record<string, string>>): CSSProperties {
  return styleVars as CSSProperties;
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
    throw new TypeError('React Tracker rules must be passed through the dedicated rules prop.');
  }

  const configuration = { options, rules: rules === undefined ? [] : rules };

  assertValidTrackerConfiguration(configuration);

  return { options: { ...options }, rules: [...configuration.rules] };
}

/**
 * Creates one Tracker runtime and connects its coherent commit coordinator.
 *
 * @param configuration - Initial complete configuration.
 * @param configuration.options - Initial Tracker options.
 * @param configuration.rules - Initial Tracker rules.
 * @returns Runtime and React domain stores.
 */
function createProjectionRuntime(configuration: {
  options: Partial<TrackerOptions>;
  rules: readonly TrackerRule[];
}): ReactProjectionRuntime {
  const integration = createTrackerProjectionIntegration(configuration);
  const stores = createReactProjectionStores(integration.getProjection());

  integration.subscribeProjection(stores.applyCommit);

  return { integration, stores };
}

/** Renders one keyed item and observes only its own selected boolean. */
const TrackerProjectionItem = memo(function TrackerProjectionItemComponent({
  item,
  selection,
}: {
  item: TrackerItemView;
  selection: ReactProjectionStore<boolean>;
}): ReactElement {
  const selected = useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
  const attributes = {
    ...createReactAttributes(item.attributes),
    ...(selected ? { [DATA_ATTRIBUTES.SELECTED]: 'true' } : {}),
  };

  return <div {...attributes} className={item.className} style={createReactStyle(item.styleVars)} />;
});

/** Renders keyed structure only when the items-domain reference changes. */
const TrackerProjectionItems = memo(function TrackerProjectionItemsComponent({
  stores,
}: {
  stores: ReactProjectionStores;
}): ReactElement {
  const items = useSyncExternalStore(stores.items.subscribe, stores.items.getSnapshot, stores.items.getSnapshot);

  return (
    <>
      {items.map((item) => (
        <TrackerProjectionItem key={item.key} item={item} selection={stores.getItemSelection(item.key)} />
      ))}
    </>
  );
});

/** Renders marker-layer chrome independently from item structure. */
const TrackerProjectionMarkers = memo(function TrackerProjectionMarkersComponent({
  layer,
  stores,
}: {
  layer: TrackerElementView & { readonly hidden: boolean };
  stores: ReactProjectionStores;
}): ReactElement {
  return (
    <div
      {...createReactAttributes(layer.attributes)}
      className={layer.className}
      hidden={layer.hidden}
      style={createReactStyle(layer.styleVars)}
    >
      <TrackerProjectionItems stores={stores} />
    </div>
  );
});

/** Renders only the independently observable viewport domain. */
const TrackerProjectionViewport = memo(function TrackerProjectionViewportComponent({
  store,
}: {
  store: ReactProjectionStore<TrackerElementView & { readonly hidden: boolean }>;
}): ReactElement {
  const viewport = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return (
    <div
      {...createReactAttributes(viewport.attributes)}
      className={viewport.className}
      hidden={viewport.hidden}
      style={createReactStyle(viewport.styleVars)}
    />
  );
});

/** Renders root chrome while memoized children retain independent subscriptions. */
const TrackerProjectionTree = memo(function TrackerProjectionTreeComponent({
  options,
  renderRootRef,
  stores,
}: {
  options: TrackerReadonlyOptions;
  renderRootRef: Ref<HTMLDivElement>;
  stores: ReactProjectionStores;
}): ReactElement {
  const mount = useSyncExternalStore(stores.mount.subscribe, stores.mount.getSnapshot, stores.mount.getSnapshot);
  const chrome = projectTrackerChromeView(options, mount);
  const root = chrome.root;

  return (
    <div
      {...createReactAttributes(root.attributes)}
      className={root.className}
      ref={renderRootRef}
      style={createReactStyle(root.styleVars)}
    >
      <TrackerProjectionViewport store={stores.viewport} />
      <TrackerProjectionMarkers layer={chrome.markersLayer} stores={stores} />
    </div>
  );
});

/** Declarative React 19 Tracker backed by projection-domain external stores. */
function Tracker({
  onClusterActivate,
  onMarkerActivate,
  onSelectionChange,
  onSyncEnd,
  onSyncStart,
  onTrackActivate,
  onWarning,
  options = EMPTY_OPTIONS,
  ref,
  rules,
  scrollRoot,
  sourceRoot,
}: TrackerProps): ReactElement {
  const configuration = useMemo(() => createRuntimeConfiguration(options, rules), [options, rules]);
  const resolvedOptions = useMemo(() => resolveTrackerOptions(configuration.options), [configuration]);
  const runtimeRef = useRef<ReactProjectionRuntime | null>(null);
  const renderRootRef = useRef<HTMLDivElement | null>(null);
  const appliedRef = useRef<{
    options: Partial<TrackerOptions>;
    rules: readonly TrackerRule[] | undefined;
    scrollRoot: TrackerScrollRoot | null | undefined;
    sourceRoot: TrackerSourceRoot | null | undefined;
  } | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const callbacksRef = useRef({
    onClusterActivate,
    onMarkerActivate,
    onSelectionChange,
    onSyncEnd,
    onSyncStart,
    onTrackActivate,
    onWarning,
  });

  if (runtimeRef.current === null || runtimeRef.current.integration.isDestroyed()) {
    runtimeRef.current = createProjectionRuntime(configuration);
    appliedRef.current = { options, rules, scrollRoot: undefined, sourceRoot: undefined };
  }

  const runtime = runtimeRef.current;

  // Deferred to the commit phase: writing directly in the render body would
  // let an interrupted or discarded concurrent render leak its callback
  // props into the ref before React ever commits that render.
  useLayoutEffect(() => {
    callbacksRef.current = {
      onClusterActivate,
      onMarkerActivate,
      onSelectionChange,
      onSyncEnd,
      onSyncStart,
      onTrackActivate,
      onWarning,
    };
  });

  useImperativeHandle(
    ref,
    () => ({
      getState: runtime.integration.getState,
      getStats: runtime.integration.getStats,
      refresh: runtime.integration.render,
      requestRefresh: runtime.integration.requestRender,
      resetStats: runtime.integration.resetStats,
      whenRuntimeDestroyed: runtime.integration.whenDestroyed,
    }),
    [runtime],
  );

  useLayoutEffect(() => {
    lifecycleGenerationRef.current += 1;
    const generation = lifecycleGenerationRef.current;
    const unsubscribes: TrackerEventUnsubscribe[] = [];

    try {
      unsubscribes.push(
        runtime.integration.on('marker:activate', (payload) =>
          notifyConsumer(callbacksRef.current.onMarkerActivate, payload),
        ),
      );
      unsubscribes.push(
        runtime.integration.on('cluster:activate', (payload) =>
          notifyConsumer(callbacksRef.current.onClusterActivate, payload),
        ),
      );
      unsubscribes.push(
        runtime.integration.on('sync:start', (payload) => notifyConsumer(callbacksRef.current.onSyncStart, payload)),
      );
      unsubscribes.push(
        runtime.integration.on('sync:end', (payload) => notifyConsumer(callbacksRef.current.onSyncEnd, payload)),
      );
      unsubscribes.push(
        runtime.integration.on('selection:change', (payload) =>
          notifyConsumer(callbacksRef.current.onSelectionChange, payload),
        ),
      );
      unsubscribes.push(
        runtime.integration.on('track:activate', (payload) =>
          notifyConsumer(callbacksRef.current.onTrackActivate, payload),
        ),
      );
      unsubscribes.push(
        runtime.integration.on('warning', (payload) => notifyConsumer(callbacksRef.current.onWarning, payload)),
      );
    } catch (error) {
      const errors: unknown[] = [error];

      unsubscribes.forEach((unsubscribe) => attemptAdapterCleanup(unsubscribe, errors));
      attemptAdapterCleanup(() => runtime.integration.destroy(), errors);

      throwAdapterLifecycleErrors(errors, 'React Tracker projection setup and rollback both failed.');
    }

    return () => {
      const errors: unknown[] = [];

      attemptAdapterCleanup(() => runtime.integration.unmount(), errors);
      unsubscribes.forEach((unsubscribe) => attemptAdapterCleanup(unsubscribe, errors));

      queueMicrotask(() => {
        if (lifecycleGenerationRef.current === generation) {
          attemptDeferredAdapterCleanup(() => runtime.integration.destroy());
        }
      });

      throwAdapterLifecycleErrors(errors, 'React Tracker projection unmount failed in one or more cleanup steps.');
    };
  }, [runtime]);

  useLayoutEffect(() => {
    const applied = appliedRef.current;
    const rootsChanged =
      applied === null || !Object.is(applied.sourceRoot, sourceRoot) || !Object.is(applied.scrollRoot, scrollRoot);
    const configurationChanged =
      applied === null || !Object.is(applied.options, options) || !Object.is(applied.rules, rules);

    if (rootsChanged && runtime.integration.isMounted()) {
      runtime.integration.unmount();
    }

    if (configurationChanged) {
      runtime.integration.replaceConfiguration(configuration);

      if (runtime.integration.isMounted()) {
        runtime.integration.flushRender();
      }
    }

    if (
      (rootsChanged || !runtime.integration.isMounted()) &&
      sourceRoot !== null &&
      scrollRoot !== null &&
      renderRootRef.current !== null
    ) {
      runtime.integration.mount({
        ...(sourceRoot === undefined ? {} : { sourceRoot }),
        ...(scrollRoot === undefined ? {} : { scrollRoot }),
        renderRoot: renderRootRef.current,
      });
    }

    appliedRef.current = { options, rules, scrollRoot, sourceRoot };
  }, [configuration, options, rules, runtime, scrollRoot, sourceRoot]);

  return <TrackerProjectionTree options={resolvedOptions} renderRootRef={renderRootRef} stores={runtime.stores} />;
}

export type { TrackerHandle, TrackerProps };
export { Tracker };
