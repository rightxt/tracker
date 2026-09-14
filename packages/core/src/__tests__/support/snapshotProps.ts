import { CLASS_NAMES, CSS_VARIABLES, DATA_ATTRIBUTES } from '../../render-contract/names.js';
import type { TrackerSnapshot, TrackerSnapshotItem } from '../../types.js';
import type {
  TrackerMarkerProps,
  TrackerMarkersProps,
  TrackerRootProps,
  TrackerSnapshotProps,
  TrackerViewportProps,
} from './types.js';
import { joinClassNames } from '../../utils/className.js';
import { isPlainObject } from '../../utils/object.js';
import { createCssValueMap, getPercentNumber, toPercent } from '../../utils/styleValue.js';

/**
 * Copies a plain object into a string map.
 *
 * @param map - Object map candidate.
 * @returns String map.
 */
function createStringMap(map: unknown): Record<string, string> {
  if (!isPlainObject(map)) {
    return {};
  }

  return Object.entries(map).reduce<Record<string, string>>((result, [name, value]) => {
    if (typeof name === 'string' && name !== '' && value != null) {
      result[name] = String(value);
    }

    return result;
  }, {});
}

/**
 * Creates framework-neutral props for the Tracker root element.
 *
 * @param snapshot - Tracker snapshot.
 * @returns Root props.
 */
function createTrackerRootProps(snapshot: TrackerSnapshot): TrackerRootProps {
  const a11yOptions = snapshot?.options?.a11y || {};
  const orientation = snapshot?.options?.orientation || 'vertical';
  const placement = snapshot?.options?.placement || 'right';
  const attributes: Record<string, string> = {
    [DATA_ATTRIBUTES.ORIENTATION]: orientation,
    [DATA_ATTRIBUTES.PLACEMENT]: placement,
  };

  if (a11yOptions.enabled === true) {
    attributes['aria-label'] = a11yOptions.label || 'Content tracker';

    if (snapshot?.selection?.enabled === true) {
      attributes.tabindex = '0';
    }
  } else {
    attributes['aria-hidden'] = 'true';
  }

  if (snapshot?.scrollMode != null) {
    attributes[DATA_ATTRIBUTES.SCROLL_MODE] = snapshot.scrollMode;
  }

  if (snapshot?.options?.interaction?.drag === true) {
    attributes[DATA_ATTRIBUTES.DRAG] = 'true';
  }

  attributes[DATA_ATTRIBUTES.GEOMETRY] =
    snapshot?.geometryAvailable === true ? 'available' : snapshot?.mounted === true ? 'suspended' : 'unavailable';

  if (snapshot?.geometryAvailable !== true) {
    attributes['aria-disabled'] = 'true';
  }

  return {
    className: joinClassNames(CLASS_NAMES.ROOT, snapshot?.options?.track?.className),
    attributes,
    orientation,
    placement,
    mounted: snapshot?.mounted === true,
    scrollMode: snapshot?.scrollMode ?? null,
    geometryAvailable: snapshot?.geometryAvailable === true,
    styleVars: createCssValueMap(snapshot?.options?.cssVariables),
  };
}

/**
 * Creates framework-neutral props for the marker layer element.
 *
 * @param snapshot - Optional Tracker snapshot.
 * @returns Marker layer props.
 */
function createTrackerMarkersProps(snapshot?: TrackerSnapshot): TrackerMarkersProps {
  return {
    className: joinClassNames(CLASS_NAMES.MARKERS, snapshot?.options?.markerLayer?.className),
    attributes: {},
    hidden: snapshot?.geometryAvailable !== true,
    styleVars: {},
  };
}

/**
 * Creates framework-neutral props for the viewport element.
 *
 * @param snapshot - Tracker snapshot.
 * @returns Viewport props.
 */
function createTrackerViewportProps(snapshot: TrackerSnapshot): TrackerViewportProps {
  const viewport = snapshot?.viewport || {};
  const styleVars: Record<string, string> = {};
  const hidden = snapshot?.geometryAvailable !== true || viewport.visible !== true;

  if (!hidden) {
    styleVars[CSS_VARIABLES.VIEWPORT_START] = toPercent(viewport.start);
    styleVars[CSS_VARIABLES.VIEWPORT_SIZE] = toPercent(viewport.size);
  }

  return {
    className: joinClassNames(CLASS_NAMES.VIEWPORT, snapshot?.options?.viewport?.className),
    attributes: {},
    enabled: snapshot?.options?.viewport?.enabled !== false,
    visible: viewport.visible === true,
    hidden,
    start: getPercentNumber(viewport.start),
    size: getPercentNumber(viewport.size),
    styleVars,
  };
}

/**
 * Creates framework-neutral props for a marker or cluster element.
 *
 * `title`/`className`/`attributes`/`styleVars` on `item` are already the
 * production `resolveMarkerPresentation()` output baked in by
 * `tracker/snapshot.ts`; this only reshapes those resolved fields and adds
 * prop-shape data (kind/key/count/selected) with no presentation-resolution
 * counterpart to diverge from.
 *
 * @param item - Marker or cluster snapshot item.
 * @returns Marker props.
 */
function createTrackerMarkerProps(item: TrackerSnapshotItem, selectedKey: string | null = null): TrackerMarkerProps {
  // Snapshot props still guard runtime input because this function is exported
  // through the renderer surface and may receive untyped JavaScript values.
  const d = item as unknown as Record<string, unknown>;
  const styleVars = createCssValueMap(d?.styleVars);

  styleVars[CSS_VARIABLES.MARKER_START] = toPercent(d?.start);
  styleVars[CSS_VARIABLES.MARKER_SIZE] = toPercent(d?.size);

  const attributes = createStringMap(d?.attributes);
  const selected = d?.key === selectedKey;

  attributes[DATA_ATTRIBUTES.KIND] = d?.kind === 'cluster' ? 'cluster' : 'marker';
  attributes[DATA_ATTRIBUTES.KEY] = String(d?.key || '');

  if (d?.kind === 'cluster' && Number.isInteger(d?.count)) {
    attributes[DATA_ATTRIBUTES.COUNT] = String(d.count);
  }

  if (selected) {
    attributes[DATA_ATTRIBUTES.SELECTED] = 'true';
  }

  if (d?.title != null && d.title !== '') {
    attributes.title = String(d.title);
  }

  return {
    key: String(d?.key || ''),
    activationKey: String(d?.key || ''),
    kind: d?.kind === 'marker' || d?.kind === 'cluster' ? (d.kind as 'marker' | 'cluster') : 'marker',
    ruleIndex: Number.isInteger(d?.ruleIndex) ? (d.ruleIndex as number) : null,
    selector: typeof d?.selector === 'string' ? d.selector : null,
    label: typeof d?.label === 'string' ? d.label : null,
    title: typeof d?.title === 'string' ? d.title : null,
    count: Number.isInteger(d?.count) ? (d.count as number) : null,
    markerKeys: Array.isArray(d?.markerKeys) ? (d.markerKeys as unknown[]).map(String) : [],
    primaryMarkerKey: typeof d?.primaryMarkerKey === 'string' ? d.primaryMarkerKey : null,
    selected,
    clustered: d?.clustered === true,
    clusterKey: typeof d?.clusterKey === 'string' ? d.clusterKey : null,
    interactive: d?.interactive === true,
    className: joinClassNames(CLASS_NAMES.MARKER, d?.className as string | undefined),
    attributes,
    styleVars,
  };
}

/**
 * Recursively freezes one detached snapshot-props graph.
 *
 * @param value - Value to freeze.
 * @returns Frozen value.
 */
function deepFreezeProps(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.values(value).forEach((entry) => {
    deepFreezeProps(entry);
  });

  return Object.freeze(value);
}

/**
 * Creates framework-neutral render props from a Tracker snapshot.
 *
 * @param snapshot - Tracker snapshot.
 * @returns Snapshot render props.
 */
function createTrackerSnapshotProps(snapshot: TrackerSnapshot): TrackerSnapshotProps {
  const selectedKey = snapshot?.selection?.key ?? null;
  const items = Array.isArray(snapshot?.items)
    ? snapshot.items.map((item) => createTrackerMarkerProps(item, selectedKey))
    : [];

  return deepFreezeProps({
    mounted: snapshot?.mounted === true,
    scrollMode: snapshot?.scrollMode ?? null,
    geometryAvailable: snapshot?.geometryAvailable === true,
    lifecycle: {
      mounted: snapshot?.lifecycle?.mounted === true,
      destroyed: snapshot?.lifecycle?.destroyed === true,
      hasRenderRoot: snapshot?.lifecycle?.hasRenderRoot === true,
    },
    render: {
      dirtyTarget: snapshot?.render?.dirtyTarget || null,
      pending: snapshot?.render?.pending === true,
      running: snapshot?.render?.running === true,
    },
    selection: {
      enabled: snapshot?.selection?.enabled === true,
      key: selectedKey,
    },
    root: createTrackerRootProps(snapshot),
    viewport: createTrackerViewportProps(snapshot),
    markersLayer: createTrackerMarkersProps(snapshot),
    items,
    markers: items.filter((item) => item.kind === 'marker'),
    clusters: items.filter((item) => item.kind === 'cluster'),
  }) as TrackerSnapshotProps;
}

export {
  createTrackerMarkerProps,
  createTrackerMarkersProps,
  createTrackerRootProps,
  createTrackerSnapshotProps,
  createTrackerViewportProps,
};
