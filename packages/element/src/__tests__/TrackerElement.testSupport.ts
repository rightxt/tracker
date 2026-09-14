import { TrackerElement } from '../TrackerElement.js';

/** Canonical service classes asserted by the Element adapter contract. */
const CLASS_NAMES = Object.freeze({
  MARKER: 'rxtt__marker',
  MARKERS: 'rxtt__markers',
  ROOT: 'rxtt',
  VIEWPORT: 'rxtt__viewport',
});

/** Committed option branches that normalization always produces. */
const COMMITTED_OPTION_BRANCHES = [
  'orientation',
  'placement',
  'cssVariables',
  'track',
  'viewport',
  'markerLayer',
  'marker',
  'clustering',
  'updates',
  'interaction',
  'a11y',
  'diagnostics',
] as const;

/**
 * Supplies the layout metrics required by the element-scroll profile validator.
 *
 * @param element - Element receiving deterministic layout metrics.
 */
function stubLayout(element: HTMLElement): void {
  element.getClientRects = () => [{}] as unknown as DOMRectList;
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 100 },
    clientWidth: { configurable: true, value: 100 },
  });
}

/**
 * @returns Configured test element.
 */
function createTrackerElement(): TrackerElement {
  return new TrackerElement();
}

customElements.define('rxt-tracker-contract-test', TrackerElement);

export { CLASS_NAMES, COMMITTED_OPTION_BRANCHES, TrackerElement, createTrackerElement, stubLayout };
