import type { TrackerRenderControl, TrackerRenderReason, TrackerRenderRecord, TrackerRenderTarget } from '../types.js';
import { getEmptyArray, getNull, noop } from '../utils/function.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { getTrackerInstanceRenderRecordByKey, getTrackerInstanceRenderRecords } from './accessors.js';
import {
  performTrackerInstanceRender,
  performTrackerInstanceRenderRequest,
  renderTrackerInstance,
  requestTrackerInstanceRender,
} from './rendering.js';

interface TrackerLifecycleCallbacks {
  /**
   * Internal render function.
   *
   * Receives a {@link TrackerRenderControl} whose `signal` is aborted if this
   * run is superseded while still in flight; see the type's JSDoc for the
   * cooperative-cancellation contract and its residual limitations.
   */
  render: (
    target: TrackerRenderTarget,
    reason?: TrackerRenderReason,
    control?: TrackerRenderControl,
  ) => void | Promise<void>;
  /** Internal render request function. */
  requestRenderTarget: (target: TrackerRenderTarget, render: boolean, reason?: TrackerRenderReason) => void;
  /** Render record lookup provider. */
  getRenderRecordByKey: (key: string) => TrackerRenderRecord | null;
  /** Render records provider. */
  getRenderRecords: () => readonly TrackerRenderRecord[];
}

interface TrackerLifecycleCallbackFactoryOptions {
  /** Instance provider. */
  getInstance: () => TrackerInstance | null | undefined;
}

/** Lifecycle callback keys copied from adapter overrides. */
const LIFECYCLE_CALLBACK_NAMES: ReadonlyArray<keyof TrackerLifecycleCallbacks> = Object.freeze([
  'render',
  'requestRenderTarget',
  'getRenderRecordByKey',
  'getRenderRecords',
]);

/**
 * Normalizes optional lifecycle callbacks to the full core callback contract.
 *
 * @param callbacks - Lifecycle callbacks.
 * @returns Normalized callbacks.
 */
function normalizeTrackerLifecycleCallbacks(
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): TrackerLifecycleCallbacks {
  const normalizedCallbacks = callbacks !== null && typeof callbacks === 'object' ? callbacks : {};

  return {
    render: typeof normalizedCallbacks.render === 'function' ? normalizedCallbacks.render : noop,
    requestRenderTarget:
      typeof normalizedCallbacks.requestRenderTarget === 'function' ? normalizedCallbacks.requestRenderTarget : noop,
    getRenderRecordByKey:
      typeof normalizedCallbacks.getRenderRecordByKey === 'function'
        ? normalizedCallbacks.getRenderRecordByKey
        : getNull,
    getRenderRecords:
      typeof normalizedCallbacks.getRenderRecords === 'function' ? normalizedCallbacks.getRenderRecords : getEmptyArray,
  };
}

/**
 * Applies valid lifecycle callback overrides to an existing callback set.
 *
 * Invalid values are ignored so partial framework updates cannot accidentally
 * disconnect previously registered lifecycle functions.
 *
 * @param baseCallbacks - Existing lifecycle callbacks.
 * @param callbackOverrides - Lifecycle callback overrides.
 * @returns Merged lifecycle callbacks.
 */
function mergeTrackerLifecycleCallbacks(
  baseCallbacks: Partial<TrackerLifecycleCallbacks> = {},
  callbackOverrides: Partial<TrackerLifecycleCallbacks> = {},
): TrackerLifecycleCallbacks {
  const overrides = callbackOverrides !== null && typeof callbackOverrides === 'object' ? callbackOverrides : {};
  const nextCallbacks: Partial<TrackerLifecycleCallbacks> = {
    ...(baseCallbacks !== null && typeof baseCallbacks === 'object' ? baseCallbacks : {}),
  };

  LIFECYCLE_CALLBACK_NAMES.forEach((callbackName) => {
    const callback = overrides[callbackName];

    if (typeof callback === 'function') {
      (nextCallbacks as Record<string, unknown>)[callbackName] = callback;
    }
  });

  return normalizeTrackerLifecycleCallbacks(nextCallbacks);
}

/**
 * Resolves lifecycle callbacks from an explicit override or an instance default.
 *
 * @param instance - Internal instance context.
 * @param callbacks - Lifecycle callback override.
 * @returns Lifecycle callbacks.
 */
function resolveTrackerLifecycleCallbacks(
  instance: TrackerInstance,
  callbacks: Partial<TrackerLifecycleCallbacks> | null | undefined = undefined,
): TrackerLifecycleCallbacks {
  const hasCallbackOverride = callbacks !== null && typeof callbacks === 'object' && Object.keys(callbacks).length > 0;

  if (!hasCallbackOverride) {
    return normalizeTrackerLifecycleCallbacks(instance.lifecycleCallbacks || {});
  }

  return mergeTrackerLifecycleCallbacks(instance.lifecycleCallbacks || {}, callbacks!);
}

/**
 * Creates standard lifecycle callbacks backed by a Tracker instance provider.
 *
 * @param options - Callback factory options.
 * @returns Lifecycle callbacks.
 */
function createTrackerLifecycleCallbacks(options: TrackerLifecycleCallbackFactoryOptions): TrackerLifecycleCallbacks {
  const getInstance = typeof options?.getInstance === 'function' ? options.getInstance : () => null;
  const resolveInstance = (): TrackerInstance | null => getInstance() || null;

  return normalizeTrackerLifecycleCallbacks({
    getRenderRecordByKey: (key) => {
      const instance = resolveInstance();

      return instance === null ? null : getTrackerInstanceRenderRecordByKey(instance, key);
    },
    getRenderRecords: () => {
      const instance = resolveInstance();

      return instance === null ? [] : getTrackerInstanceRenderRecords(instance);
    },
    render: (target, reason) => {
      const instance = resolveInstance();

      if (instance !== null) {
        if (instance.operationCoordinator.operationDepth > 0) {
          performTrackerInstanceRender(instance, target, reason);
        } else {
          renderTrackerInstance(instance, target, reason);
        }
      }
    },
    requestRenderTarget: (target, render, reason) => {
      const instance = resolveInstance();

      if (instance !== null) {
        if (instance.operationCoordinator.operationDepth > 0) {
          performTrackerInstanceRenderRequest(instance, target, render, reason);
        } else {
          requestTrackerInstanceRender(instance, target, render, reason);
        }
      }
    },
  });
}

export {
  createTrackerLifecycleCallbacks,
  mergeTrackerLifecycleCallbacks,
  normalizeTrackerLifecycleCallbacks,
  resolveTrackerLifecycleCallbacks,
};
export type { TrackerLifecycleCallbackFactoryOptions, TrackerLifecycleCallbacks };
