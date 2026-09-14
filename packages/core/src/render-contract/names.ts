import { CSS_PREFIX } from '../constants.js';
import type {
  TrackerClassNameConstants,
  TrackerCssVariableConstants,
  TrackerDataAttributeConstants,
} from '../types.js';

/** Component class names. */
const CLASS_NAMES: TrackerClassNameConstants = Object.freeze({
  ROOT: CSS_PREFIX,
  VIEWPORT: `${CSS_PREFIX}__viewport`,
  MARKERS: `${CSS_PREFIX}__markers`,
  MARKER: `${CSS_PREFIX}__marker`,
});

/** Component CSS custom property names. */
const CSS_VARIABLES: TrackerCssVariableConstants = Object.freeze({
  TRACK_THICKNESS: `--${CSS_PREFIX}-track-thickness`,
  TRACK_OFFSET: `--${CSS_PREFIX}-track-offset`,
  TRACK_START: `--${CSS_PREFIX}-track-start`,
  TRACK_END: `--${CSS_PREFIX}-track-end`,
  TRACK_BG: `--${CSS_PREFIX}-track-bg`,
  TRACK_BORDER_COLOR: `--${CSS_PREFIX}-track-border-color`,
  TRACK_BORDER_WIDTH: `--${CSS_PREFIX}-track-border-width`,
  TRACK_Z_INDEX: `--${CSS_PREFIX}-track-z-index`,
  TRACK_OVERFLOW: `--${CSS_PREFIX}-track-overflow`,
  TRACK_CONTAIN: `--${CSS_PREFIX}-track-contain`,

  VIEWPORT_BG: `--${CSS_PREFIX}-viewport-bg`,
  VIEWPORT_START: `--${CSS_PREFIX}-viewport-start`,
  VIEWPORT_SIZE: `--${CSS_PREFIX}-viewport-size`,

  MARKER_MIN_SIZE: `--${CSS_PREFIX}-marker-min-size`,
  MARKER_BG: `--${CSS_PREFIX}-marker-bg`,
  MARKER_RING_COLOR: `--${CSS_PREFIX}-marker-ring-color`,
  MARKER_RING_WIDTH: `--${CSS_PREFIX}-marker-ring-width`,
  MARKER_BORDER_RADIUS: `--${CSS_PREFIX}-marker-border-radius`,
  MARKER_OPACITY: `--${CSS_PREFIX}-marker-opacity`,
  MARKER_START: `--${CSS_PREFIX}-marker-start`,
  MARKER_SIZE: `--${CSS_PREFIX}-marker-size`,

  CLUSTER_BG: `--${CSS_PREFIX}-cluster-bg`,
  CLUSTER_FONT_SIZE: `--${CSS_PREFIX}-cluster-font-size`,
  CLUSTER_TEXT_COLOR: `--${CSS_PREFIX}-cluster-text-color`,
  CLUSTER_CONTENT: `--${CSS_PREFIX}-cluster-content`,

  FOCUS_OUTLINE_COLOR: `--${CSS_PREFIX}-focus-outline-color`,
  FOCUS_OUTLINE_WIDTH: `--${CSS_PREFIX}-focus-outline-width`,
  FOCUS_OUTLINE_OFFSET: `--${CSS_PREFIX}-focus-outline-offset`,
});

/** Component data attribute names. */
const DATA_ATTRIBUTES: TrackerDataAttributeConstants = Object.freeze({
  ORIENTATION: `data-${CSS_PREFIX}-orientation`,
  PLACEMENT: `data-${CSS_PREFIX}-placement`,
  DRAG: `data-${CSS_PREFIX}-drag`,
  SCROLL_MODE: `data-${CSS_PREFIX}-scroll-mode`,
  GEOMETRY: `data-${CSS_PREFIX}-geometry`,
  KIND: `data-${CSS_PREFIX}-kind`,
  COUNT: `data-${CSS_PREFIX}-count`,
  KEY: `data-${CSS_PREFIX}-key`,
  SELECTED: `data-${CSS_PREFIX}-selected`,
});

export { CLASS_NAMES, CSS_VARIABLES, DATA_ATTRIBUTES };
