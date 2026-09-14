import type {
  TrackerConfiguration,
  TrackerConfigurationReplacement,
  TrackerEventName,
  TrackerEventUnsubscribe,
  TrackerOperationParams,
  TrackerScrollRoot,
  TrackerSnapshot,
  TrackerSnapshotListener,
  TrackerSnapshotUnsubscribe,
  TrackerSourceRoot,
  TrackerState,
  TrackerStats,
  TrackerTypedEventHandler,
} from '../types.js';
import { noop } from '../utils/function.js';
import {
  getTrackerInstanceStats,
  isTrackerInstanceDestroyed,
  isTrackerInstanceMounted,
  resetTrackerInstanceStats,
} from './accessors.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { offTrackerInstanceEvent, onTrackerInstanceEvent } from './events.js';
import { refreshTrackerInstanceFinalStats } from './instanceStats.js';
import { createTrackerIntegrationInstance } from './integration.js';
import { registerTrackerIntegration } from './integrationRegistry.js';
import {
  assertTrackerMountRequestIsValid,
  destroyTrackerInstance,
  mountTrackerInstance,
  unmountTrackerInstance,
} from './lifecycle.js';
import { assertTrackerInstanceMounted } from './lifecycleGuards.js';
import { coordinateTrackerAdapterTransaction } from './operationCoordinator.js';
import type {
  TrackerProjectionListener,
  TrackerProjectionState,
  TrackerProjectionUnsubscribe,
} from './projectionRenderer.js';
import { createTrackerProjectionRenderer } from './projectionRenderer.js';
import { renderTrackerInstanceNow, requestTrackerInstanceRender } from './rendering.js';
import { flushTrackerInstanceRender } from './scheduling.js';
import { getTrackerInstanceSnapshot, subscribeTrackerInstanceSnapshot } from './snapshotStore.js';
import {
  assertTrackerInstanceConfigurationReplacementIsValid,
  replaceTrackerInstanceConfiguration,
} from './updating.js';

/** Explicit roots for one framework-owned Projection mount generation. */
interface TrackerProjectionMountRequest {
  /** Framework-owned root receiving projected output. */
  readonly renderRoot: HTMLElement;
  /** Root queried for source elements. */
  readonly sourceRoot?: TrackerSourceRoot | undefined;
  /** Window or element whose viewport is represented. */
  readonly scrollRoot?: TrackerScrollRoot | undefined;
}

/** One adapter-owned transaction coordinated by Core's behavioral FIFO. */
interface TrackerProjectionAdapterTransaction {
  /** Diagnostic operation name. */
  readonly name: string;
  /** Transaction body, allowed to call this Projection integration's ordinary operations. */
  readonly run: () => void;
  /** Settlement hook invoked once after execution, rejection, or queue removal. */
  readonly settle?: (() => void) | undefined;
}

/** Opaque operational facade for declarative web Projection integrations. */
interface TrackerProjectionIntegration {
  /** Prevalidates a complete configuration against current Core context. */
  assertConfigurationReplacement: (
    configuration: TrackerConfigurationReplacement,
    params?: TrackerOperationParams,
  ) => void;
  /** Validates one mount request without changing lifecycle state. */
  assertMountRequest: (request: TrackerProjectionMountRequest) => void;
  /** Runs one adapter-owned transaction at Core's outer behavioral boundary. */
  coordinateAdapterTransaction: (transaction: TrackerProjectionAdapterTransaction) => void;
  /** Permanently releases the owned Core generation. */
  destroy: () => void;
  /** Returns the latest coherent projection. */
  getProjection: () => TrackerProjectionState;
  /** Immediately commits a pending narrow render target. */
  flushRender: () => void;
  /** Returns the current immutable observation snapshot. */
  getSnapshot: () => TrackerSnapshot;
  /** Returns the current lifecycle state. */
  getState: () => TrackerState;
  /** Returns current diagnostics counters. */
  getStats: () => TrackerStats;
  /** Reports whether permanent teardown completed. */
  isDestroyed: () => boolean;
  /** Reports whether roots are currently mounted. */
  isMounted: () => boolean;
  /** Mounts Core against a framework-owned render root. */
  mount: (request: TrackerProjectionMountRequest) => void;
  /** Removes a Core event handler by identity. */
  off: <TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ) => boolean;
  /** Subscribes to a Core event. */
  on: <TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ) => TrackerEventUnsubscribe;
  /** Performs an immediate complete render. */
  render: () => void;
  /** Replaces options and rules as one Core transaction. */
  replaceConfiguration: (configuration: TrackerConfigurationReplacement, params?: TrackerOperationParams) => void;
  /** Requests a coalesced complete render. */
  requestRender: () => void;
  /** Resets diagnostics counters. */
  resetStats: () => void;
  /** Subscribes to coherent projection commits. */
  subscribeProjection: (listener: TrackerProjectionListener) => TrackerProjectionUnsubscribe;
  /** Subscribes to immutable observation snapshots. */
  subscribeSnapshot: (listener: TrackerSnapshotListener) => TrackerSnapshotUnsubscribe;
  /** Reversibly releases the current roots. */
  unmount: () => void;
  /** Resolves once permanent teardown completes. */
  whenDestroyed: () => Promise<void>;
}

/**
 * Creates an opaque Projection integration facade for declarative web renderers.
 *
 * Raw Core instance and renderer identities deliberately remain private so an
 * adapter cannot bypass projection transactions or become a second authority.
 *
 * @param configuration - Initial Tracker configuration.
 * @returns Projection-based integration runtime.
 */
function createTrackerProjectionIntegration(configuration: TrackerConfiguration = {}): TrackerProjectionIntegration {
  const renderer = createTrackerProjectionRenderer();
  let instance: TrackerInstance | null = null;
  let destroyedPromise: Promise<void> | null = null;
  let resolveDestroyedPromise: (() => void) | null = null;

  instance = createTrackerIntegrationInstance(configuration, {
    getInstance: () => instance,
    renderer,
  });
  renderer.initialize(instance.rendererOptions);
  renderer.bindListenerRejectionSettlement(() => {
    refreshTrackerInstanceFinalStats(instance!);
    instance!.snapshotStore?.refresh(instance!);
  });

  const integration: TrackerProjectionIntegration = {
    assertConfigurationReplacement(nextConfiguration, params = undefined) {
      assertTrackerInstanceConfigurationReplacementIsValid(instance!, nextConfiguration, params);
    },
    assertMountRequest(request) {
      assertTrackerMountRequestIsValid(instance!, {
        sourceRoot: request.sourceRoot,
        scrollRoot: request.scrollRoot,
        rendererTarget: { kind: 'root', root: request.renderRoot },
      });
    },
    coordinateAdapterTransaction(transaction) {
      coordinateTrackerAdapterTransaction(instance!, transaction.name, transaction.run, {
        cleanup: transaction.settle,
      });
    },
    destroy() {
      destroyTrackerInstance(instance!);
    },
    getProjection() {
      return renderer.getProjection();
    },
    flushRender() {
      flushTrackerInstanceRender(instance!);
    },
    getSnapshot() {
      return getTrackerInstanceSnapshot(instance!);
    },
    getState(): TrackerState {
      if (isTrackerInstanceDestroyed(instance!)) {
        return 'destroyed';
      }

      return isTrackerInstanceMounted(instance!) ? 'mounted' : 'unmounted';
    },
    getStats() {
      return getTrackerInstanceStats(instance!);
    },
    isDestroyed() {
      return isTrackerInstanceDestroyed(instance!);
    },
    isMounted() {
      return isTrackerInstanceMounted(instance!);
    },
    mount(request) {
      mountTrackerInstance(instance!, {
        sourceRoot: request.sourceRoot,
        scrollRoot: request.scrollRoot,
        rendererTarget: { kind: 'root', root: request.renderRoot },
      });
    },
    off<TEventName extends TrackerEventName>(
      eventName: TEventName,
      handler: TrackerTypedEventHandler<TEventName>,
    ): boolean {
      return offTrackerInstanceEvent(instance!, eventName, handler);
    },
    on<TEventName extends TrackerEventName>(
      eventName: TEventName,
      handler: TrackerTypedEventHandler<TEventName>,
    ): TrackerEventUnsubscribe {
      return onTrackerInstanceEvent(instance!, eventName, handler);
    },
    render() {
      renderTrackerInstanceNow(instance!, []);
    },
    replaceConfiguration(nextConfiguration, params = undefined) {
      replaceTrackerInstanceConfiguration(instance!, nextConfiguration, params);
    },
    requestRender() {
      assertTrackerInstanceMounted(instance!, 'request a render');
      requestTrackerInstanceRender(instance!, 'all', true, { source: 'request-render' });
    },
    resetStats() {
      resetTrackerInstanceStats(instance!);
    },
    subscribeProjection(listener) {
      if (isTrackerInstanceDestroyed(instance!)) {
        return noop;
      }

      return renderer.subscribe(listener);
    },
    subscribeSnapshot(listener) {
      if (isTrackerInstanceDestroyed(instance!)) {
        return noop;
      }

      return subscribeTrackerInstanceSnapshot(instance!, listener);
    },
    unmount() {
      unmountTrackerInstance(instance!);
    },
    whenDestroyed(): Promise<void> {
      if (destroyedPromise === null) {
        if (isTrackerInstanceDestroyed(instance!)) {
          destroyedPromise = Promise.resolve();
        } else {
          destroyedPromise = new Promise<void>((resolve) => {
            resolveDestroyedPromise = resolve;
          });
          onTrackerInstanceEvent(instance!, 'destroy', () => {
            resolveDestroyedPromise?.();
            resolveDestroyedPromise = null;
          });
        }
      }

      return destroyedPromise;
    },
  };

  registerTrackerIntegration(integration, instance);

  return integration;
}

export type { TrackerProjectionIntegration, TrackerProjectionMountRequest };
export { createTrackerProjectionIntegration };
