import type { TrackerSelectionRequest, TrackerSelectionTransition } from '../interaction/InteractionController.js';
import { EVENT_NAMES } from '../events/eventNames.js';
import { RENDER_TARGETS, mergeRenderTargets } from '../schedule/renderTargets.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import type { TrackerSelectionChangeEventPayload } from '../types.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { emitTrackerInstanceSnapshot } from './snapshotStore.js';
import {
  beginTrackerRendererTransaction,
  commitTrackerRendererTransaction,
  rollbackTrackerRendererTransaction,
} from './rendererTransaction.js';

/** Snapshot-publication owner for a committed logical selection transition. */
type TrackerSelectionPublicationOwner = 'selection' | 'enclosing';

/**
 * Builds the public `selection:change` payload for a committed key transition.
 *
 * @param transition - Committed key transition, or null when none occurred.
 * @returns Payload, or null when there is no transition or the key is unchanged.
 */
function buildTrackerSelectionChangeEventPayload(
  transition: TrackerSelectionTransition | null,
): TrackerSelectionChangeEventPayload | null {
  if (transition === null || transition.previousKey === transition.nextKey) {
    return null;
  }

  return { previousKey: transition.previousKey, selectedKey: transition.nextKey };
}

/**
 * Emits `selection:change` for a committed logical selection transition.
 *
 * No-op when there is no transition or the key is unchanged.
 *
 * @param instance - Internal Tracker instance.
 * @param transition - Committed key transition.
 */
function emitTrackerSelectionChangeEvent(
  instance: TrackerInstance,
  transition: TrackerSelectionTransition | null,
): void {
  const payload = buildTrackerSelectionChangeEventPayload(transition);

  if (payload !== null) {
    instance.events.emit(EVENT_NAMES.SELECTION_CHANGE, payload);
  }
}

/**
 * Synchronizes the renderer for a committed logical selection transition.
 *
 * @param instance - Internal Tracker instance.
 * @param transition - Committed key transition.
 * @param publicationOwner - Operation that owns snapshot publication.
 */
function performTrackerSelectionTransition(
  instance: TrackerInstance,
  transition: TrackerSelectionTransition | null,
  publicationOwner: TrackerSelectionPublicationOwner,
): void {
  if (transition === null || transition.previousKey === transition.nextKey) {
    return;
  }

  beginTrackerRendererTransaction(instance.renderer);

  try {
    instance.renderer.renderSelection(transition.previousKey, transition.nextKey);
    commitTrackerRendererTransaction(instance.renderer);
  } catch (error) {
    rollbackTrackerRendererTransaction(instance.renderer);
    instance.dirtyRenderTarget = mergeRenderTargets(instance.dirtyRenderTarget, RENDER_TARGETS.ALL);
    instance.diagnostics.warn('render-error', 'Tracker selection rendering failed.', {
      error: getErrorMessage(error),
    });
  }

  emitTrackerSelectionChangeEvent(instance, transition);

  if (publicationOwner === 'selection') {
    emitTrackerInstanceSnapshot(instance);
  }
}

/**
 * Reapplies the current logical selection after complete marker rendering.
 *
 * @param instance - Internal Tracker instance.
 */
function synchronizeTrackerRenderedSelection(instance: TrackerInstance): void {
  const currentKey = instance.interactionController.getSelectedKey();

  if (currentKey !== null) {
    instance.renderer.renderSelection(null, currentKey);
  }
}

/**
 * Coordinates one event-driven keyboard selection request.
 *
 * @param instance - Internal Tracker instance.
 * @param request - Navigation request.
 */
function coordinateTrackerSelectionRequest(instance: TrackerInstance, request: TrackerSelectionRequest): void {
  coordinateTrackerOperation(
    instance,
    'selection',
    () => {
      if (instance.lifecycleState !== 'mounted') {
        return;
      }

      const transition = instance.interactionController.commitSelectionRequest(request);

      performTrackerSelectionTransition(instance, transition, 'selection');
    },
    { deferredResult: undefined },
  );
}

export {
  buildTrackerSelectionChangeEventPayload,
  coordinateTrackerSelectionRequest,
  emitTrackerSelectionChangeEvent,
  performTrackerSelectionTransition,
  synchronizeTrackerRenderedSelection,
};
export type { TrackerSelectionPublicationOwner };
