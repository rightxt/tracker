import type {
  TrackerAddRuleParams,
  TrackerConfiguration,
  TrackerConfigurationReplacement,
  TrackerEventName,
  TrackerEventUnsubscribe,
  TrackerOperationParams,
  TrackerOptions,
  TrackerReadonlyOptions,
  TrackerReadonlyRule,
  TrackerRendererLike,
  TrackerRendererMountTarget,
  TrackerRule,
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
  getTrackerInstanceOptions,
  getTrackerInstanceRoot,
  getTrackerInstanceRules,
  getTrackerInstanceStats,
  isTrackerInstanceDestroyed,
  isTrackerInstanceMounted,
  resetTrackerInstanceStats,
} from './accessors.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { offTrackerInstanceEvent, onTrackerInstanceEvent } from './events.js';
import { createTrackerIntegrationInstance } from './integration.js';
import { registerTrackerIntegration } from './integrationRegistry.js';
import { activateTrackerInstanceRenderRecord } from './interaction.js';
import { destroyTrackerInstance, mountTrackerInstance, unmountTrackerInstance } from './lifecycle.js';
import { assertTrackerInstanceMounted } from './lifecycleGuards.js';
import { renderTrackerInstanceNow, requestTrackerInstanceRender } from './rendering.js';
import {
  addTrackerInstanceRule,
  removeTrackerInstanceRuleByIndex,
  removeTrackerInstanceRuleBySelector,
  replaceTrackerInstanceRules,
} from './rules.js';
import { getTrackerInstanceSnapshot, subscribeTrackerInstanceSnapshot } from './snapshotStore.js';
import {
  patchTrackerInstanceOptions,
  replaceTrackerInstanceConfiguration,
  replaceTrackerInstanceOptions,
} from './updating.js';

/** Options for semantic activation after renderer-owned item hit testing. */
interface TrackerActivateItemOptions {
  /** Original event, used for event payloads and duplicate-activation suppression. */
  readonly sourceEvent?: Event | null | undefined;
}

/** Explicit roots and renderer ownership target for one mount generation. */
interface TrackerRendererIntegrationMountRequest {
  /** Root queried for source elements. */
  readonly sourceRoot?: TrackerSourceRoot | undefined;
  /** Window or element whose scroll state is represented. */
  readonly scrollRoot?: TrackerScrollRoot | undefined;
  /** Host or framework-owned root passed to the renderer. */
  readonly rendererTarget: TrackerRendererMountTarget;
}

/** Construction options for the Direct Renderer integration facade. */
interface TrackerRendererIntegrationOptions {
  /** Imperative renderer implementation owned by the integration. */
  readonly renderer: TrackerRendererLike;
}

/**
 * Opaque operational facade for Direct Renderer integrations.
 *
 * The facade deliberately excludes the mutable Core instance, scheduler,
 * stores, controllers, renderer normalization, and render-record lookup.
 */
interface TrackerRendererIntegration {
  /** Adds a rule to the ordered rule list. */
  addRule: (rule: TrackerRule, params?: TrackerAddRuleParams) => void;
  /** Activates a current marker or cluster after renderer-owned hit testing. */
  activateItem: (key: string, options?: TrackerActivateItemOptions) => boolean;
  /** Permanently destroys this runtime generation. */
  destroy: () => void;
  /** Returns immutable committed options. */
  getOptions: () => TrackerReadonlyOptions;
  /** Returns the current renderer root. */
  getRoot: () => HTMLElement | null;
  /** Returns public rule copies in priority order. */
  getRules: () => readonly TrackerReadonlyRule[];
  /** Returns the current immutable observation snapshot. */
  getSnapshot: () => TrackerSnapshot;
  /** Returns the public lifecycle state. */
  getState: () => TrackerState;
  /** Returns current diagnostics counters. */
  getStats: () => TrackerStats;
  /** Reports whether permanent teardown completed. */
  isDestroyed: () => boolean;
  /** Reports whether roots are currently mounted. */
  isMounted: () => boolean;
  /** Mounts Core against explicit source, scroll, and renderer identities. */
  mount: (request: TrackerRendererIntegrationMountRequest) => void;
  /** Removes an event handler by identity. */
  off: <TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ) => boolean;
  /** Subscribes to a typed Core event. */
  on: <TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ) => TrackerEventUnsubscribe;
  /** Applies a strict deep patch to committed options. */
  patchOptions: (options: Partial<TrackerOptions>, params?: TrackerOperationParams) => void;
  /** Removes the current indexed rule. */
  removeRuleByIndex: (index: number, params?: TrackerOperationParams) => void;
  /** Removes the rule with the normalized selector. */
  removeRuleBySelector: (selector: string, params?: TrackerOperationParams) => void;
  /** Performs an immediate complete render. */
  render: () => void;
  /** Atomically replaces committed options and rules. */
  replaceConfiguration: (configuration: TrackerConfigurationReplacement, params?: TrackerOperationParams) => void;
  /** Replaces committed options. */
  replaceOptions: (options: Partial<TrackerOptions>, params?: TrackerOperationParams) => void;
  /** Replaces the committed rule list. */
  replaceRules: (rules: readonly TrackerRule[], params?: TrackerOperationParams) => void;
  /** Requests a coalesced complete render. */
  requestRender: () => void;
  /** Resets diagnostics counters. */
  resetStats: () => void;
  /** Subscribes to immutable observation snapshots. */
  subscribeSnapshot: (listener: TrackerSnapshotListener) => TrackerSnapshotUnsubscribe;
  /** Reversibly releases the current mount generation. */
  unmount: () => void;
  /** Resolves after permanent teardown completes. */
  whenDestroyed: () => Promise<void>;
}

/**
 * Creates an opaque Direct Renderer integration facade.
 *
 * @param configuration - Initial options and rules.
 * @param integrationOptions - Renderer owned by the integration.
 * @returns Supported renderer integration operations without a raw Core instance.
 */
function createTrackerRendererIntegration(
  configuration: TrackerConfiguration | undefined,
  integrationOptions: TrackerRendererIntegrationOptions,
): TrackerRendererIntegration {
  let instance: TrackerInstance | null = null;
  let destroyedPromise: Promise<void> | null = null;
  let resolveDestroyedPromise: (() => void) | null = null;

  instance = createTrackerIntegrationInstance(configuration, {
    getInstance: () => instance,
    renderer: integrationOptions?.renderer,
  });

  const integration: TrackerRendererIntegration = {
    addRule(rule, params = undefined) {
      addTrackerInstanceRule(instance!, rule, params);
    },
    activateItem(key, options = undefined) {
      return activateTrackerInstanceRenderRecord(instance!, key, options?.sourceEvent ?? null);
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
      mountTrackerInstance(instance!, request);
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
    patchOptions(options, params = undefined) {
      patchTrackerInstanceOptions(instance!, options, params);
    },
    removeRuleByIndex(index, params = undefined) {
      removeTrackerInstanceRuleByIndex(instance!, index, params);
    },
    removeRuleBySelector(selector, params = undefined) {
      removeTrackerInstanceRuleBySelector(instance!, selector, params);
    },
    render(...args: unknown[]) {
      renderTrackerInstanceNow(instance!, args);
    },
    replaceConfiguration(nextConfiguration, params = undefined) {
      replaceTrackerInstanceConfiguration(instance!, nextConfiguration, params);
    },
    replaceOptions(options, params = undefined) {
      replaceTrackerInstanceOptions(instance!, options, params);
    },
    replaceRules(rules, params = undefined) {
      replaceTrackerInstanceRules(instance!, rules, params);
    },
    requestRender() {
      assertTrackerInstanceMounted(instance!, 'request a render');
      requestTrackerInstanceRender(instance!, 'all', true, { source: 'request-render' });
    },
    resetStats() {
      resetTrackerInstanceStats(instance!);
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

export type {
  TrackerActivateItemOptions,
  TrackerRendererIntegration,
  TrackerRendererIntegrationMountRequest,
  TrackerRendererIntegrationOptions,
};
export { createTrackerRendererIntegration };
