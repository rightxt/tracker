import type { TrackerObserverTarget, TrackerObserverTargetsContext, TrackerResolvedOptions } from '../types.js';
import { ORIENTATIONS, PLACEMENTS } from '../constants.js';
import { cloneValue } from '../utils/object.js';

/**
 * Base default options without DOM-dependent values.
 *
 * This baseline is the sole source of the completeness guarantee expressed by
 * {@link TrackerResolvedOptions}: every branch resolution must produce is
 * declared here, so adding a required resolved field without a default here is
 * a compile-time error.
 *
 * DOM-dependent defaults must be resolved lazily by runtime controllers.
 */
const DEFAULT_OPTIONS: Readonly<TrackerResolvedOptions> = Object.freeze({
  a11y: {
    enabled: false,
    keyboard: false,
    label: 'Content tracker',
  },
  clustering: {
    enabled: true,
    threshold: 2,
  },
  cssVariables: {},
  diagnostics: {
    metrics: false,
    warnings: true,
  },
  interaction: {
    activation: true,
    drag: false,
  },
  marker: {
    attributes: {},
    className: '',
    title: true,
  },
  markerLayer: {
    className: '',
  },
  orientation: ORIENTATIONS.VERTICAL,
  placement: PLACEMENTS.LEFT,
  track: {
    className: '',
  },
  updates: {
    interval: {
      delay: 1000,
      enabled: false,
    },
    mutation: {
      debounce: 100,
      enabled: true,
      options: {
        attributes: false,
        characterData: false,
        childList: true,
        subtree: true,
      },
      targets: useDefaultObserverTargets,
    },
    resize: {
      debounce: 50,
      enabled: true,
      targets: useDefaultObserverTargets,
    },
    scroll: {
      enabled: true,
    },
  },
  viewport: {
    className: '',
    enabled: true,
  },
});

/**
 * Creates a fresh default options object.
 *
 * The returned object is safe to mutate by the caller. DOM-dependent observer
 * targets are resolver functions and are evaluated only by ObserverController
 * after mount context is available.
 *
 */
function createDefaultOptions(): TrackerResolvedOptions {
  return cloneValue(DEFAULT_OPTIONS);
}

/**
 * Returns observer default targets unchanged.
 *
 * The resolver receives lazy default targets from ObserverController. It does
 * not read DOM and does not modify the target list.
 */
function useDefaultObserverTargets({ defaultTargets }: TrackerObserverTargetsContext): TrackerObserverTarget[] {
  return defaultTargets;
}

export { createDefaultOptions };
