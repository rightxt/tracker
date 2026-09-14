import type { TrackerSelectionTransition } from '../interaction/InteractionController.js';
import { DATA_ATTRIBUTES } from '../render-contract/names.js';
import { getOrientationAxis } from '../scroll/contextShared.js';
import { validateElementScrollProfile } from '../scroll/elementScrollProfile.js';
import type { TrackerMarkerDefaultsSnapshot, TrackerViewportLayoutRecord } from '../types.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { getActiveTrackerRuntimeContext } from './mountContext.js';
import { createTrackerMarkerDefaultsSnapshot } from './markerDefaultsSnapshot.js';
import { updateTrackerRendererMount } from './rendererTransaction.js';
import { createTrackerMountView } from './viewProjection.js';

/** Geometry state and any operation-scoped marker defaults materialized during suspension. */
interface TrackerGeometryRevalidationResult {
  state: TrackerGeometryRevalidationState;
  markerOptions?: TrackerMarkerDefaultsSnapshot | undefined;
  selectionTransition?: TrackerSelectionTransition | null;
}

/** Result of entering geometry suspension. */
interface TrackerGeometrySuspensionResult {
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined;
  selectionTransition: TrackerSelectionTransition | null;
}

/** Direct-renderer metadata captured before one geometry render attempt mutates it. */
interface TrackerGeometryMetadataRollbackState {
  /** Previous aria-disabled value. */
  ariaDisabled: string | null;
  /** Previous geometry attribute value. */
  geometry: string | null;
  /** Direct renderer root whose attributes were captured, or null when Projection owns metadata. */
  root: HTMLElement | null;
}

/** Element geometry state after one render-time revalidation. */
type TrackerGeometryRevalidationState = 'available' | 'suspended' | 'resumed';

/**
 * Creates a hidden viewport layout used while geometry is suspended.
 *
 * @param instance - Internal Tracker instance.
 * @returns Invisible viewport layout record.
 */
function createSuspendedViewportLayout(instance: TrackerInstance): TrackerViewportLayoutRecord {
  return {
    start: 0,
    end: 0,
    size: 0,
    visible: false,
    orientation: instance.options.orientation,
    source: {
      scrollOffset: 0,
      viewportSize: 0,
      contentSize: 0,
    },
  };
}

/**
 * Applies suspended-state metadata to the actual renderer root.
 *
 * @param instance - Internal Tracker instance.
 * @param suspended - Whether geometry is suspended.
 */
function applyGeometryRootMetadata(
  instance: TrackerInstance,
  suspended: boolean,
  rollbackState: TrackerGeometryMetadataRollbackState,
): void {
  const runtimeContext = getActiveTrackerRuntimeContext(instance);

  if (
    updateTrackerRendererMount(
      instance.renderer,
      createTrackerMountView(true, runtimeContext?.scrollMode ?? null, !suspended),
      instance.rendererOptions,
    )
  ) {
    return;
  }

  const root = instance.renderer.root;

  if (root === null) {
    return;
  }

  if (rollbackState.root === null) {
    const geometry = root.getAttribute(DATA_ATTRIBUTES.GEOMETRY);
    const ariaDisabled = root.getAttribute('aria-disabled');

    rollbackState.root = root;
    rollbackState.geometry = geometry;
    rollbackState.ariaDisabled = ariaDisabled;
  }

  if (suspended) {
    root.setAttribute(DATA_ATTRIBUTES.GEOMETRY, 'suspended');
    root.setAttribute('aria-disabled', 'true');
    return;
  }

  root.setAttribute(DATA_ATTRIBUTES.GEOMETRY, 'available');
  const previousAriaDisabled = instance.rootAttributeSnapshot?.get('aria-disabled') ?? null;

  if (previousAriaDisabled === null) {
    root.removeAttribute('aria-disabled');
  } else {
    root.setAttribute('aria-disabled', previousAriaDisabled);
  }
}

/**
 * Enters geometry suspension: clears published geometry and hides output.
 *
 * The marker layer and viewport indicator are cleared in the renderer, public
 * render records are emptied, and one deduplicated diagnostic is recorded.
 * Observers stay connected so the next configured invalidation can revalidate.
 *
 * @param instance - Internal Tracker instance.
 * @param reason - Stable profile violation reason.
 */
function enterGeometrySuspension(
  instance: TrackerInstance,
  reason: string,
  rollbackState: TrackerGeometryMetadataRollbackState,
): TrackerGeometrySuspensionResult {
  const previousSelectedKey = instance.interactionController.getSelectedKey();

  instance.geometrySuspended = true;
  instance.renderRecords = [];
  instance.renderRecordByKey = new Map();
  instance.markerStore.clear();
  const selectionTransition = instance.interactionController.synchronizeSelection(previousSelectedKey);
  const markerOptions = createTrackerMarkerDefaultsSnapshot(instance.options.marker);

  applyGeometryRootMetadata(instance, true, rollbackState);
  instance.renderer.renderMarkers([], instance.rendererOptions, markerOptions);
  instance.renderer.renderViewport(createSuspendedViewportLayout(instance), instance.rendererOptions);
  instance.diagnostics.warn(
    'WARN_TRACKER_GEOMETRY_SUSPENDED',
    'Tracker element scroll root left the supported geometry profile. Geometry output is suspended.',
    { scrollMode: 'element', reason },
  );

  return { markerOptions, selectionTransition };
}

/**
 * Revalidates the element geometry profile at render time.
 *
 * Window mode is always `available`. In element mode a profile violation
 * enters (or keeps) suspension without throwing from scheduler callbacks, and
 * detectable recovery reports `resumed` so the caller performs one full
 * query/layout/render before publishing geometry again.
 *
 * @param instance - Internal Tracker instance.
 * @returns Geometry state for the current render pass.
 */
function revalidateTrackerGeometry(
  instance: TrackerInstance,
  rollbackState: TrackerGeometryMetadataRollbackState,
): TrackerGeometryRevalidationResult {
  const runtimeContext = getActiveTrackerRuntimeContext(instance);

  if (runtimeContext === null || runtimeContext.scrollMode !== 'element') {
    return { state: 'available' };
  }

  const axis = getOrientationAxis(instance.options.orientation);
  const profile = validateElementScrollProfile(runtimeContext.scrollRoot as HTMLElement, axis);

  if (profile.ok) {
    if (!instance.geometrySuspended) {
      return { state: 'available' };
    }

    instance.geometrySuspended = false;
    applyGeometryRootMetadata(instance, false, rollbackState);

    return { state: 'resumed' };
  }

  if (!instance.geometrySuspended) {
    const { markerOptions, selectionTransition } = enterGeometrySuspension(instance, profile.reason, rollbackState);

    return { state: 'suspended', markerOptions, selectionTransition };
  }

  return { state: 'suspended' };
}

/**
 * Creates an inactive direct-metadata rollback token for one render attempt.
 *
 * @returns Empty rollback token.
 */
function createTrackerGeometryMetadataRollbackState(): TrackerGeometryMetadataRollbackState {
  return { ariaDisabled: null, geometry: null, root: null };
}

/**
 * Restores direct-renderer metadata captured by a failed geometry render.
 *
 * Projection renderers leave the token inactive because their metadata is
 * restored by the renderer transaction itself.
 *
 * @param rollbackState - Render-attempt metadata token.
 * @returns Attribute restoration failures in execution order.
 */
function restoreTrackerGeometryRootMetadata(rollbackState: TrackerGeometryMetadataRollbackState): unknown[] {
  const { ariaDisabled, geometry, root } = rollbackState;
  const errors: unknown[] = [];

  if (root === null) {
    return errors;
  }

  const restoreAttribute = (name: string, value: string | null): void => {
    try {
      if (value === null) {
        root.removeAttribute(name);
      } else {
        root.setAttribute(name, value);
      }
    } catch (error) {
      errors.push(error);
    }
  };

  restoreAttribute(DATA_ATTRIBUTES.GEOMETRY, geometry);
  restoreAttribute('aria-disabled', ariaDisabled);

  return errors;
}

export { createTrackerGeometryMetadataRollbackState, restoreTrackerGeometryRootMetadata, revalidateTrackerGeometry };
export type {
  TrackerGeometryMetadataRollbackState,
  TrackerGeometryRevalidationResult,
  TrackerGeometryRevalidationState,
};
