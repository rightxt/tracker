import type { TrackerOptions, TrackerOrientation, TrackerPlacement } from '../types.js';
import { ORIENTATIONS, PLACEMENTS } from '../constants.js';

/**
 * Returns `horizontal` only when `options.orientation` is `horizontal`; otherwise returns `vertical`.
 *
 * @param options - Tracker options.
 */
function getOrientation(options: Partial<TrackerOptions> = {}): TrackerOrientation {
  return options?.orientation === ORIENTATIONS.HORIZONTAL ? ORIENTATIONS.HORIZONTAL : ORIENTATIONS.VERTICAL;
}

/**
 * Returns a placement compatible with the resolved orientation, falling back to `top` for horizontal and `left` for vertical.
 *
 * @param options - Tracker options.
 */
function getPlacement(options: Partial<TrackerOptions> = {}): TrackerPlacement {
  const orientation = getOrientation(options);
  const placement = options?.placement;

  if (orientation === ORIENTATIONS.HORIZONTAL) {
    return placement === PLACEMENTS.BOTTOM ? PLACEMENTS.BOTTOM : PLACEMENTS.TOP;
  }

  return placement === PLACEMENTS.RIGHT ? PLACEMENTS.RIGHT : PLACEMENTS.LEFT;
}

export { getOrientation, getPlacement };
