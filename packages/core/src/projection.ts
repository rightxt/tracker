// First-party projection adapter contract.
//
// This entrypoint contains the declarative web-presentation runtime and pure
// element-view helpers used by the official Element, React, Vue and Angular
// packages. Concrete DOM reconciliation remains owned by those packages.
export { DATA_ATTRIBUTES } from './render-contract/names.js';
export { createTrackerProjectionIntegration } from './tracker/projectionIntegration.js';
export { projectTrackerChromeView } from './tracker/viewProjection.js';

export type { TrackerProjectionIntegration, TrackerProjectionMountRequest } from './tracker/projectionIntegration.js';
export type {
  TrackerProjectionCommit,
  TrackerProjectionDomain,
  TrackerProjectionListener,
  TrackerProjectionState,
  TrackerProjectionUnsubscribe,
} from './tracker/projectionRenderer.js';
export type {
  TrackerChromeView,
  TrackerElementView,
  TrackerItemView,
  TrackerMountView,
  TrackerSelectionView,
  TrackerViewportView,
} from './tracker/viewProjection.js';
