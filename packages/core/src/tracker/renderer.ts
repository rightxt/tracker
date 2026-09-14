import { TrackerConfigurationError } from '../errors.js';
import type {
  TrackerDiagnosticsSink,
  TrackerReadonlyOptions,
  TrackerRenderer,
  TrackerRendererLike,
  TrackerRendererMountContext,
  TrackerRendererMountTarget,
} from '../types.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import { noop } from '../utils/function.js';
import { linkTrackerRendererTransaction } from './rendererTransaction.js';

/** Internal normalized facade with provisional lifecycle bookkeeping. */
interface InternalTrackerRenderer extends TrackerRenderer {
  /** Target kind captured for the active mount cycle. */
  readonly targetKind: TrackerRendererMountTarget['kind'];
  /** Expected host or root identity for the active mount cycle. */
  readonly expectedTarget: HTMLElement | null;
  /** Candidate returned by the source before core validation. */
  readonly provisionalRoot: HTMLElement | null;
  /** Whether a provisional or committed mount cycle still needs bookkeeping. */
  readonly hasActiveMountCycle: boolean;
  /** Invokes the source mount without publishing a bound root. */
  mountProvisional(context: TrackerRendererMountContext, options: TrackerReadonlyOptions): HTMLElement | null;
  /** Commits a root only after core validates and registers it. */
  commitRoot(root: HTMLElement): void;
  /** Consumes source cleanup at most once for the active cycle. */
  cleanupMountCycle(): void;
  /** Clears bound-root and target bookkeeping after registry transition. */
  clearMountCycle(): void;
}

/**
 * Creates a renderer placeholder that reports a configuration error when mounted.
 *
 * @param diagnostics - Diagnostics layer.
 * @returns Renderer placeholder.
 */
function createMissingTrackerRenderer(diagnostics: TrackerDiagnosticsSink | null): TrackerRendererLike {
  /** Reports the missing integration renderer. */
  const report = (): null => {
    diagnostics?.error?.('renderer-missing', 'Tracker renderer must be provided by the integration package.');

    return null;
  };

  return {
    root: null,
    viewportLayout: null,
    destroy: noop,
    mount: report,
    renderMarkerPresentation: noop,
    renderMarkers: noop,
    renderSelection: noop,
    renderTrack: noop,
    renderViewport: noop,
    unmount: noop,
    updateContext: noop,
  };
}

/**
 * Calls a renderer method with the original renderer as `this`.
 *
 * Asynchronous renderer hooks are not supported: a returned thenable is not
 * awaited, but a rejection is still routed to diagnostics instead of
 * escaping as an unhandled rejection.
 *
 * @param renderer - Source renderer.
 * @param methodName - Renderer method name.
 * @param fallback - Fallback method.
 * @param args - Method arguments.
 * @param diagnostics - Diagnostics layer used to report a rejected thenable.
 * @returns Method return value.
 */
function callRendererMethod(
  renderer: TrackerRendererLike,
  methodName: keyof TrackerRendererLike,
  fallback: (...args: unknown[]) => unknown,
  args: unknown[],
  diagnostics: TrackerDiagnosticsSink | null,
): unknown {
  const method = renderer[methodName];

  if (typeof method !== 'function') {
    return fallback(...args);
  }

  const result: unknown = (method as (...methodArgs: unknown[]) => unknown).apply(renderer, args);

  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    (result as PromiseLike<unknown>).then(undefined, (error: unknown) => {
      diagnostics?.warn?.(
        'renderer-hook-returned-thenable',
        `Tracker renderer hook "${String(methodName)}" returned a thenable; asynchronous renderer hooks are not supported and this rejection was not awaited.`,
        { error: getErrorMessage(error) },
      );
    });
  }

  return result;
}

/**
 * Creates a stable renderer-contract configuration error.
 *
 * @param message - Contract failure message.
 * @returns Renderer-contract error.
 */
function createRendererContractError(message: string): TrackerConfigurationError {
  return new TrackerConfigurationError(message, { code: 'ERR_TRACKER_RENDERER_CONTRACT' });
}

/**
 * Normalizes a partial custom renderer to the complete public renderer contract.
 *
 * Core additionally uses the same facade for provisional mount and explicit
 * commit so unvalidated output is never published as the active root.
 *
 * @param renderer - Partial integration renderer.
 * @param diagnostics - Diagnostics layer.
 * @returns Complete normalized renderer facade.
 */
function normalizeTrackerRenderer(
  renderer: TrackerRendererLike | null | undefined,
  diagnostics: TrackerDiagnosticsSink | null,
): TrackerRenderer {
  const source = renderer ?? createMissingTrackerRenderer(diagnostics);
  let activeMountCycle = false;
  let boundRoot: HTMLElement | null = null;
  let cleanupConsumed = true;
  let destroyed = false;
  let expectedTarget: HTMLElement | null = null;
  let provisionalRoot: HTMLElement | null = null;
  let sourceDestroyConsumedForCycle = false;
  let targetKind: TrackerRendererMountTarget['kind'] = 'host';

  /** Clears only per-mount facade state. */
  const clearMountCycle = (): void => {
    activeMountCycle = false;
    boundRoot = null;
    cleanupConsumed = true;
    expectedTarget = null;
    provisionalRoot = null;
  };

  /** Consumes the applicable source cleanup once. */
  const cleanupMountCycle = (): void => {
    if (!activeMountCycle || cleanupConsumed) {
      return;
    }

    cleanupConsumed = true;

    if (typeof source.unmount === 'function') {
      callRendererMethod(source, 'unmount', noop, [], diagnostics);
      return;
    }

    if (typeof source.destroy === 'function') {
      sourceDestroyConsumedForCycle = true;
      callRendererMethod(source, 'destroy', noop, [], diagnostics);
    }
  };

  const facade: InternalTrackerRenderer = {
    get root() {
      return boundRoot;
    },

    get viewportLayout() {
      return source.viewportLayout ?? null;
    },

    get targetKind() {
      return targetKind;
    },

    get expectedTarget() {
      return expectedTarget;
    },

    get provisionalRoot() {
      return provisionalRoot;
    },

    get hasActiveMountCycle() {
      return activeMountCycle;
    },

    cleanupMountCycle,

    clearMountCycle,

    commitRoot(root) {
      if (!activeMountCycle || expectedTarget === null) {
        throw createRendererContractError('Renderer root cannot be committed outside an active mount cycle.');
      }

      const exposedRoot = source.root ?? null;

      if (exposedRoot !== null && exposedRoot !== root) {
        diagnostics?.error?.(
          'renderer-contract-error',
          'Renderer returned a root that differs from its exposed root property.',
          { exposedRoot, root },
        );
        throw createRendererContractError('Renderer returned a root that differs from its exposed root property.');
      }

      boundRoot = root;
    },

    destroy() {
      if (destroyed) {
        return;
      }

      const cleanupErrors: unknown[] = [];

      try {
        cleanupMountCycle();
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        if (!sourceDestroyConsumedForCycle && typeof source.destroy === 'function') {
          sourceDestroyConsumedForCycle = true;
          callRendererMethod(source, 'destroy', noop, [], diagnostics);
        }
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        destroyed = true;
        clearMountCycle();
      }

      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      }

      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, 'Tracker renderer cleanup failed.');
      }
    },

    mount(context, options) {
      const root = facade.mountProvisional(context, options);

      if (root !== null) {
        facade.commitRoot(root);
      }

      return root;
    },

    mountProvisional(context, options) {
      if (destroyed) {
        return null;
      }

      if (activeMountCycle) {
        diagnostics?.warn?.('renderer-already-mounted', 'Tracker renderer is already mounted.');

        return boundRoot;
      }

      const target = context.target.kind === 'host' ? context.target.host : context.target.root;

      activeMountCycle = true;
      cleanupConsumed = false;
      expectedTarget = target;
      sourceDestroyConsumedForCycle = false;
      targetKind = context.target.kind;

      const candidate = callRendererMethod(
        source,
        'mount',
        () => null,
        [context, options],
        diagnostics,
      ) as HTMLElement | null;

      provisionalRoot = candidate;

      return candidate;
    },

    /**
     * Forwards borrowed read-only render data to the integration renderer.
     *
     * @param renderRecords - Core-owned records; integrations must not mutate the array or records.
     * @param options - Frozen renderer-facing options snapshot; see {@link TrackerRendererLike}.
     */
    renderMarkers(renderRecords, options, markerOptions) {
      callRendererMethod(source, 'renderMarkers', noop, [renderRecords, options, markerOptions], diagnostics);
    },

    renderMarkerPresentation(renderRecords, markerOptions) {
      callRendererMethod(source, 'renderMarkerPresentation', noop, [renderRecords, markerOptions], diagnostics);
    },

    renderSelection(previousKey, nextKey) {
      callRendererMethod(source, 'renderSelection', noop, [previousKey, nextKey], diagnostics);
    },

    renderTrack(options) {
      callRendererMethod(source, 'renderTrack', noop, [options], diagnostics);
    },

    renderViewport(viewportLayout, options) {
      callRendererMethod(source, 'renderViewport', noop, [viewportLayout, options], diagnostics);
    },

    unmount() {
      try {
        cleanupMountCycle();
      } finally {
        clearMountCycle();
      }
    },

    updateContext(context) {
      if (!destroyed) {
        callRendererMethod(source, 'updateContext', noop, [context], diagnostics);
      }
    },
  };

  linkTrackerRendererTransaction(source, facade);

  return facade;
}

export { normalizeTrackerRenderer };
export type { InternalTrackerRenderer };
