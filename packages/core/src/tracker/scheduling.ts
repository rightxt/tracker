import type { TrackerInstance } from './createTrackerInstance.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { emitTrackerInstanceSnapshot } from './snapshotStore.js';

/**
 * Cancels pending scheduled render work for an internal Tracker instance.
 *
 * Deferred instead of applied immediately when called reentrantly during
 * another core operation or a lifecycle transition, so it cannot cancel a
 * render mid-mount/unmount/destroy and cannot publish a snapshot that mixes
 * committed and staged state.
 *
 * @param instance - Internal instance context.
 */
function cancelTrackerInstanceRender(instance: TrackerInstance): void {
  if (instance.destroyed) {
    return;
  }

  coordinateTrackerOperation(
    instance,
    'cancelRender',
    () => {
      instance.scheduler.cancel();
      instance.dirtyRenderTarget = null;
      emitTrackerInstanceSnapshot(instance);
    },
    { deferredResult: undefined },
  );
}

/**
 * Immediately runs pending scheduled render work for an internal Tracker instance,
 * without coordinator protection.
 *
 * Reserved for call sites that are themselves already the body of a coordinated
 * `render` operation (see {@link renderTrackerInstanceNow} in `rendering.ts`), where
 * running the flush synchronously and inline is the correct, required behavior —
 * not a reentrancy hazard to guard against. Advanced/external callers must use
 * {@link flushTrackerInstanceRender} instead.
 *
 * @param instance - Internal instance context.
 */
function flushTrackerInstanceRenderNow(instance: TrackerInstance): void {
  if (instance.destroyed) {
    return;
  }

  instance.scheduler.flush();
}

/**
 * Immediately runs pending scheduled render work for an internal Tracker instance.
 *
 * Deferred instead of applied immediately when called reentrantly during
 * another core operation or a lifecycle transition, for the same reason as
 * {@link cancelTrackerInstanceRender}: it cannot flush a render mid-mount/
 * unmount/destroy and cannot publish a snapshot that mixes committed and
 * staged state.
 *
 * @param instance - Internal instance context.
 */
function flushTrackerInstanceRender(instance: TrackerInstance): void {
  if (instance.destroyed) {
    return;
  }

  coordinateTrackerOperation(instance, 'flushRender', () => flushTrackerInstanceRenderNow(instance), {
    deferredResult: undefined,
  });
}

export { cancelTrackerInstanceRender, flushTrackerInstanceRender, flushTrackerInstanceRenderNow };
