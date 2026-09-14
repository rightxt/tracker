import { DebugDiagnostics } from '../diagnostics/DebugDiagnostics.js';
import { getOwnerDocument, getOwnerWindow } from '../dom/context.js';
import { isInComposedSubtree } from '../dom/composedTree.js';
import { isHTMLElement } from '../dom/element.js';
import { getInternalDomRegistry } from '../dom/internalDomRegistry.js';
import { TrackerConfigurationError, TrackerLifecycleError } from '../errors.js';
import { EVENT_NAMES } from '../events/eventNames.js';
import { DATA_ATTRIBUTES } from '../render-contract/names.js';
import { assertConfigurationDiagnostics } from '../config/assertConfigurationDiagnostics.js';
import { RENDER_TARGETS } from '../schedule/renderTargets.js';
import { getOrientationAxis } from '../scroll/contextShared.js';
import { ElementScrollContext } from '../scroll/ElementScrollContext.js';
import { validateElementScrollProfile } from '../scroll/elementScrollProfile.js';
import { WindowScrollContext } from '../scroll/WindowScrollContext.js';
import type { TrackerIntegrationMountRequest, TrackerRendererMountContext, TrackerUnmountOptions } from '../types.js';
import { createRetainedDiagnosticStats, getErrorMessage } from '../utils/diagnostic.js';
import { snapshotCallTimeInput } from '../utils/object.js';
import { freezeRendererOptions } from './createTrackerInstance.js';
import type { TrackerCleanupRecord, TrackerInstance } from './createTrackerInstance.js';
import { getObservableTrackerRoot, syncTrackerInstanceContexts } from './instanceContext.js';
import { normalizeTrackerLifecycleCallbacks, resolveTrackerLifecycleCallbacks } from './lifecycleCallbacks.js';
import type { TrackerLifecycleCallbacks } from './lifecycleCallbacks.js';
import { hasSameTrackerMountIdentity, normalizeTrackerMountRequest } from './mountContext.js';
import type { TrackerNormalizedMountRequest, TrackerRuntimeContext } from './mountContext.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { performTrackerInstanceRender, publishTrackerRenderPublication } from './rendering.js';
import { emitTrackerInstanceSnapshot } from './snapshotStore.js';
import {
  beginTrackerRendererTransaction,
  commitTrackerRendererTransaction,
  rollbackTrackerRendererTransaction,
  updateTrackerRendererMount,
} from './rendererTransaction.js';
import { createTrackerMountView } from './viewProjection.js';

/** Compile-time flag selecting debug diagnostics in core bundles. */
declare const __RXT_TRACKER_DEBUG__: boolean | undefined;

/** One minimal connected-root quarantine retained per affected instance. */
const QUARANTINED_RENDERER_ROOTS = new WeakMap<TrackerInstance, QuarantinedRendererRoot>();

/** Connected renderer-owned root awaiting one final safe cleanup retry. */
interface QuarantinedRendererRoot {
  /** Validated renderer-owned root. */
  root: HTMLElement;
  /** Original renderer host used to bound safe fallback removal. */
  host: HTMLElement;
}

/** Captures root metadata before Tracker takes temporary ownership. */
function captureRootAttributes(instance: TrackerInstance, root: HTMLElement): void {
  instance.rootAttributeSnapshot = new Map(
    [DATA_ATTRIBUTES.SCROLL_MODE, DATA_ATTRIBUTES.GEOMETRY, 'aria-disabled'].map((name) => [
      name,
      root.getAttribute(name),
    ]),
  );
}

/**
 * Restores root metadata to the state preceding the current mount cycle.
 *
 * @param instance - Internal Tracker instance.
 * @param root - Renderer root whose temporary metadata is released.
 * @param errors - Mutable cleanup error collection.
 */
function restoreRootAttributes(instance: TrackerInstance, root: HTMLElement, errors: unknown[]): void {
  const snapshot = instance.rootAttributeSnapshot;

  if (snapshot === null) {
    return;
  }

  snapshot.forEach((value, name) => {
    attemptCleanup(() => {
      if (value === null) {
        root.removeAttribute(name);
      } else {
        root.setAttribute(name, value);
      }
    }, errors);
  });
  instance.rootAttributeSnapshot = null;
}

/**
 * Runs one cleanup operation and retains any thrown value.
 *
 * @param operation - Cleanup operation.
 * @param errors - Mutable error collection.
 */
function attemptCleanup(operation: () => void, errors: unknown[]): void {
  try {
    operation();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Throws retained cleanup failures without hiding the original single error.
 *
 * @param errors - Retained errors.
 * @param message - Aggregate error message.
 */
function throwCleanupErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, message);
  }
}

/**
 * Probes host ownership without letting a host DOM failure abort cleanup.
 *
 * @param host - Renderer host.
 * @param root - Renderer-owned root.
 * @param errors - Mutable cleanup error collection.
 * @returns Proven containment, proven non-containment, or null on failure.
 */
function probeRendererHostContainment(host: HTMLElement, root: HTMLElement, errors: unknown[]): boolean | null {
  try {
    return host.contains(root);
  } catch (error) {
    errors.push(error);
    return null;
  }
}

/**
 * Publishes the terminal unmounted projection or discards it when staging fails.
 *
 * @param instance - Internal Tracker instance.
 */
function commitTrackerUnmountProjection(instance: TrackerInstance): void {
  try {
    updateTrackerRendererMount(instance.renderer, createTrackerMountView(false, null, false), instance.rendererOptions);
    commitTrackerRendererTransaction(instance.renderer);
  } catch (error) {
    rollbackTrackerRendererTransaction(instance.renderer);
    throw error;
  }
}

/**
 * Creates and records a renderer-contract error.
 *
 * @param instance - Internal Tracker instance.
 * @param message - Contract failure message.
 * @param details - Diagnostic details.
 * @returns Stable renderer-contract error.
 */
function createRendererContractError(
  instance: TrackerInstance,
  message: string,
  details: Record<string, unknown> = {},
): TrackerConfigurationError {
  instance.diagnostics.error('renderer-contract-error', message, details);

  return new TrackerConfigurationError(message, { code: 'ERR_TRACKER_RENDERER_CONTRACT' });
}

/**
 * Validates a provisional renderer result before registry insertion or facade commit.
 *
 * @param instance - Provisional Tracker instance.
 * @param candidate - Renderer mount result.
 * @param request - Normalized mount identities.
 * @returns Validated actual renderer root.
 * @throws TrackerConfigurationError when the renderer contract is violated.
 */
function validateRendererRoot(
  instance: TrackerInstance,
  candidate: unknown,
  request: TrackerNormalizedMountRequest,
): HTMLElement {
  if (!isHTMLElement(candidate)) {
    throw createRendererContractError(instance, 'Tracker renderer must return an HTMLElement root.', { candidate });
  }

  if (!candidate.isConnected) {
    throw createRendererContractError(instance, 'Tracker renderer returned a disconnected root.', { candidate });
  }

  if (getOwnerDocument(candidate) !== request.document || getOwnerWindow(candidate) !== request.window) {
    throw createRendererContractError(instance, 'Tracker renderer returned a root from another DOM realm.', {
      candidate,
    });
  }

  if (request.rendererTarget.kind === 'root') {
    if (candidate !== request.rendererTarget.root) {
      throw createRendererContractError(instance, 'Tracker root renderer must return the exact expected root.', {
        candidate,
        target: request.rendererTarget.root,
      });
    }

    return candidate;
  }

  const { host } = request.rendererTarget;

  if (candidate === host || !host.contains(candidate)) {
    throw createRendererContractError(instance, 'Tracker host renderer must return a strict descendant of its host.', {
      candidate,
      target: host,
    });
  }

  return candidate;
}

/**
 * Rejects a renderer root that would exclude the configured source root.
 *
 * @param instance - Provisional Tracker instance.
 * @param root - Validated renderer root.
 * @param sourceRoot - Configured source root.
 * @throws TrackerConfigurationError when source content is inside renderer DOM.
 */
function validateRendererRootOwnership(instance: TrackerInstance, root: HTMLElement, sourceRoot: Node): void {
  if (!isInComposedSubtree(sourceRoot, root)) {
    return;
  }

  throw createRendererContractError(instance, 'Tracker renderer root must not contain the configured sourceRoot.', {
    root,
    sourceRoot,
  });
}

/**
 * Rejects remount while a previous renderer-owned root remains quarantined.
 *
 * @param instance - Internal Tracker instance.
 */
function validateRendererQuarantineForMount(instance: TrackerInstance): void {
  const quarantined = QUARANTINED_RENDERER_ROOTS.get(instance);

  if (quarantined === undefined) {
    return;
  }

  const registry = getInternalDomRegistry(quarantined.root.ownerDocument);

  if (!quarantined.root.isConnected) {
    registry.retire(quarantined.root);
    QUARANTINED_RENDERER_ROOTS.delete(instance);
    return;
  }

  instance.diagnostics.warn(
    'WARN_TRACKER_RENDER_ROOT_QUARANTINED',
    'Tracker cannot remount while its previous renderer-owned root remains quarantined.',
    { root: quarantined.root },
  );
  throw createRendererContractError(
    instance,
    'Tracker cannot remount while its previous renderer-owned root remains quarantined.',
    { root: quarantined.root, quarantined: true },
  );
}

/**
 * Retries safe release of the single quarantined renderer-owned root.
 *
 * @param instance - Internal Tracker instance.
 * @param errors - Mutable cleanup error collection.
 */
function retryQuarantinedRendererRoot(instance: TrackerInstance, errors: unknown[]): void {
  const quarantined = QUARANTINED_RENDERER_ROOTS.get(instance);

  if (quarantined === undefined) {
    return;
  }

  const { root, host } = quarantined;
  const registry = getInternalDomRegistry(root.ownerDocument);

  const containment = root.isConnected ? probeRendererHostContainment(host, root, errors) : false;

  if (containment === true) {
    attemptCleanup(() => root.remove(), errors);
  }

  if (!root.isConnected) {
    attemptCleanup(() => registry.retire(root), errors);
    QUARANTINED_RENDERER_ROOTS.delete(instance);
    return;
  }

  attemptCleanup(() => registry.quarantine(root, 'render'), errors);
  errors.push(
    createRendererContractError(instance, 'Tracker renderer-owned root remained connected after final cleanup.', {
      root,
      quarantined: true,
    }),
  );
  QUARANTINED_RENDERER_ROOTS.delete(instance);
}

/**
 * Cleans one renderer mount cycle while retaining registry isolation until cleanup completes.
 *
 * @param instance - Internal Tracker instance.
 * @param root - Validated actual renderer root.
 * @param request - Normalized mount identities.
 */
function cleanupRendererMountCycle(
  instance: TrackerInstance,
  root: HTMLElement,
  request: TrackerNormalizedMountRequest,
): void {
  const errors: unknown[] = [];
  const registry = getInternalDomRegistry(request.document);

  restoreRootAttributes(instance, root, errors);
  attemptCleanup(() => instance.renderer.cleanupMountCycle(), errors);

  if (request.rendererTarget.kind === 'host' && root.isConnected && root !== request.rendererTarget.host) {
    const containment = probeRendererHostContainment(request.rendererTarget.host, root, errors);

    if (containment === true) {
      attemptCleanup(() => root.remove(), errors);
    }
  }

  if (!root.isConnected) {
    attemptCleanup(() => registry.retire(root), errors);
  } else if (request.rendererTarget.kind === 'root') {
    attemptCleanup(() => registry.release(root), errors);
  } else {
    attemptCleanup(() => registry.quarantine(root, 'render'), errors);
    QUARANTINED_RENDERER_ROOTS.set(instance, { root, host: request.rendererTarget.host });
    errors.push(
      createRendererContractError(instance, 'Tracker renderer-owned root remained connected after cleanup.', {
        root,
        quarantined: true,
      }),
    );
  }

  attemptCleanup(() => instance.renderer.clearMountCycle(), errors);
  throwCleanupErrors(errors, 'Tracker renderer mount-cycle cleanup failed.');
}

/**
 * Cleans a renderer cycle whose candidate never became registered output.
 *
 * @param instance - Internal Tracker instance.
 */
function cleanupUnregisteredRendererMountCycle(instance: TrackerInstance): void {
  const errors: unknown[] = [];

  attemptCleanup(() => instance.renderer.cleanupMountCycle(), errors);
  attemptCleanup(() => instance.renderer.clearMountCycle(), errors);
  throwCleanupErrors(errors, 'Tracker provisional renderer cleanup failed.');
}

/**
 * Drains cleanup records once in strict reverse acquisition order.
 *
 * @param cleanupStack - Mutable cleanup stack.
 * @returns Cleanup failures in execution order.
 */
function drainMountCleanupStack(cleanupStack: TrackerCleanupRecord[]): unknown[] {
  const errors: unknown[] = [];

  while (cleanupStack.length > 0) {
    const cleanup = cleanupStack.pop()!;
    attemptCleanup(cleanup.run, errors);
  }

  return errors;
}

/**
 * Resets all mount-cycle state after cleanup or rollback.
 *
 * @param instance - Internal Tracker instance.
 */
function resetMountedRuntimeState(instance: TrackerInstance): void {
  const previousSelectedKey = instance.interactionController.getSelectedKey();

  if (
    typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
    __RXT_TRACKER_DEBUG__ === true &&
    instance.diagnostics instanceof DebugDiagnostics
  ) {
    instance.diagnostics.updateClockWindow(null);
  }

  instance.runtimeContext = null;
  instance.stagedRuntimeContext = null;
  instance.stagedRules = null;
  instance.renderRecords = [];
  instance.renderRecordByKey = new Map();
  instance.interactionController.synchronizeSelection(previousSelectedKey);
  instance.dirtyRenderTarget = null;
  instance.mounted = false;
  instance.geometrySuspended = false;
}

/**
 * Creates a Window scroll context with the final fallback diagnostic contract.
 *
 * @param instance - Internal Tracker instance.
 * @param request - Normalized Window mount request.
 * @returns Window scroll context.
 */
function createWindowRuntimeScrollContext(
  instance: TrackerInstance,
  request: TrackerNormalizedMountRequest,
): WindowScrollContext {
  return new WindowScrollContext(request.window, {
    onAlignmentFallback: (resolution) => {
      instance.diagnostics.warn(
        'WARN_TRACKER_WINDOW_ALIGNMENT_FALLBACK',
        'Tracker used legacy Window alignment because the physical principal flow is unresolved.',
        {
          writingMode: resolution.writingMode,
          direction: resolution.direction,
          reason: resolution.reason,
        },
      );
    },
  });
}

/**
 * Validates the guaranteed element profile and creates the element scroll context.
 *
 * @param instance - Internal Tracker instance.
 * @param request - Normalized element mount request.
 * @returns Element scroll context.
 * @throws TrackerConfigurationError when the root is outside the guaranteed profile.
 */
function createElementRuntimeScrollContext(
  instance: TrackerInstance,
  request: TrackerNormalizedMountRequest,
): ElementScrollContext {
  const scrollRoot = request.scrollRoot as HTMLElement;
  const axis = getOrientationAxis(instance.options.orientation);
  const profile = validateElementScrollProfile(scrollRoot, axis);

  if (!profile.ok) {
    throw new TrackerConfigurationError(
      `Tracker element scroll root is outside the guaranteed CSS profile: ${profile.reason}.`,
      { code: 'ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT' },
    );
  }

  return new ElementScrollContext(scrollRoot, {
    onScrollPaddingFallback: ({ property, value }) => {
      instance.diagnostics.warn(
        'WARN_TRACKER_SCROLL_PADDING_FALLBACK',
        'Tracker scroll-padding value was unresolvable and fell back to 0 CSS px.',
        { property, value, scrollMode: 'element' },
      );
    },
  });
}

/**
 * Runs one atomic mount after request normalization and repeated-mount checks.
 *
 * @param instance - Internal Tracker instance.
 * @param request - Normalized mount request.
 * @param callbacks - Lifecycle callbacks.
 */
function performTrackerMount(
  instance: TrackerInstance,
  request: TrackerNormalizedMountRequest,
  callbacks: TrackerLifecycleCallbacks,
): void {
  const previousOptions = instance.options;
  const previousRendererOptions = instance.rendererOptions;
  const previousRules = instance.ruleStore.getAll();
  const previousRuleCounters = instance.diagnostics.getStats().rules;

  instance.lifecycleState = 'mounting';

  if (
    typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
    __RXT_TRACKER_DEBUG__ === true &&
    instance.diagnostics instanceof DebugDiagnostics
  ) {
    instance.diagnostics.trace('mount:start', { scrollMode: request.scrollMode });
  }

  beginTrackerRendererTransaction(instance.renderer);

  const cleanupStack: TrackerCleanupRecord[] = [];
  let stagedRules: ReturnType<TrackerInstance['ruleStore']['stageRevalidation']> | null = null;

  try {
    validateRendererQuarantineForMount(instance);
    const scrollContext =
      request.scrollMode === 'element'
        ? createElementRuntimeScrollContext(instance, request)
        : createWindowRuntimeScrollContext(instance, request);
    let rendererRootForCleanup: HTMLElement | null = null;
    const rendererContext: TrackerRendererMountContext = {
      target: request.rendererTarget,
      document: request.document,
      window: request.window,
      scrollMode: request.scrollMode,
    };

    instance.renderer.updateContext({
      diagnostics: instance.diagnostics,
      document: request.document,
      window: request.window,
      scrollMode: request.scrollMode,
    });
    if (
      typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
      __RXT_TRACKER_DEBUG__ === true &&
      instance.diagnostics instanceof DebugDiagnostics
    ) {
      instance.diagnostics.updateClockWindow(request.window);
    }
    cleanupStack.push({
      name: 'renderer-mount-cycle',
      run: () => {
        if (rendererRootForCleanup === null) {
          cleanupUnregisteredRendererMountCycle(instance);
          return;
        }

        cleanupRendererMountCycle(instance, rendererRootForCleanup, request);
      },
    });
    const provisionalRoot = instance.renderer.mountProvisional(rendererContext, instance.rendererOptions);

    if (provisionalRoot === null) {
      throw createRendererContractError(instance, 'Tracker renderer did not provide a mount root.');
    }

    const root = validateRendererRoot(instance, provisionalRoot, request);
    validateRendererRootOwnership(instance, root, request.sourceRoot);
    const registry = getInternalDomRegistry(request.document);

    if (!registry.register(root, 'render')) {
      throw createRendererContractError(instance, 'Tracker renderer root could not be registered in its document.');
    }

    rendererRootForCleanup = root;
    instance.renderer.commitRoot(root);
    const ownsMountView = updateTrackerRendererMount(
      instance.renderer,
      createTrackerMountView(true, request.scrollMode, true),
      instance.rendererOptions,
    );

    if (!ownsMountView) {
      captureRootAttributes(instance, root);
      root.setAttribute(DATA_ATTRIBUTES.SCROLL_MODE, request.scrollMode);
      root.setAttribute(DATA_ATTRIBUTES.GEOMETRY, 'available');
    }

    instance.geometrySuspended = false;

    const stagedRuntimeContext: TrackerRuntimeContext = {
      document: request.document,
      window: request.window,
      sourceRoot: request.sourceRoot,
      scrollRoot: request.scrollRoot,
      scrollMode: request.scrollMode,
      renderRoot: root,
      scrollContext,
    };

    instance.stagedRuntimeContext = stagedRuntimeContext;
    syncTrackerInstanceContexts(instance, callbacks);

    stagedRules = instance.ruleStore.stageRevalidation({ selectorRoot: request.sourceRoot });
    assertConfigurationDiagnostics(stagedRules.diagnostics, 'Tracker rules');
    instance.stagedRules = stagedRules.rules;

    const interactionRoot = getObservableTrackerRoot(instance.renderer);

    if (interactionRoot === null) {
      throw createRendererContractError(instance, 'Tracker renderer root was unavailable after provisional commit.');
    }

    cleanupStack.push({ name: 'interaction', run: () => instance.interactionController.disconnect() });
    instance.interactionController.connect(interactionRoot, instance.options);
    cleanupStack.push({ name: 'scheduler', run: () => instance.scheduler.cancel() });
    cleanupStack.push({ name: 'markers', run: () => instance.markerStore.clear() });

    instance.mounted = true;
    instance.dirtyRenderTarget = null;

    const publication = performTrackerInstanceRender(
      instance,
      RENDER_TARGETS.ALL,
      { scheduled: false, reasons: [{ source: 'mount' }] },
      { stagePublication: true, throwErrors: true },
    );

    if (publication === null) {
      throw new Error('Tracker initial render did not produce a commit publication.');
    }

    cleanupStack.push({ name: 'observers', run: () => instance.observerController.disconnect() });
    instance.observerController.connect(instance.options, 'mount');

    instance.rendererOptions = freezeRendererOptions(instance.options);
    instance.runtimeContext = stagedRuntimeContext;
    instance.stagedRuntimeContext = null;
    instance.stagedRules = null;
    instance.mountCleanupStack = cleanupStack;
    instance.lifecycleState = 'mounted';

    if (
      typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
      __RXT_TRACKER_DEBUG__ === true &&
      instance.diagnostics instanceof DebugDiagnostics
    ) {
      instance.diagnostics.trace('mount:commit', { scrollMode: request.scrollMode });
    }

    syncTrackerInstanceContexts(instance, callbacks);
    instance.ruleStore.commitStagedRevalidation(stagedRules);
    publishTrackerRenderPublication(instance, publication);
  } catch (error) {
    rollbackTrackerRendererTransaction(instance.renderer);
    const rollbackErrors = drainMountCleanupStack(cleanupStack);

    instance.mountCleanupStack = [];
    resetMountedRuntimeState(instance);
    instance.options = previousOptions;
    instance.rendererOptions = previousRendererOptions;
    attemptCleanup(() => instance.ruleStore.restoreSnapshot(previousRules), rollbackErrors);
    attemptCleanup(() => instance.diagnostics.restoreRuleCounters(previousRuleCounters), rollbackErrors);
    attemptCleanup(() => syncTrackerInstanceContexts(instance), rollbackErrors);
    instance.lifecycleState = 'unmounted';

    if (
      typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
      __RXT_TRACKER_DEBUG__ === true &&
      instance.diagnostics instanceof DebugDiagnostics
    ) {
      instance.diagnostics.trace('mount:rollback', { hadCleanupErrors: rollbackErrors.length > 0 });
    }

    instance.diagnostics.error('mount-failure', 'Tracker mount failed and was rolled back.', {
      error: getErrorMessage(error),
    });
    emitTrackerInstanceSnapshot(instance);

    if (rollbackErrors.length === 0) {
      throw error;
    }

    throw new AggregateError([error, ...rollbackErrors], 'Tracker mount failed and rollback did not complete cleanly.');
  }
}

/**
 * Validates one captured mount request and publishes a stable failure diagnostic.
 *
 * @param instance - Internal Tracker instance.
 * @param request - Call-time-captured mount request.
 */
function assertTrackerMountRequestIsValid(instance: TrackerInstance, request: TrackerIntegrationMountRequest): void {
  try {
    normalizeTrackerMountRequest(request);
  } catch (error) {
    instance.diagnostics.error('invalid-mount-context', 'Tracker mount request is invalid.', {
      error: getErrorMessage(error),
    });
    emitTrackerInstanceSnapshot(instance);
    throw error;
  }
}

/**
 * Mounts an internal Tracker instance from an explicit integration request.
 *
 * @param instance - Internal Tracker instance.
 * @param request - Explicit non-null mount request.
 * @param callbacks - Lifecycle callback overrides.
 */
function mountTrackerInstance(
  instance: TrackerInstance,
  request: TrackerIntegrationMountRequest,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  if (instance.lifecycleState === 'destroyed') {
    throw new TrackerLifecycleError('Cannot mount a destroyed Tracker.', {
      code: 'ERR_TRACKER_DESTROYED',
    });
  }

  // Captured once, here, so a caller mutating its own request object (or the
  // nested rendererTarget) after this call returns cannot change what actually
  // gets mounted once a queued mount runs later. DOM nodes, functions, and other
  // non-plain host objects keep their original identity; only the plain-object
  // request/rendererTarget containers are structurally copied.
  const capturedRequest = snapshotCallTimeInput(request);

  assertTrackerMountRequestIsValid(instance, capturedRequest);

  coordinateTrackerOperation(
    instance,
    'mount',
    () => {
      if (instance.lifecycleState === 'destroyed') {
        throw new TrackerLifecycleError('Cannot mount a destroyed Tracker.', {
          code: 'ERR_TRACKER_DESTROYED',
        });
      }

      // Re-validated here (not reused from the call-time check above) because this
      // operation body can run later, after being queued by coordinateTrackerOperation
      // while a public dispatch or another operation was in progress. DOM identities
      // (connectivity, realm, containment) may have changed during that delay. This
      // re-validates the call-time-captured identities, not the live caller-owned
      // request object, so a mutation made after mount() returned cannot substitute
      // a different mount target for the one that was actually accepted.
      const normalizedRequest = normalizeTrackerMountRequest(capturedRequest);

      if (instance.lifecycleState === 'mounted' && instance.runtimeContext !== null) {
        const sameContext = hasSameTrackerMountIdentity(
          normalizedRequest,
          instance.runtimeContext,
          instance.renderer.targetKind,
          instance.renderer.expectedTarget,
        );

        throw new TrackerLifecycleError(
          sameContext ? 'Tracker is already mounted.' : 'Tracker is already mounted with another context.',
          { code: 'ERR_TRACKER_ALREADY_MOUNTED' },
        );
      }

      const normalizedCallbacks = resolveTrackerLifecycleCallbacks(instance, callbacks);

      performTrackerMount(instance, normalizedRequest, normalizedCallbacks);
    },
    { deferredResult: undefined },
  );
}

/**
 * Unmounts an internal Tracker instance without destroying it permanently.
 *
 * @param instance - Internal Tracker instance.
 * @param options - Snapshot notification options.
 */
function unmountTrackerInstance(instance: TrackerInstance, options: TrackerUnmountOptions = {}): void {
  coordinateTrackerOperation(
    instance,
    'unmount',
    () => {
      if (instance.lifecycleState !== 'mounted') {
        return;
      }

      instance.lifecycleState = 'unmounting';
      beginTrackerRendererTransaction(instance.renderer);
      const cleanupErrors = drainMountCleanupStack(instance.mountCleanupStack);

      instance.mountCleanupStack = [];
      resetMountedRuntimeState(instance);
      attemptCleanup(() => syncTrackerInstanceContexts(instance), cleanupErrors);
      instance.lifecycleState = 'unmounted';

      if (
        typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
        __RXT_TRACKER_DEBUG__ === true &&
        instance.diagnostics instanceof DebugDiagnostics
      ) {
        instance.diagnostics.trace('unmount', { hadCleanupErrors: cleanupErrors.length > 0 });
      }

      attemptCleanup(() => commitTrackerUnmountProjection(instance), cleanupErrors);

      if (cleanupErrors.length > 0) {
        instance.diagnostics.error('unmount-cleanup-failure', 'Tracker unmount cleanup failed.', {
          errors: cleanupErrors.map(getErrorMessage),
        });
      }

      instance.snapshotStore?.refresh(instance);

      if (options?.emitSnapshot !== false) {
        emitTrackerInstanceSnapshot(instance);
      }

      throwCleanupErrors(cleanupErrors, 'Tracker unmount failed in one or more subsystems.');
    },
    { deferredResult: undefined, terminal: 'unmount' },
  );
}

/**
 * Permanently destroys an internal Tracker instance and all owned resources.
 *
 * @param instance - Internal Tracker instance.
 */
function destroyTrackerInstance(instance: TrackerInstance): void {
  coordinateTrackerOperation(
    instance,
    'destroy',
    () => {
      if (instance.lifecycleState === 'destroyed') {
        return;
      }

      instance.lifecycleState = 'destroying';
      beginTrackerRendererTransaction(instance.renderer);
      const cleanupErrors = drainMountCleanupStack(instance.mountCleanupStack);

      instance.mountCleanupStack = [];
      resetMountedRuntimeState(instance);
      attemptCleanup(() => syncTrackerInstanceContexts(instance), cleanupErrors);
      attemptCleanup(() => instance.renderer.destroy(), cleanupErrors);
      retryQuarantinedRendererRoot(instance, cleanupErrors);
      attemptCleanup(() => instance.observerController.destroy(), cleanupErrors);
      attemptCleanup(() => instance.interactionController.destroy(), cleanupErrors);
      attemptCleanup(() => instance.scheduler.destroy(), cleanupErrors);
      attemptCleanup(() => instance.ruleStore.destroy(), cleanupErrors);
      attemptCleanup(() => instance.queryEngine.destroy(), cleanupErrors);
      attemptCleanup(() => instance.markerStore.destroy(), cleanupErrors);
      attemptCleanup(() => instance.layoutEngine.destroy(), cleanupErrors);
      attemptCleanup(() => instance.clusterEngine.destroy(), cleanupErrors);

      if (cleanupErrors.length > 0) {
        instance.diagnostics.error('destroy-cleanup-failure', 'Tracker destroy cleanup failed.', {
          errors: cleanupErrors.map(getErrorMessage),
        });
      }

      instance.lifecycleCallbacks = normalizeTrackerLifecycleCallbacks();
      instance.mounted = false;
      instance.destroyed = true;
      instance.lifecycleState = 'destroyed';
      instance.finalStats = null;

      if (
        typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
        __RXT_TRACKER_DEBUG__ === true &&
        instance.diagnostics instanceof DebugDiagnostics
      ) {
        instance.diagnostics.trace('destroy', { hadCleanupErrors: cleanupErrors.length > 0 });
      }

      attemptCleanup(() => commitTrackerUnmountProjection(instance), cleanupErrors);

      instance.snapshotStore?.refresh(instance);

      instance.events.emit(EVENT_NAMES.DESTROY, {});
      instance.finalStats = createRetainedDiagnosticStats(instance.diagnostics.getStats());
      instance.snapshotStore?.emit(instance);
      instance.finalStats = createRetainedDiagnosticStats(instance.diagnostics.getStats());
      instance.snapshotStore?.refresh(instance);
      instance.events.destroy();
      instance.snapshotStore?.clear();
      instance.diagnostics.destroy();

      // The diagnostics output sink itself is not owned by Diagnostics#destroy();
      // release the last reference so a caller holding a stateful sink (a
      // buffer, socket, etc.) can rely on Tracker not keeping it alive.
      instance.options = { ...instance.options, diagnostics: { ...instance.options.diagnostics, output: null } };
      instance.rendererOptions = freezeRendererOptions(instance.options);

      throwCleanupErrors(cleanupErrors, 'Tracker destruction failed in one or more subsystems.');
    },
    { deferredResult: undefined, terminal: 'destroy' },
  );
}

export { assertTrackerMountRequestIsValid, destroyTrackerInstance, mountTrackerInstance, unmountTrackerInstance };
