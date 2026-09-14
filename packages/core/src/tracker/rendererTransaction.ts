import type { TrackerReadonlyOptions } from '../types.js';
import type { TrackerMountView } from './viewProjection.js';

/** Internal renderer transaction callbacks registered by first-party adapters. */
interface TrackerRendererTransactionHooks {
  /** Starts or nests a renderer publication transaction. */
  begin: () => void;
  /** Commits one transaction level and publishes only at the outer boundary. */
  commit: () => void;
  /** Discards all provisional renderer state. */
  rollback: () => void;
  /** Stages mount and geometry state without mutating a framework-owned root. */
  updateMount: (mount: TrackerMountView, options: TrackerReadonlyOptions) => void;
}

/** Transaction callbacks keyed by source and normalized renderer identities. */
const RENDERER_TRANSACTION_HOOKS = new WeakMap<object, TrackerRendererTransactionHooks>();

/**
 * Registers transaction callbacks for an internal first-party renderer.
 *
 * @param renderer - Source renderer identity.
 * @param hooks - Transaction callbacks.
 */
function registerTrackerRendererTransaction(renderer: object, hooks: TrackerRendererTransactionHooks): void {
  RENDERER_TRANSACTION_HOOKS.set(renderer, hooks);
}

/**
 * Copies internal transaction ownership from a source renderer to its facade.
 *
 * @param source - Source renderer identity.
 * @param facade - Normalized renderer facade.
 */
function linkTrackerRendererTransaction(source: object, facade: object): void {
  const hooks = RENDERER_TRANSACTION_HOOKS.get(source);

  if (hooks !== undefined) {
    RENDERER_TRANSACTION_HOOKS.set(facade, hooks);
  }
}

/** Starts an internal renderer transaction when the renderer supports one. */
function beginTrackerRendererTransaction(renderer: object): void {
  RENDERER_TRANSACTION_HOOKS.get(renderer)?.begin();
}

/** Commits an internal renderer transaction when the renderer supports one. */
function commitTrackerRendererTransaction(renderer: object): void {
  RENDERER_TRANSACTION_HOOKS.get(renderer)?.commit();
}

/** Rolls back all internal renderer staging when the renderer supports it. */
function rollbackTrackerRendererTransaction(renderer: object): void {
  RENDERER_TRANSACTION_HOOKS.get(renderer)?.rollback();
}

/**
 * Stages mount state for an internal renderer.
 *
 * @param renderer - Normalized renderer.
 * @param mount - Mount and geometry state.
 * @param options - Frozen renderer options.
 * @returns Whether the renderer owns mount attributes declaratively.
 */
function updateTrackerRendererMount(
  renderer: object,
  mount: TrackerMountView,
  options: TrackerReadonlyOptions,
): boolean {
  const hooks = RENDERER_TRANSACTION_HOOKS.get(renderer);

  if (hooks === undefined) {
    return false;
  }

  hooks.updateMount(mount, options);

  return true;
}

export type { TrackerRendererTransactionHooks };
export {
  beginTrackerRendererTransaction,
  commitTrackerRendererTransaction,
  linkTrackerRendererTransaction,
  registerTrackerRendererTransaction,
  rollbackTrackerRendererTransaction,
  updateTrackerRendererMount,
};
