import { assertCompleteTrackerConfigurationEnvelope } from '../config/assertCompleteTrackerConfigurationEnvelope.js';
import { diffOptions } from '../config/diffOptions.js';
import { assertConfigurationDiagnostics } from '../config/assertConfigurationDiagnostics.js';
import { resolveTrackerOptions } from '../config/resolveOptions.js';
import { DebugDiagnostics } from '../diagnostics/DebugDiagnostics.js';
import { TrackerConfigurationError } from '../errors.js';
import { RENDER_TARGETS, mergeRenderTargets } from '../schedule/renderTargets.js';
import { getOrientationAxis } from '../scroll/contextShared.js';
import { validateElementScrollProfile } from '../scroll/elementScrollProfile.js';
import { validateRules } from '../rules/validateRules.js';
import type {
  TrackerConfigurationReplacement,
  TrackerOperationParams,
  TrackerOptions,
  TrackerOptionsDiff,
  TrackerRenderReasonSource,
  TrackerResolvedOptions,
  TrackerRule,
} from '../types.js';
import { isPlainObject, snapshotCallTimeInput, withRestoredDiagnosticsOutput } from '../utils/object.js';
import { freezeRendererOptions } from './createTrackerInstance.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { syncTrackerInstanceContexts } from './instanceContext.js';
import type { TrackerLifecycleCallbacks } from './lifecycleCallbacks.js';
import { assertTrackerInstanceAlive } from './lifecycleGuards.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { shouldRender } from './operationParams.js';
import { performTrackerInstanceRenderRequest } from './rendering.js';
import { extractApproxSelectors, pushPendingRuleOperation } from './ruleProjection.js';
import { emitTrackerSelectionChangeEvent, performTrackerSelectionTransition } from './selection.js';

declare const __RXT_TRACKER_DEBUG__: boolean | undefined;

/** Prevalidated options candidate not yet applied by its deferred operation. */
interface PendingOptionsProjection {
  /** Synchronously accepted but not-yet-applied candidate options. */
  options: TrackerResolvedOptions;
}

/**
 * Per-instance pending options projection, keyed by instance so a reentrant
 * synchronous prevalidation call made before an earlier queued options update
 * has actually run can validate against that queued candidate instead of the
 * stale committed `instance.options`.
 */
const pendingOptionsProjections = new WeakMap<TrackerInstance, PendingOptionsProjection[]>();

/**
 * Returns the options a synchronous prevalidation call should treat as
 * "current": the latest accepted but not-yet-applied candidate pushed by an
 * earlier queued update on this instance, or the committed instance options
 * when none is pending.
 *
 * @param instance - Internal instance context.
 * @returns Effective baseline options for prevalidation.
 */
function getProjectedTrackerInstanceOptions(instance: TrackerInstance): TrackerResolvedOptions {
  return pendingOptionsProjections.get(instance)?.at(-1)?.options ?? instance.options;
}

/**
 * Registers a synchronously accepted options candidate as the pending
 * projection, so a later reentrant prevalidation call on the same instance
 * sees it before the deferred operation that produced it actually runs.
 *
 * @param instance - Internal instance context.
 * @param nextOptions - Prevalidated candidate options.
 * @returns Cleanup callback that removes exactly this projection by identity.
 */
function pushPendingOptionsProjection(instance: TrackerInstance, nextOptions: TrackerResolvedOptions): () => void {
  let projections = pendingOptionsProjections.get(instance);

  if (!projections) {
    projections = [];
    pendingOptionsProjections.set(instance, projections);
  }

  const queue = projections;
  const projection: PendingOptionsProjection = { options: nextOptions };

  queue.push(projection);

  return () => {
    const index = queue.indexOf(projection);

    if (index !== -1) {
      queue.splice(index, 1);
    }

    if (queue.length === 0) {
      pendingOptionsProjections.delete(instance);
    }
  };
}

/**
 * Runs one options rollback action without suppressing later rollback work.
 *
 * @param rollback - Rollback action.
 * @param errors - Ordered update and rollback errors.
 */
function attemptOptionsRollback(rollback: () => void, errors: unknown[]): void {
  try {
    rollback();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Rethrows the update error or combines it with rollback failures.
 *
 * @param errors - Original error followed by rollback errors.
 */
function throwOptionsUpdateErrors(errors: unknown[]): never {
  if (errors.length === 1) {
    throw errors[0];
  }

  throw new AggregateError(errors, 'Tracker options update and rollback both failed.');
}

/**
 * Selects the render target required by option changes.
 *
 * @param diff - Option diff flags.
 * @param rulesChanged - Whether rules changed separately.
 * @returns Internal render target or null.
 */
function getRenderTargetForDiff(
  diff: TrackerOptionsDiff,
  rulesChanged: boolean,
): import('../types.js').TrackerRenderTarget | null {
  const needsTrack = diff.track || diff.styles || diff.interaction;
  const needsMarkers = rulesChanged || diff.markers;
  let target: import('../types.js').TrackerRenderTarget | null = null;

  if (needsMarkers) {
    target = mergeRenderTargets(target, RENDER_TARGETS.MARKERS);
  }

  if (diff.markerPresentation) {
    target = mergeRenderTargets(target, RENDER_TARGETS.MARKER_PRESENTATION);
  }

  if (needsTrack) {
    target = mergeRenderTargets(target, RENDER_TARGETS.TRACK);
  }

  if (diff.viewport) {
    target = mergeRenderTargets(target, RENDER_TARGETS.VIEWPORT);
  }

  return target;
}

/**
 * Rejects an element-mode orientation change that leaves the guaranteed profile.
 *
 * The check runs before any rule or option commit so a failed update is
 * transactional and preserves the previous committed configuration. External
 * CSS violations of the unchanged represented axis are handled through
 * geometry suspension instead.
 *
 * @param instance - Internal instance context.
 * @param previousOptions - Committed options.
 * @param nextOptions - Validated candidate options.
 * @throws TrackerConfigurationError when the new represented axis is unsupported.
 */
function validateElementOrientationUpdate(
  instance: TrackerInstance,
  previousOptions: TrackerResolvedOptions,
  nextOptions: TrackerResolvedOptions,
): void {
  const runtimeContext = instance.runtimeContext;
  const nextOrientation = nextOptions.orientation;

  if (
    runtimeContext === null ||
    runtimeContext.scrollMode !== 'element' ||
    previousOptions.orientation === nextOrientation
  ) {
    return;
  }

  const profile = validateElementScrollProfile(
    runtimeContext.scrollRoot as HTMLElement,
    getOrientationAxis(nextOrientation),
  );

  if (!profile.ok) {
    throw new TrackerConfigurationError(
      `Tracker element scroll root does not support the requested orientation: ${profile.reason}.`,
      { code: 'ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT' },
    );
  }
}

/**
 * Validates an options update candidate and returns the resulting normalized options.
 *
 * Reads `instance.options` at call time, so calling this again later against a
 * changed instance (e.g. after an earlier deferred operation applied) re-validates
 * against the then-current state rather than reusing a stale result.
 *
 * @param instance - Internal instance context.
 * @param options - Partial options.
 * @param replace - Whether the input replaces configuration from defaults.
 * @param previousOptionsOverride - Baseline to validate against instead of
 * the committed `instance.options`. Passed by synchronous prevalidation so a
 * reentrant call sees an earlier queued update's candidate; execution-time
 * revalidation omits it to always check the true live state.
 * @returns Previously committed options and the validated candidate.
 * @throws TypeError when options are not a plain object (a required argument shape error).
 * @throws TrackerConfigurationError when options fail shape/value validation, or
 * request an unsupported element-mode orientation change.
 */
function prepareTrackerInstanceOptionsUpdate(
  instance: TrackerInstance,
  options: TrackerOptions,
  replace: boolean,
  previousOptionsOverride?: TrackerResolvedOptions,
): { previousOptions: TrackerResolvedOptions; nextOptions: TrackerResolvedOptions } {
  if (!isPlainObject(options)) {
    throw new TypeError('Tracker options must be a plain object.');
  }

  const previousOptions = previousOptionsOverride ?? instance.options;
  const nextOptions = resolveTrackerOptions(options, { previousOptions, replace });

  validateElementOrientationUpdate(instance, previousOptions, nextOptions);

  return { previousOptions, nextOptions };
}

/**
 * Validates an options update candidate without
 * mutating instance state or performing scheduling/render side effects.
 *
 * `coordinateTrackerOperation()` defers state-changing operations called during
 * public event or snapshot dispatch, so a validation failure inside the deferred
 * body only ever reaches `deferred-operation-error` diagnostics, never the
 * original caller's stack frame. Running the same validation synchronously here,
 * before the operation is enqueued, restores a visible throw for the caller in
 * that case. It intentionally does not affect ordering between multiple
 * operations queued in the same dispatch batch — each queued operation still
 * revalidates against live instance state when it actually runs.
 *
 * Validates against {@link getProjectedTrackerInstanceOptions}, so a reentrant
 * call made before an earlier synchronously accepted update has actually run
 * sees that update's candidate rather than the stale committed options. The
 * caller is responsible for pushing its returned candidate onto the pending
 * projection (via {@link pushPendingOptionsProjection}) and releasing it once
 * the operation it guards has settled.
 *
 * @param instance - Internal instance context.
 * @param options - Partial options.
 * @param replace - Whether the input replaces configuration from defaults.
 * @returns The validated candidate options.
 * @throws TrackerConfigurationError when options are invalid.
 */
function assertTrackerInstanceOptionsUpdateIsValid(
  instance: TrackerInstance,
  options: TrackerOptions,
  replace: boolean,
): TrackerResolvedOptions {
  const { nextOptions } = prepareTrackerInstanceOptionsUpdate(
    instance,
    options,
    replace,
    getProjectedTrackerInstanceOptions(instance),
  );

  return nextOptions;
}

/**
 * Prevalidates a complete configuration replacement without committing or enqueueing it.
 *
 * Projection adapters use this at their original public call boundary before
 * a coordinated adapter transaction is accepted. Actual execution validates
 * again against then-live lifecycle and DOM state.
 *
 * @param instance - Internal Tracker instance.
 * @param configuration - Complete two-channel replacement.
 * @param params - Apply params.
 */
function assertTrackerInstanceConfigurationReplacementIsValid(
  instance: TrackerInstance,
  configuration: TrackerConfigurationReplacement,
  params: TrackerOperationParams | undefined = undefined,
): void {
  assertTrackerInstanceAlive(instance, 'replace configuration');
  assertCompleteTrackerConfigurationEnvelope(configuration);

  const optionsSnapshot = snapshotCallTimeOptions(configuration.options);
  const rulesSnapshot = snapshotCallTimeInput(configuration.rules);
  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);

  if (instance.destroyed) {
    return;
  }

  assertTrackerInstanceOptionsUpdateIsValid(instance, optionsSnapshot, true);
  assertConfigurationDiagnostics(
    validateRules(rulesSnapshot, {
      selectorRoot: instance.runtimeContext?.sourceRoot ?? null,
    }).diagnostics,
    'Tracker rules',
  );
}

/**
 * Updates an internal Tracker instance options snapshot.
 *
 * @param instance - Internal instance context.
 * @param options - Partial options.
 * @param params - Apply params.
 * @param callbacks - Lifecycle callbacks.
 * @param replace - Whether the input replaces configuration from defaults.
 * @param reasonSource - Public mutation source reported to render telemetry.
 * @param replacementRules - Optional complete rule replacement.
 */
function performTrackerInstanceOptionsUpdate(
  instance: TrackerInstance,
  options: TrackerOptions,
  params: unknown = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
  replace = false,
  reasonSource: TrackerRenderReasonSource = 'replaceOptions',
  replacementRules: readonly TrackerRule[] | null = null,
): void {
  assertTrackerInstanceAlive(instance, 'update options');

  const render = shouldRender(params);
  const { previousOptions, nextOptions } = prepareTrackerInstanceOptionsUpdate(instance, options, replace);
  const previousRendererOptions = instance.rendererOptions;
  const previousRules = instance.ruleStore.getAll();
  const previousRuleCounters = instance.diagnostics.getStats().rules;
  const previousSelectedKey = instance.interactionController.getSelectedKey();
  let diff!: TrackerOptionsDiff;
  let rulesChanged = false;
  let observerUpdateAttempted = false;
  let interactionUpdateAttempted = false;
  let selectionTransition: ReturnType<TrackerInstance['interactionController']['synchronizeSelection']> = null;

  try {
    if (replace) {
      instance.diagnostics.replaceOptions(nextOptions.diagnostics);
    } else {
      instance.diagnostics.updateOptions(nextOptions.diagnostics);
    }

    const candidateRules = replacementRules ?? instance.ruleStore.getPublicRules();

    assertConfigurationDiagnostics(
      validateRules(candidateRules, {
        selectorRoot: instance.runtimeContext?.sourceRoot ?? null,
      }).diagnostics,
      'Tracker rules',
    );
    instance.ruleStore.updateContext({
      selectorRoot: instance.runtimeContext?.sourceRoot ?? null,
    });

    if (replacementRules !== null) {
      rulesChanged = instance.ruleStore.replace(replacementRules).changed;
    }

    diff = diffOptions(previousOptions, nextOptions);

    instance.options = nextOptions;
    instance.rendererOptions = freezeRendererOptions(nextOptions);
    syncTrackerInstanceContexts(instance, callbacks);

    if (diff.observers && instance.mounted) {
      observerUpdateAttempted = true;
      instance.observerController.update(instance.options);
    }

    if (diff.interaction && instance.mounted && instance.renderer.root !== null) {
      interactionUpdateAttempted = true;
      instance.interactionController.update(instance.options);
    }

    selectionTransition = instance.interactionController.synchronizeSelection(previousSelectedKey);

    if (
      typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
      __RXT_TRACKER_DEBUG__ === true &&
      instance.diagnostics instanceof DebugDiagnostics
    ) {
      instance.diagnostics.trace('configuration:commit', { reasonSource, replace, rulesChanged });
    }
  } catch (error) {
    const errors: unknown[] = [error];

    instance.options = previousOptions;
    instance.rendererOptions = previousRendererOptions;
    attemptOptionsRollback(() => instance.diagnostics.replaceOptions(previousOptions.diagnostics), errors);
    attemptOptionsRollback(() => instance.ruleStore.restoreSnapshot(previousRules), errors);
    attemptOptionsRollback(
      () =>
        instance.ruleStore.updateContext({
          selectorRoot: instance.runtimeContext?.sourceRoot ?? null,
        }),
      errors,
    );
    attemptOptionsRollback(() => instance.diagnostics.restoreRuleCounters(previousRuleCounters), errors);
    attemptOptionsRollback(() => syncTrackerInstanceContexts(instance, callbacks), errors);

    if (observerUpdateAttempted && instance.mounted) {
      attemptOptionsRollback(() => instance.observerController.update(previousOptions), errors);
    }

    if (interactionUpdateAttempted && instance.mounted && instance.renderer.root !== null) {
      attemptOptionsRollback(() => instance.interactionController.update(previousOptions), errors);
    }

    if (
      typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
      __RXT_TRACKER_DEBUG__ === true &&
      instance.diagnostics instanceof DebugDiagnostics
    ) {
      instance.diagnostics.trace('configuration:rollback', { reasonSource, replace, errorCount: errors.length });
    }

    throwOptionsUpdateErrors(errors);
  }

  if (!diff.changed && !rulesChanged) {
    if (selectionTransition !== null && instance.mounted && instance.renderer.root !== null) {
      performTrackerSelectionTransition(instance, selectionTransition, 'selection');
    }

    return;
  }

  const target = getRenderTargetForDiff(diff, rulesChanged);

  if (selectionTransition !== null) {
    if (render && instance.mounted) {
      performTrackerSelectionTransition(instance, selectionTransition, 'enclosing');
    } else {
      // Presentation stays deferred (dirty), but the logical transition is
      // already committed in InteractionController state and must not be
      // silently dropped: a later render's own synchronizeSelection() call
      // will see no further diff and will never re-emit it.
      emitTrackerSelectionChangeEvent(instance, selectionTransition);
    }

    if (!render) {
      performTrackerInstanceRenderRequest(instance, RENDER_TARGETS.ALL, false, {
        source: reasonSource,
      });
      return;
    }
  }

  performTrackerInstanceRenderRequest(instance, target, render, {
    source: reasonSource,
  });
}

/**
 * Returns a deep call-time snapshot of a public options candidate, preserving
 * the caller's original `diagnostics.output` identity.
 *
 * `snapshotCallTimeInput()` deep-clones every reachable plain object,
 * including `diagnostics`, so without this restoration a caller-owned
 * diagnostics sink would lose its object identity across a deferred
 * reentrant options update, breaking the documented guarantee that it stays
 * caller-owned state.
 *
 * @param options - Raw caller-supplied options.
 * @returns Deep call-time snapshot with `diagnostics.output` identity intact.
 */
function snapshotCallTimeOptions(options: TrackerOptions): TrackerOptions {
  const snapshot = snapshotCallTimeInput(options);

  if (snapshot.diagnostics) {
    snapshot.diagnostics = withRestoredDiagnosticsOutput(options.diagnostics, snapshot.diagnostics);
  }

  return snapshot;
}

/**
 * Coordinates one public options update at the outer operation boundary.
 *
 * @param instance - Internal Tracker instance.
 * @param options - Partial options.
 * @param params - Apply params.
 * @param callbacks - Lifecycle callbacks.
 */
function patchTrackerInstanceOptions(
  instance: TrackerInstance,
  options: TrackerOptions,
  params: unknown = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'patch options');

  const optionsSnapshot = snapshotCallTimeOptions(options);
  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);
  let releaseProjection: (() => void) | undefined;

  if (!instance.destroyed) {
    releaseProjection = pushPendingOptionsProjection(
      instance,
      assertTrackerInstanceOptionsUpdateIsValid(instance, optionsSnapshot, false),
    );
  }

  coordinateTrackerOperation(
    instance,
    'patchOptions',
    () =>
      performTrackerInstanceOptionsUpdate(instance, optionsSnapshot, paramsSnapshot, callbacks, false, 'patchOptions'),
    { deferredResult: undefined, cleanup: releaseProjection },
  );
}

/**
 * Replaces an internal Tracker instance configuration from defaults.
 *
 * @param instance - Internal instance context.
 * @param options - Complete declarative options value.
 * @param params - Apply params.
 * @param callbacks - Lifecycle callbacks.
 */
function replaceTrackerInstanceOptions(
  instance: TrackerInstance,
  options: TrackerOptions,
  params: unknown = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'replace options');

  const optionsSnapshot = snapshotCallTimeOptions(options);
  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);
  let releaseProjection: (() => void) | undefined;

  if (!instance.destroyed) {
    releaseProjection = pushPendingOptionsProjection(
      instance,
      assertTrackerInstanceOptionsUpdateIsValid(instance, optionsSnapshot, true),
    );
  }

  coordinateTrackerOperation(
    instance,
    'replaceOptions',
    () =>
      performTrackerInstanceOptionsUpdate(instance, optionsSnapshot, paramsSnapshot, callbacks, true, 'replaceOptions'),
    { deferredResult: undefined, cleanup: releaseProjection },
  );
}

/**
 * Atomically replaces options and rules.
 *
 * @param instance - Internal instance context.
 * @param configuration - Complete two-channel replacement.
 * @param params - Apply params.
 * @param callbacks - Lifecycle callbacks.
 */
function replaceTrackerInstanceConfiguration(
  instance: TrackerInstance,
  configuration: TrackerConfigurationReplacement,
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'replace configuration');
  assertCompleteTrackerConfigurationEnvelope(configuration);

  const optionsSnapshot = snapshotCallTimeOptions(configuration.options);
  const rulesSnapshot = snapshotCallTimeInput(configuration.rules);
  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);

  let releaseOptionsProjection: (() => void) | undefined;
  let releaseRuleProjection: (() => void) | undefined;

  if (!instance.destroyed) {
    const nextOptions = assertTrackerInstanceOptionsUpdateIsValid(instance, optionsSnapshot, true);

    assertConfigurationDiagnostics(
      validateRules(rulesSnapshot, {
        selectorRoot: instance.runtimeContext?.sourceRoot ?? null,
      }).diagnostics,
      'Tracker rules',
    );
    releaseOptionsProjection = pushPendingOptionsProjection(instance, nextOptions);
    releaseRuleProjection = pushPendingRuleOperation(instance, () => extractApproxSelectors(rulesSnapshot));
  }

  coordinateTrackerOperation(
    instance,
    'replaceConfiguration',
    () =>
      performTrackerInstanceOptionsUpdate(
        instance,
        optionsSnapshot,
        paramsSnapshot,
        callbacks,
        true,
        'replaceConfiguration',
        rulesSnapshot,
      ),
    {
      deferredResult: undefined,
      cleanup: releaseOptionsProjection
        ? () => {
            releaseOptionsProjection?.();
            releaseRuleProjection?.();
          }
        : undefined,
    },
  );
}

/**
 * Validates a complete rule replacement against the instance source root.
 *
 * @param instance - Internal instance context.
 * @param rules - Complete rule list candidate.
 * @throws TypeError when the candidate is not an array (a required argument shape error).
 * @throws TrackerConfigurationError when the candidate fails rule validation.
 */
function assertTrackerInstanceRulesUpdateIsValid(
  instance: TrackerInstance,
  rules: unknown,
): asserts rules is readonly TrackerRule[] {
  if (!Array.isArray(rules)) {
    throw new TypeError('Tracker rules must be an array.');
  }

  assertConfigurationDiagnostics(
    validateRules(rules, {
      selectorRoot: instance.runtimeContext?.sourceRoot ?? null,
    }).diagnostics,
    'Tracker rules',
  );
}

/**
 * Replaces the complete rule list while preserving committed options.
 *
 * @param instance - Internal instance context.
 * @param rules - Complete rule list.
 * @param params - Apply params.
 * @param callbacks - Lifecycle callbacks.
 */
function performReplaceTrackerInstanceRules(
  instance: TrackerInstance,
  rules: readonly TrackerRule[],
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'replace rules');
  assertTrackerInstanceRulesUpdateIsValid(instance, rules);

  performTrackerInstanceOptionsUpdate(instance, {}, params, callbacks, false, 'replaceRules', rules);
}

export {
  assertTrackerInstanceConfigurationReplacementIsValid,
  assertTrackerInstanceRulesUpdateIsValid,
  getProjectedTrackerInstanceOptions,
  patchTrackerInstanceOptions,
  performReplaceTrackerInstanceRules,
  replaceTrackerInstanceConfiguration,
  replaceTrackerInstanceOptions,
};
