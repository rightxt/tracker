// Direct Renderer SPI for imperative DOM, Canvas, SVG, WebGL, and scene-graph integrations.
export { CLASS_NAMES, CSS_VARIABLES, DATA_ATTRIBUTES } from './render-contract/names.js';
export { createTrackerRendererIntegration } from './tracker/rendererIntegration.js';
export { resolveMarkerPresentation } from './markers/resolveMarkerPresentation.js';
export { createCssValueMap, toCssValue, toPercent } from './utils/styleValue.js';
export { getPrimaryMarkerRecord, isClusterRenderRecord, isMarkerRenderRecord } from './tracker/renderRecords.js';

export type {
  TrackerClassNameConstants,
  TrackerClusterRenderRecord,
  TrackerCssVariableConstants,
  TrackerCssVariablePatch,
  TrackerCssVariablePatchValue,
  TrackerCssVariableValue,
  TrackerDataAttributeConstants,
  TrackerDiagnosticsSink,
  TrackerMarkerDefaultsSnapshot,
  TrackerMarkerRecord,
  TrackerMarkerRenderRecord,
  TrackerNormalizedMarkerAttributes,
  TrackerNormalizedMarkerOptions,
  TrackerNormalizedRule,
  TrackerReadonlyOptions,
  TrackerRenderRecord,
  TrackerRendererContext,
  TrackerRendererLike,
  TrackerRendererMountContext,
  TrackerRendererMountTarget,
  TrackerResolvedMarkerPresentation,
  TrackerRuleCssVariables,
  TrackerUserAttributeInputValue,
  TrackerUserAttributeValue,
  TrackerUserAttributes,
  TrackerViewportLayoutRecord,
} from './types.js';
export type {
  TrackerActivateItemOptions,
  TrackerRendererIntegration,
  TrackerRendererIntegrationMountRequest,
  TrackerRendererIntegrationOptions,
} from './tracker/rendererIntegration.js';
