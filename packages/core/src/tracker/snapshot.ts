import { isActivationEnabled, isKeyboardAccessibilityEnabled } from '../config/interactionOptions.js';
import { resolveMarkerPresentation } from '../markers/resolveMarkerPresentation.js';
import { CLASS_NAMES, CSS_VARIABLES, DATA_ATTRIBUTES } from '../render-contract/names.js';
import type {
  TrackerClusterSnapshot,
  TrackerLifecycleSnapshot,
  TrackerMarkerDefaultsSnapshot,
  TrackerMarkerSnapshot,
  TrackerRenderRecord,
  TrackerRenderSnapshot,
  TrackerResolvedOptions,
  TrackerSnapshot,
  TrackerSnapshotItem,
  TrackerStats,
  TrackerViewportLayoutRecord,
  TrackerViewportSnapshot,
} from '../types.js';
import { cloneValue } from '../utils/object.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { getTrackerInstanceStats } from './instanceStats.js';
import { getPrimaryMarkerRecord } from './renderRecords.js';
import { createTrackerMarkerDefaultsSnapshot } from './markerDefaultsSnapshot.js';

/**
 * Freezes a plain snapshot object deeply enough for renderer-facing data.
 *
 * @param value - Value to freeze.
 * @returns Frozen value.
 */
function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.values(value).forEach((item) => {
    deepFreeze(item);
  });

  return Object.freeze(value);
}

/**
 * Creates a marker snapshot item.
 *
 * @param record - Marker render record.
 * @param markerOptions - Retained marker presentation defaults.
 * @param interactive - Whether marker activation is enabled.
 * @returns Marker snapshot item.
 */
function createMarkerSnapshot(
  record: import('../types.js').TrackerMarkerRenderRecord,
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  interactive: boolean,
): TrackerMarkerSnapshot {
  const { marker } = record;
  const presentation = resolveMarkerPresentation(markerOptions, record);

  return {
    kind: 'marker',
    key: record.key,
    ruleIndex: marker.ruleIndex,
    selector: marker.selector,
    label: marker.label,
    title: presentation.title,
    className: presentation.className,
    attributes: cloneValue(presentation.attributes),
    styleVars: cloneValue(presentation.cssVariables),
    start: record.start,
    size: record.size,
    clustered: false,
    clusterKey: null,
    interactive,
  };
}

/**
 * Creates a cluster snapshot item.
 *
 * @param record - Cluster render record.
 * @param markerOptions - Retained marker presentation defaults.
 * @param interactive - Whether cluster activation is enabled.
 * @returns Cluster snapshot item.
 */
function createClusterSnapshot(
  record: import('../types.js').TrackerClusterRenderRecord,
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  interactive: boolean,
): TrackerClusterSnapshot {
  const marker = getPrimaryMarkerRecord(record);
  const presentation = resolveMarkerPresentation(markerOptions, record);

  return {
    kind: 'cluster',
    key: record.key,
    count: record.count,
    markerKeys: record.markers.map((item) => item.key),
    primaryMarkerKey: record.primaryMarker?.key || null,
    label: marker?.label ?? null,
    title: presentation.title,
    className: presentation.className,
    attributes: cloneValue(presentation.attributes),
    styleVars: cloneValue(presentation.cssVariables),
    start: record.start,
    size: record.size,
    interactive,
  };
}

/**
 * Creates a marker or cluster snapshot item from a render record.
 *
 * @param record - Marker or cluster render record.
 * @param markerOptions - Retained marker presentation defaults.
 * @param interactive - Whether marker/cluster activation is enabled.
 * @returns Snapshot item or null for unknown records.
 */
function createRenderItemSnapshot(
  record: TrackerRenderRecord,
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  interactive: boolean,
): TrackerSnapshotItem | null {
  if (record?.kind === 'marker') {
    return createMarkerSnapshot(record, markerOptions, interactive);
  }

  if (record?.kind === 'cluster') {
    return createClusterSnapshot(record, markerOptions, interactive);
  }

  return null;
}

/**
 * Creates viewport metadata for renderers.
 *
 * @param viewportLayout - Last viewport layout when available.
 * @param options - Committed options.
 * @returns Viewport snapshot.
 */
function createViewportSnapshot(
  viewportLayout: TrackerViewportLayoutRecord | null,
  options: TrackerResolvedOptions,
): TrackerViewportSnapshot {
  const visible = options.viewport.enabled && viewportLayout?.visible === true;

  return {
    visible,
    start: visible ? viewportLayout!.start : 0,
    size: visible ? viewportLayout!.size : 0,
  };
}

/**
 * Creates render scheduling metadata.
 *
 * @param instance - Internal instance context.
 * @returns Render state snapshot.
 */
function createRenderSnapshot(instance: TrackerInstance): TrackerRenderSnapshot {
  return {
    dirtyTarget: instance.dirtyRenderTarget,
    pending: Boolean(instance.scheduler?.pending),
    running: Boolean(instance.scheduler?.running),
  };
}

/**
 * Creates lifecycle metadata without exposing DOM object references.
 *
 * @param instance - Internal instance context.
 * @returns Lifecycle state snapshot.
 */
function createLifecycleSnapshot(instance: TrackerInstance): TrackerLifecycleSnapshot {
  return {
    mounted: instance.lifecycleState === 'mounted',
    destroyed: instance.destroyed,
    hasRenderRoot:
      instance.mounted &&
      instance.runtimeContext !== null &&
      instance.renderer?.root === instance.runtimeContext.renderRoot,
  };
}

/**
 * Creates a renderer-facing immutable Tracker snapshot.
 *
 * @param instance - Internal instance context.
 * @param retainedMarkerOptions - Marker defaults captured by the publishing render.
 * @param committedViewportLayout - Core-owned viewport layout captured by the publishing render.
 * @returns Tracker snapshot.
 */
function createTrackerInstanceSnapshot(
  instance: TrackerInstance,
  retainedMarkerOptions?: TrackerMarkerDefaultsSnapshot,
  committedViewportLayout?: TrackerViewportLayoutRecord,
): TrackerSnapshot {
  const options = instance.options;
  const markerOptions = retainedMarkerOptions ?? createTrackerMarkerDefaultsSnapshot(options.marker);
  const scrollMode = instance.runtimeContext?.scrollMode ?? null;
  const geometryAvailable = instance.mounted && instance.runtimeContext !== null && !instance.geometrySuspended;
  const records = geometryAvailable && Array.isArray(instance.renderRecords) ? instance.renderRecords : [];
  const interactive = isActivationEnabled(options);
  const items = records
    .map((record) => createRenderItemSnapshot(record, markerOptions, interactive))
    .filter((item): item is TrackerSnapshotItem => item !== null);
  const markers = items.filter((item): item is TrackerMarkerSnapshot => item.kind === 'marker');
  const clusters = items.filter((item): item is TrackerClusterSnapshot => item.kind === 'cluster');
  const viewportLayout = geometryAvailable ? (committedViewportLayout ?? null) : null;
  const stats: TrackerStats = getTrackerInstanceStats(instance);
  const snapshot: TrackerSnapshot = {
    mounted: instance.lifecycleState === 'mounted',
    scrollMode,
    geometryAvailable,
    lifecycle: createLifecycleSnapshot(instance),
    options: {
      orientation: options.orientation,
      placement: options.placement,
      cssVariables: Object.entries(options.cssVariables).reduce<Record<string, string>>((variables, [name, value]) => {
        if (typeof value === 'string') {
          variables[name] = value;
        }

        return variables;
      }, {}),
      track: cloneValue(options.track),
      viewport: cloneValue(options.viewport),
      markerLayer: cloneValue(options.markerLayer),
      marker: markerOptions,
      clustering: cloneValue(options.clustering),
      interaction: cloneValue(options.interaction),
      a11y: cloneValue(options.a11y),
    },
    classes: CLASS_NAMES,
    dataAttributes: DATA_ATTRIBUTES,
    cssVariables: CSS_VARIABLES,
    render: createRenderSnapshot(instance),
    selection: {
      enabled: isKeyboardAccessibilityEnabled(options),
      key: instance.interactionController.getSelectedKey(),
    },
    viewport: createViewportSnapshot(viewportLayout, options),
    items,
    markers,
    clusters,
    diagnostics: stats,
  };

  return deepFreeze(snapshot) as TrackerSnapshot;
}

export { createTrackerInstanceSnapshot };
