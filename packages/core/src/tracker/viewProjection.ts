import { isKeyboardAccessibilityEnabled } from '../config/interactionOptions.js';
import { resolveMarkerPresentation } from '../markers/resolveMarkerPresentation.js';
import { CLASS_NAMES, CSS_VARIABLES, DATA_ATTRIBUTES } from '../render-contract/names.js';
import type {
  TrackerMarkerDefaultsSnapshot,
  TrackerReadonlyOptions,
  TrackerRenderRecord,
  TrackerScrollMode,
  TrackerViewportLayoutRecord,
} from '../types.js';
import { joinClassNames } from '../utils/className.js';
import { createCssValueMap, toPercent } from '../utils/styleValue.js';

/** Minimal immutable web-element presentation consumed by framework renderers. */
interface TrackerElementView {
  readonly className: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly styleVars: Readonly<Record<string, string>>;
}

/** Minimal root and marker-layer data updated as one chrome domain. */
interface TrackerChromeView {
  readonly root: TrackerElementView;
  readonly markersLayer: TrackerElementView & { readonly hidden: boolean };
}

/** Minimal keyed marker or cluster presentation used for declarative DOM rendering. */
interface TrackerItemView extends TrackerElementView {
  readonly key: string;
}

/** Lifecycle and geometry fields needed by visual projections. */
interface TrackerMountView {
  readonly mounted: boolean;
  readonly scrollMode: TrackerScrollMode | null;
  readonly geometryAvailable: boolean;
}

/** Key transition owned by the isolated selection domain. */
interface TrackerSelectionView {
  readonly previousKey: string | null;
  readonly selectedKey: string | null;
}

/** Minimal viewport data updated independently from item structure. */
interface TrackerViewportView extends TrackerElementView {
  readonly hidden: boolean;
}

/** Shared immutable empty item view used while geometry is unavailable. */
const EMPTY_ITEM_VIEWS: readonly TrackerItemView[] = Object.freeze([]);

/**
 * Freezes one detached element view and its mutable maps.
 *
 * @param view - Detached element view.
 * @returns Immutable element view.
 */
function freezeElementView<TView extends TrackerElementView>(view: TView): TView {
  Object.freeze(view.attributes);
  Object.freeze(view.styleVars);

  return Object.freeze(view);
}

/**
 * Creates immutable mount state for projection functions.
 *
 * @param mounted - Whether Core has committed a mount.
 * @param scrollMode - Active scroll mode.
 * @param geometryAvailable - Whether visual geometry may be rendered.
 * @returns Mount view.
 */
function createTrackerMountView(
  mounted: boolean,
  scrollMode: TrackerScrollMode | null,
  geometryAvailable: boolean,
): TrackerMountView {
  return Object.freeze({ geometryAvailable, mounted, scrollMode });
}

/**
 * Projects configuration and mount state into root and marker-layer views.
 *
 * @param options - Frozen renderer options.
 * @param mount - Current mount view.
 * @returns Chrome view.
 */
function projectTrackerChromeView(options: TrackerReadonlyOptions, mount: TrackerMountView): TrackerChromeView {
  const attributes: Record<string, string> = {
    [DATA_ATTRIBUTES.ORIENTATION]: options.orientation,
    [DATA_ATTRIBUTES.PLACEMENT]: options.placement,
  };

  if (options.a11y.enabled) {
    attributes['aria-label'] = options.a11y.label || 'Content tracker';

    if (isKeyboardAccessibilityEnabled(options)) {
      attributes.tabindex = '0';
    }
  } else {
    attributes['aria-hidden'] = 'true';
  }

  if (mount.scrollMode !== null) {
    attributes[DATA_ATTRIBUTES.SCROLL_MODE] = mount.scrollMode;
  }

  if (options.interaction.drag) {
    attributes[DATA_ATTRIBUTES.DRAG] = 'true';
  }

  attributes[DATA_ATTRIBUTES.GEOMETRY] = mount.geometryAvailable
    ? 'available'
    : mount.mounted
      ? 'suspended'
      : 'unavailable';

  if (!mount.geometryAvailable) {
    attributes['aria-disabled'] = 'true';
  }

  const root = freezeElementView({
    attributes,
    className: joinClassNames(CLASS_NAMES.ROOT, options.track.className),
    styleVars: createCssValueMap(options.cssVariables),
  });
  const markersLayer = freezeElementView({
    attributes: {},
    className: joinClassNames(CLASS_NAMES.MARKERS, options.markerLayer.className),
    hidden: !mount.geometryAvailable,
    styleVars: {},
  });

  return Object.freeze({ markersLayer, root });
}

/**
 * Projects one render record into minimal framework-owned DOM data.
 *
 * Selection is deliberately absent because it is an independent keyed domain.
 *
 * @param record - Marker or cluster render record.
 * @param markerOptions - Retained marker presentation defaults.
 * @returns Item view.
 */
function projectTrackerItemView(
  record: TrackerRenderRecord,
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
): TrackerItemView {
  const presentation = resolveMarkerPresentation(markerOptions, record);
  const attributes = { ...presentation.attributes };
  const styleVars = { ...presentation.cssVariables };

  attributes[DATA_ATTRIBUTES.KIND] = record.kind;
  attributes[DATA_ATTRIBUTES.KEY] = record.key;

  if (record.kind === 'cluster') {
    attributes[DATA_ATTRIBUTES.COUNT] = String(record.count);
  }

  if (presentation.title !== null && presentation.title !== '') {
    attributes.title = presentation.title;
  }

  styleVars[CSS_VARIABLES.MARKER_START] = toPercent(record.start);
  styleVars[CSS_VARIABLES.MARKER_SIZE] = toPercent(record.size);

  return freezeElementView({
    attributes,
    className: joinClassNames(CLASS_NAMES.MARKER, presentation.className),
    key: record.key,
    styleVars,
  });
}

/**
 * Projects ordered render records without creating observation-only metadata.
 *
 * @param records - Borrowed Core render records.
 * @param markerOptions - Retained marker presentation defaults.
 * @param geometryAvailable - Whether item output may be rendered.
 * @returns Immutable item views.
 */
function projectTrackerItemViews(
  records: readonly TrackerRenderRecord[],
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  geometryAvailable: boolean,
): readonly TrackerItemView[] {
  if (!geometryAvailable) {
    return EMPTY_ITEM_VIEWS;
  }

  return Object.freeze(records.map((record) => projectTrackerItemView(record, markerOptions)));
}

/**
 * Creates the isolated selection transition delivered by Core.
 *
 * @param previousKey - Previously selected render key.
 * @param selectedKey - Newly selected render key.
 * @returns Selection view.
 */
function projectTrackerSelectionView(previousKey: string | null, selectedKey: string | null): TrackerSelectionView {
  return Object.freeze({ previousKey, selectedKey });
}

/**
 * Projects viewport layout independently from item and chrome data.
 *
 * @param viewportLayout - Last viewport layout record.
 * @param options - Frozen renderer options.
 * @param geometryAvailable - Whether visual geometry may be rendered.
 * @returns Viewport view.
 */
function projectTrackerViewportView(
  viewportLayout: TrackerViewportLayoutRecord | null,
  options: TrackerReadonlyOptions,
  geometryAvailable: boolean,
): TrackerViewportView {
  const visible = geometryAvailable && options.viewport.enabled && viewportLayout?.visible === true;
  const styleVars: Record<string, string> = {};

  if (visible) {
    styleVars[CSS_VARIABLES.VIEWPORT_START] = toPercent(viewportLayout.start);
    styleVars[CSS_VARIABLES.VIEWPORT_SIZE] = toPercent(viewportLayout.size);
  }

  return freezeElementView({
    attributes: {},
    className: joinClassNames(CLASS_NAMES.VIEWPORT, options.viewport.className),
    hidden: !visible,
    styleVars,
  });
}

export type {
  TrackerChromeView,
  TrackerElementView,
  TrackerItemView,
  TrackerMountView,
  TrackerSelectionView,
  TrackerViewportView,
};
export {
  createTrackerMountView,
  projectTrackerChromeView,
  projectTrackerItemView,
  projectTrackerItemViews,
  projectTrackerSelectionView,
  projectTrackerViewportView,
};
