// Test-only compatibility harness for low-level behavioral suites.
// Production integrations must use Projection or Direct Renderer facades.
export * from '..';
export { CLASS_NAMES, CSS_VARIABLES, DATA_ATTRIBUTES } from '../render-contract/names.js';
export {
  getTrackerInstanceOptions,
  getTrackerInstanceRoot,
  getTrackerInstanceRules,
  getTrackerInstanceStats,
  isTrackerInstanceDestroyed,
  isTrackerInstanceMounted,
  resetTrackerInstanceStats,
} from '../tracker/accessors.js';
export { offTrackerInstanceEvent, onTrackerInstanceEvent } from '../tracker/events.js';
export { createTrackerIntegrationInstance } from '../tracker/integration.js';
export { destroyTrackerInstance, mountTrackerInstance, unmountTrackerInstance } from '../tracker/lifecycle.js';
export { renderTrackerInstanceNow, requestTrackerInstanceRender } from '../tracker/rendering.js';
export {
  addTrackerInstanceRule,
  removeTrackerInstanceRuleByIndex,
  removeTrackerInstanceRuleBySelector,
  replaceTrackerInstanceRules,
} from '../tracker/rules.js';
export { getTrackerInstanceSnapshot, subscribeTrackerInstanceSnapshot } from '../tracker/snapshotStore.js';
export { createTrackerStateIntegration } from './support/stateIntegration.js';
export {
  patchTrackerInstanceOptions,
  replaceTrackerInstanceConfiguration,
  replaceTrackerInstanceOptions,
} from '../tracker/updating.js';
