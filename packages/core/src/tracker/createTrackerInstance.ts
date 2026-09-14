import { resolveTrackerOptions } from '../config/resolveOptions.js';
import { DebugDiagnostics } from '../diagnostics/DebugDiagnostics.js';
import { Diagnostics } from '../diagnostics/Diagnostics.js';
import { EVENT_NAME_VALUES } from '../events/eventNames.js';
import { EventEmitter } from '../events/EventEmitter.js';
import { InteractionController } from '../interaction/InteractionController.js';
import { ClusterEngine } from '../layout/ClusterEngine.js';
import { LayoutEngine } from '../layout/LayoutEngine.js';
import { MarkerStore } from '../markers/MarkerStore.js';
import { ObserverController } from '../observe/ObserverController.js';
import { QueryEngine } from '../query/QueryEngine.js';
import { RuleStore } from '../rules/RuleStore.js';
import { RenderScheduler } from '../schedule/RenderScheduler.js';
import type {
  TrackerConfiguration,
  TrackerDiagnosticCode,
  TrackerReadonlyOptions,
  TrackerRenderRecord,
  TrackerRenderTarget,
  TrackerRendererLike,
  TrackerResolvedOptions,
  TrackerSnapshotStore,
  TrackerStats,
} from '../types.js';
import { cloneValue, deepFreeze, isPlainObject } from '../utils/object.js';
import { TrackerConfigurationError } from '../errors.js';
import { createSchedulerProxy, getObservableTrackerRoot, getTrackerSourceRoot } from './instanceContext.js';
import { refreshTrackerInstanceFinalStats } from './instanceStats.js';
import type { TrackerLifecycleCallbacks } from './lifecycleCallbacks.js';
import { normalizeTrackerLifecycleCallbacks } from './lifecycleCallbacks.js';
import type { TrackerRuntimeContext } from './mountContext.js';
import { createTrackerOperationCoordinator, runTrackerPublicDispatch } from './operationCoordinator.js';
import type { TrackerLifecycleState, TrackerOperationCoordinator } from './operationCoordinator.js';
import { normalizeTrackerRenderer } from './renderer.js';
import type { InternalTrackerRenderer } from './renderer.js';
import { createTrackerSnapshotStore, emitTrackerInstanceSnapshot } from './snapshotStore.js';
import { coordinateTrackerSelectionRequest } from './selection.js';

/** Compile-time flag selecting debug diagnostics in core bundles. */
declare const __RXT_TRACKER_DEBUG__: boolean | undefined;

/** One idempotently consumed mount-cycle cleanup action. */
interface TrackerCleanupRecord {
  /** Diagnostic cleanup name. */
  name: string;
  /** Cleanup operation. */
  run: () => void;
}

/** Internal core instance context shared across all tracker subsystems. */
interface TrackerInstance {
  /** Event emitter. */
  events: EventEmitter;
  /** Diagnostics layer. */
  diagnostics: Diagnostics | DebugDiagnostics;
  /** Current validated options. */
  options: TrackerResolvedOptions;
  /**
   * Frozen renderer-facing snapshot of {@link options}.
   *
   * A custom renderer must never receive the live, mutable `options` object:
   * this is a separate, deeply-frozen copy created once per successfully
   * committed options version and reused as the same reference across every
   * renderer call until the next successful update, so mutation attempts by
   * a misbehaving renderer — including attempts to mutate nested option
   * branches such as `marker` or `clustering` — cannot corrupt Core's
   * internal state.
   */
  rendererOptions: TrackerReadonlyOptions;
  /** Rule storage. */
  ruleStore: RuleStore;
  /** Query engine. */
  queryEngine: QueryEngine;
  /** Marker record storage. */
  markerStore: MarkerStore;
  /** Layout engine. */
  layoutEngine: LayoutEngine;
  /** Cluster engine. */
  clusterEngine: ClusterEngine;
  /** Lifecycle callbacks. */
  lifecycleCallbacks: TrackerLifecycleCallbacks;
  /** Renderer implementation. */
  renderer: InternalTrackerRenderer;
  /** Render scheduler. */
  scheduler: RenderScheduler;
  /** Observer controller. */
  observerController: ObserverController;
  /** Interaction controller. */
  interactionController: InteractionController;
  /** Committed mounted runtime identities. */
  runtimeContext: TrackerRuntimeContext | null;
  /** Provisional runtime identities visible only during atomic mount. */
  stagedRuntimeContext: TrackerRuntimeContext | null;
  /** Last render records indexed by DOM key. */
  renderRecordByKey: Map<string, TrackerRenderRecord>;
  /** Mount-time validated rules not yet installed in the public RuleStore. */
  stagedRules: import('../types.js').TrackerNormalizedRule[] | null;
  /** Last render records. */
  renderRecords: TrackerRenderRecord[];
  /** Snapshot subscription store. */
  snapshotStore: TrackerSnapshotStore | null;
  /** Internal lifecycle state. */
  lifecycleState: TrackerLifecycleState;
  /** Enclosing-operation and public-dispatch coordinator. */
  operationCoordinator: TrackerOperationCoordinator;
  /** Per-mount cleanup actions in acquisition order. */
  mountCleanupStack: TrackerCleanupRecord[];
  /** Deferred render target. */
  dirtyRenderTarget: TrackerRenderTarget | null;
  /** Last stats snapshot retained after destroy. */
  finalStats: TrackerStats | null;
  /** Mounted state. */
  mounted: boolean;
  /** Destroyed state. */
  destroyed: boolean;
  /** Whether a mounted element root dynamically left the geometry profile. */
  geometrySuspended: boolean;
  /** Root attributes owned temporarily by the current mount cycle. */
  rootAttributeSnapshot: Map<string, string | null> | null;
}

type TrackerInstanceCallbacks = Partial<TrackerLifecycleCallbacks> & {
  renderer?: TrackerRendererLike;
};

/**
 * Creates the frozen renderer-facing snapshot of a committed options object.
 *
 * Core reuses the returned reference for every renderer call until the next
 * successfully committed options update; it is not re-created per render.
 * The snapshot is cloned before freezing so nested option branches do not
 * share identity with the live `instance.options` object.
 *
 * @param options - Newly committed options.
 * @returns Deeply-frozen copy safe to expose to external renderers.
 */
function freezeRendererOptions(options: TrackerResolvedOptions): TrackerReadonlyOptions {
  const output = options.diagnostics.output;
  const rendererOptions = cloneValue(options);

  rendererOptions.diagnostics = {
    warnings: rendererOptions.diagnostics.warnings,
    metrics: rendererOptions.diagnostics.metrics,
    ...(output === undefined ? {} : { output }),
  };

  Object.entries(rendererOptions).forEach(([key, value]) => {
    if (key !== 'diagnostics') {
      deepFreeze(value);
    }
  });
  Object.entries(rendererOptions.diagnostics).forEach(([key, value]) => {
    if (key !== 'output') {
      deepFreeze(value);
    }
  });
  Object.freeze(rendererOptions.diagnostics);

  return Object.freeze(rendererOptions);
}

/**
 * Creates the internal Tracker instance context.
 *
 * The returned object is intentionally framework-neutral: framework adapters can
 * later bind their own lifecycle functions around the same subsystems without
 * going through the public Tracker facade.
 *
 * @param inputConfiguration - Tracker configuration.
 * @param inputCallbacks - Facade callbacks.
 * @returns Internal instance context.
 */
function createTrackerInstance(
  inputConfiguration: TrackerConfiguration = {},
  inputCallbacks: TrackerInstanceCallbacks = {},
): TrackerInstance {
  if (!isPlainObject(inputConfiguration)) {
    throw new TypeError('Tracker configuration must be a plain object.');
  }

  const unknownConfigurationKeys = Object.keys(inputConfiguration).filter(
    (key) => key !== 'options' && key !== 'rules',
  );

  if (unknownConfigurationKeys.length > 0) {
    throw new TrackerConfigurationError(`Unknown Tracker configuration key "${unknownConfigurationKeys[0]}".`, {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const hasOwnConfigurationOptions = Object.hasOwn(inputConfiguration, 'options');
  const hasOwnConfigurationRules = Object.hasOwn(inputConfiguration, 'rules');

  if (
    (hasOwnConfigurationOptions && inputConfiguration.options === undefined) ||
    (hasOwnConfigurationRules && inputConfiguration.rules === undefined)
  ) {
    throw new TrackerConfigurationError('Tracker configuration "options" and "rules" must not be undefined.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const inputOptions = hasOwnConfigurationOptions ? inputConfiguration.options : {};
  const inputRules = hasOwnConfigurationRules ? inputConfiguration.rules : [];

  if (!isPlainObject(inputOptions) || !Array.isArray(inputRules)) {
    throw new TrackerConfigurationError('Tracker configuration options must be an object and rules must be an array.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const normalizedInputCallbacks = inputCallbacks !== null && typeof inputCallbacks === 'object' ? inputCallbacks : {};
  const callbacks = normalizeTrackerLifecycleCallbacks(normalizedInputCallbacks);
  let diagnostics: Diagnostics | DebugDiagnostics | null = null;
  let instanceReference: TrackerInstance | null = null;
  const operationCoordinator = createTrackerOperationCoordinator();

  const events = new EventEmitter({
    eventNames: EVENT_NAME_VALUES,
    onHandlerError: (error: Error, details: Record<string, unknown>) => {
      diagnostics?.error?.('integration-event-handler-error', 'Tracker integration event handler failed.', {
        error,
        ...details,
      });

      if (instanceReference !== null) {
        refreshTrackerInstanceFinalStats(instanceReference);
        instanceReference.snapshotStore?.refresh(instanceReference);
      }
    },
    runPublicDispatch: (dispatch) => {
      if (instanceReference === null) {
        dispatch();
        return;
      }

      runTrackerPublicDispatch(instanceReference, dispatch);
    },
  });

  const options = resolveTrackerOptions(inputOptions);
  const diagnosticsOptions = options.diagnostics;

  diagnostics =
    typeof __RXT_TRACKER_DEBUG__ !== 'undefined' && __RXT_TRACKER_DEBUG__ === true
      ? new DebugDiagnostics({
          events,
          options: diagnosticsOptions,
        })
      : new Diagnostics({
          events,
          options: diagnosticsOptions,
        });

  const ruleStore = new RuleStore({
    diagnostics,
    selectorRoot: null,
  });

  ruleStore.replace(inputRules);

  const queryEngine = new QueryEngine({
    diagnostics,
  });
  const markerStore = new MarkerStore({
    diagnostics,
  });
  const layoutEngine = new LayoutEngine();
  const clusterEngine = new ClusterEngine({
    diagnostics,
  });
  /** Keeps renderer-originated diagnostics aligned with instance snapshots. */
  const rendererDiagnostics = {
    error: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>): void => {
      diagnostics?.error?.(code, message, details);
    },
    warn: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>): void => {
      diagnostics?.warn?.(code, message, details);

      if (code === 'renderer-hook-returned-thenable' && instanceReference !== null) {
        refreshTrackerInstanceFinalStats(instanceReference);
        instanceReference.snapshotStore?.refresh(instanceReference);
      }
    },
  };
  const renderer = normalizeTrackerRenderer(
    normalizedInputCallbacks.renderer,
    rendererDiagnostics,
  ) as InternalTrackerRenderer;

  renderer.updateContext({
    diagnostics,
    document: null,
    window: null,
    scrollMode: null,
  });
  const scheduler = new RenderScheduler({
    diagnostics,
    render: callbacks.render,
    onAsyncSettled: () => {
      if (instanceReference !== null && !instanceReference.destroyed) {
        emitTrackerInstanceSnapshot(instanceReference);
      }
    },
  });
  const observerController = new ObserverController({
    scheduler: createSchedulerProxy(callbacks),
    diagnostics,
    getRoot: () => getObservableTrackerRoot(renderer),
  });
  const interactionController = new InteractionController({
    events,
    diagnostics,
    getRenderRecordByKey: callbacks.getRenderRecordByKey,
    getRenderRecords: callbacks.getRenderRecords,
    getFallbackRoot: () => renderer.root,
    canHandleKeyboardEvent: () => instanceReference?.lifecycleState === 'mounted',
    onSelectionRequest: (request) => {
      if (instanceReference !== null) {
        coordinateTrackerSelectionRequest(instanceReference, request);
      }
    },
  });

  const instance: TrackerInstance = {
    events,
    diagnostics,
    options,
    rendererOptions: freezeRendererOptions(options),
    ruleStore,
    queryEngine,
    markerStore,
    layoutEngine,
    clusterEngine,
    lifecycleCallbacks: callbacks,
    renderer,
    scheduler,
    observerController,
    interactionController,
    runtimeContext: null,
    stagedRuntimeContext: null,
    renderRecordByKey: new Map(),
    stagedRules: null,
    renderRecords: [],
    snapshotStore: null,
    lifecycleState: 'unmounted',
    operationCoordinator,
    mountCleanupStack: [],
    dirtyRenderTarget: null,
    finalStats: null,
    mounted: false,
    destroyed: false,
    geometrySuspended: false,
    rootAttributeSnapshot: null,
  };

  instanceReference = instance;

  instance.snapshotStore = createTrackerSnapshotStore(instance);

  // The source root scopes selector search; outside an active mount the
  // provider yields no root and queries resolve to no matches.
  queryEngine.updateContext({
    getRoot: () => getTrackerSourceRoot(instance),
  });

  return instance;
}

export { createTrackerInstance, freezeRendererOptions };
export type { TrackerCleanupRecord, TrackerInstance, TrackerInstanceCallbacks };
