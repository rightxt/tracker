import { ORIENTATIONS, SCROLL_ALIGNS, SCROLL_BEHAVIORS } from '../constants.js';
import type { TrackerOrientation, TrackerScrollBehavior } from '../types.js';
import type {
  TrackerPhysicalAxis,
  TrackerScrollActivationOptions,
  TrackerScrollExecutionBehavior,
} from './scrollContext.js';

/**
 * Resolves the represented physical axis.
 *
 * @param orientation - Tracker orientation.
 * @returns X for horizontal, otherwise Y.
 */
function getOrientationAxis(orientation: TrackerOrientation): TrackerPhysicalAxis {
  return orientation === ORIENTATIONS.HORIZONTAL ? 'x' : 'y';
}

/**
 * Normalizes a finite non-negative metric.
 *
 * @param value - Metric candidate.
 * @returns Safe metric.
 */
function normalizeMetric(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Checks that iframe navigation has not replaced the captured DOM realm.
 *
 * @param document - Captured document.
 * @param window - Captured window.
 * @returns True while both realm identities remain mutually associated.
 */
function isActiveDocumentRealm(document: Document, window: Window): boolean {
  try {
    return window.document === document && document.defaultView === window;
  } catch {
    return false;
  }
}

/**
 * Normalizes the internal execution behavior.
 *
 * @param behavior - Behavior candidate.
 * @returns Supported native behavior.
 */
function normalizeExecutionBehavior(behavior: TrackerScrollExecutionBehavior): ScrollBehavior {
  if (behavior === 'instant') {
    return behavior;
  }

  return SCROLL_BEHAVIORS.includes(behavior) ? behavior : 'auto';
}

/**
 * Normalizes public activation behavior.
 *
 * @param behavior - Behavior candidate.
 * @returns Supported public behavior.
 */
function normalizeActivationBehavior(behavior: TrackerScrollBehavior): TrackerScrollBehavior {
  return SCROLL_BEHAVIORS.includes(behavior) ? behavior : 'auto';
}

/**
 * Normalizes represented-axis alignment.
 *
 * @param align - Alignment candidate.
 * @returns Supported physical alignment.
 */
function normalizeAlignment(align: TrackerScrollActivationOptions['align']): TrackerScrollActivationOptions['align'] {
  return SCROLL_ALIGNS.includes(align) ? align : 'start';
}

export {
  getOrientationAxis,
  isActiveDocumentRealm,
  normalizeActivationBehavior,
  normalizeAlignment,
  normalizeExecutionBehavior,
  normalizeMetric,
};
