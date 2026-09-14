import type { TrackerOrientationConstants, TrackerPlacementConstants } from './types.js';

/** CSS namespace used by class names, data attributes and CSS custom properties. */
const CSS_PREFIX = 'rxtt';

/** Supported track orientations. */
const ORIENTATIONS: TrackerOrientationConstants = Object.freeze({
  VERTICAL: 'vertical',
  HORIZONTAL: 'horizontal',
});

/** Supported track placements. */
const PLACEMENTS: TrackerPlacementConstants = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  TOP: 'top',
  BOTTOM: 'bottom',
});

/** Supported scroll behavior values shared by scroll execution and rule validation. */
const SCROLL_BEHAVIORS: ReadonlyArray<string> = Object.freeze(['auto', 'smooth']);

/** Supported scroll block values shared by scroll execution and rule validation. */
const SCROLL_ALIGNS: ReadonlyArray<string> = Object.freeze(['start', 'center', 'end', 'nearest']);

export { CSS_PREFIX, ORIENTATIONS, PLACEMENTS, SCROLL_ALIGNS, SCROLL_BEHAVIORS };
