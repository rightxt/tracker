import type {
  TrackerConfiguration,
  TrackerEventName,
  TrackerEventUnsubscribe,
  TrackerSnapshot,
  TrackerSnapshotListener,
  TrackerSnapshotUnsubscribe,
  TrackerState,
  TrackerStats,
  TrackerTypedEventHandler,
} from '../../types.js';
import type { TrackerSnapshotProps, TrackerTestRuntime } from './types.js';
import type { TrackerInstance } from '../../tracker/createTrackerInstance.js';
import { noop } from '../../utils/function.js';
import {
  getTrackerInstanceOptions,
  getTrackerInstanceRoot,
  getTrackerInstanceRules,
  getTrackerInstanceStats,
  isTrackerInstanceDestroyed,
  isTrackerInstanceMounted,
  resetTrackerInstanceStats,
} from '../../tracker/accessors.js';
import { offTrackerInstanceEvent, onTrackerInstanceEvent } from '../../tracker/events.js';
import { activateTrackerInstanceRenderRecord } from '../../tracker/interaction.js';
import { createTrackerIntegrationInstance } from '../../tracker/integration.js';
import { destroyTrackerInstance, mountTrackerInstance, unmountTrackerInstance } from '../../tracker/lifecycle.js';
import { assertTrackerInstanceMounted } from '../../tracker/lifecycleGuards.js';
import { renderTrackerInstanceNow, requestTrackerInstanceRender } from '../../tracker/rendering.js';
import {
  addTrackerInstanceRule,
  removeTrackerInstanceRuleByIndex,
  removeTrackerInstanceRuleBySelector,
  replaceTrackerInstanceRules,
} from '../../tracker/rules.js';
import { createTrackerSnapshotProps } from './snapshotProps.js';
import {
  emitTrackerInstanceSnapshot,
  getTrackerInstanceSnapshot,
  subscribeTrackerInstanceSnapshot,
} from '../../tracker/snapshotStore.js';
import { createTrackerStateRenderer } from './stateRenderer.js';
import {
  patchTrackerInstanceOptions,
  replaceTrackerInstanceConfiguration,
  replaceTrackerInstanceOptions,
} from '../../tracker/updating.js';

/** Test-only bridge for delegated root activation behavior. */
function activateFromEvent(instance: TrackerInstance, sourceEvent: PointerEvent | MouseEvent): boolean {
  if (instance.destroyed) {
    return false;
  }

  const diagnosticsRevision = instance.diagnostics.revision;
  const activated = instance.interactionController.activateFromEvent(sourceEvent);

  if (!activated || instance.diagnostics.revision !== diagnosticsRevision) {
    emitTrackerInstanceSnapshot(instance);
  }

  return activated;
}

/** Test-only bridge for explicit track-controller coverage. */
function activateTrack(instance: TrackerInstance, sourceEvent: PointerEvent | MouseEvent): boolean {
  if (instance.destroyed) {
    return false;
  }

  const diagnosticsRevision = instance.diagnostics.revision;
  const activated = instance.interactionController.activateTrack(sourceEvent);

  if (!activated || instance.diagnostics.revision !== diagnosticsRevision) {
    emitTrackerInstanceSnapshot(instance);
  }

  return activated;
}

/** Test-only bridge for keyboard-controller coverage. */
function handleKeyboardEvent(instance: TrackerInstance, sourceEvent: KeyboardEvent): boolean {
  if (instance.destroyed) {
    return false;
  }

  const diagnosticsRevision = instance.diagnostics.revision;
  const handled = instance.interactionController.handleKeyboardEvent(sourceEvent);

  if (instance.diagnostics.revision !== diagnosticsRevision) {
    emitTrackerInstanceSnapshot(instance);
  }

  return handled;
}

/**
 * Creates a state-based Tracker integration for declarative framework adapters.
 *
 * The returned renderer is owned by the framework package. It binds core to a
 * framework-owned root element while the framework renders UI from snapshots.
 *
 * @param configuration - Tracker configuration.
 * @returns State integration runtime.
 */
function createTrackerStateIntegration(configuration: TrackerConfiguration = {}): TrackerTestRuntime {
  const renderer = createTrackerStateRenderer();

  let lastSnapshot: TrackerSnapshot | null = null;
  let lastSnapshotProps: TrackerSnapshotProps | null = null;
  // Initialized to null so the closure captures the correct reference before assignment completes.
  let instance: TrackerInstance | null = null;
  // Memoized once per runtime generation so repeated whenDestroyed() calls
  // return the same Promise object without registering more than one
  // underlying 'destroy' subscription.
  let destroyedPromise: Promise<void> | null = null;
  let resolveDestroyedPromise: (() => void) | null = null;

  instance = createTrackerIntegrationInstance(configuration, {
    getInstance: () => instance,
    renderer,
  });

  return {
    instance: instance!,
    renderer,
    addRule(rule, params = undefined) {
      addTrackerInstanceRule(instance!, rule, params);
    },
    activateFromEvent(sourceEvent) {
      return activateFromEvent(instance!, sourceEvent);
    },
    activateRenderRecord(key, sourceEvent = null) {
      return activateTrackerInstanceRenderRecord(instance!, key, sourceEvent);
    },
    activateTrack(sourceEvent) {
      return activateTrack(instance!, sourceEvent);
    },
    destroy() {
      destroyTrackerInstance(instance!);
    },
    getOptions() {
      return getTrackerInstanceOptions(instance!);
    },
    getRoot() {
      return getTrackerInstanceRoot(instance!);
    },
    getRules() {
      return getTrackerInstanceRules(instance!);
    },
    getSnapshot() {
      return getTrackerInstanceSnapshot(instance!);
    },
    getSnapshotProps() {
      const snapshot = getTrackerInstanceSnapshot(instance!);

      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        lastSnapshotProps = createTrackerSnapshotProps(snapshot);
      }

      return lastSnapshotProps!;
    },
    getState(): TrackerState {
      if (isTrackerInstanceDestroyed(instance!)) {
        return 'destroyed';
      }

      return isTrackerInstanceMounted(instance!) ? 'mounted' : 'unmounted';
    },
    getStats(): TrackerStats {
      return getTrackerInstanceStats(instance!);
    },
    handleKeyboardEvent(sourceEvent) {
      return handleKeyboardEvent(instance!, sourceEvent);
    },
    isDestroyed() {
      return isTrackerInstanceDestroyed(instance!);
    },
    isMounted() {
      return isTrackerInstanceMounted(instance!);
    },
    mount(request) {
      if (request === null || typeof request !== 'object') {
        mountTrackerInstance(instance!, request as never);
        return;
      }

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
    removeRuleByIndex(index, params = undefined) {
      removeTrackerInstanceRuleByIndex(instance!, index, params);
    },
    removeRuleBySelector(selector, params = undefined) {
      removeTrackerInstanceRuleBySelector(instance!, selector, params);
    },
    requestRender() {
      assertTrackerInstanceMounted(instance!, 'request a render');
      requestTrackerInstanceRender(instance!, 'all', true, { source: 'request-render' });
    },
    render(...args: unknown[]) {
      renderTrackerInstanceNow(instance!, args);
    },
    resetStats() {
      resetTrackerInstanceStats(instance!);
    },
    replaceRules(rules, params = undefined) {
      replaceTrackerInstanceRules(instance!, rules, params);
    },
    replaceConfiguration(nextConfiguration, params = undefined) {
      replaceTrackerInstanceConfiguration(instance!, nextConfiguration, params);
    },
    replaceOptions(nextOptions, params = undefined) {
      replaceTrackerInstanceOptions(instance!, nextOptions, params);
    },
    patchOptions(nextOptions, params = undefined) {
      patchTrackerInstanceOptions(instance!, nextOptions, params);
    },
    subscribe(listener: TrackerSnapshotListener): TrackerSnapshotUnsubscribe {
      if (instance!.destroyed) {
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
}

export { createTrackerStateIntegration };
