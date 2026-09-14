import type { TrackerDebugTraceEntry } from './types.js';
import { getTrackerInstanceDebugTrace } from './tracker/accessors.js';
import { getTrackerIntegrationInstance } from './tracker/integrationRegistry.js';
import type { TrackerProjectionIntegration } from './tracker/projectionIntegration.js';
import type { TrackerRendererIntegration } from './tracker/rendererIntegration.js';

/** Opaque runtime facades accepted by privileged diagnostics. */
type TrackerDebugIntegration = TrackerProjectionIntegration | TrackerRendererIntegration;

/**
 * Returns the retention-safe execution trace for a debug-build integration.
 *
 * Production builds and unknown facade objects return null.
 *
 * @param integration - Opaque Projection or Direct Renderer facade.
 * @returns Debug trace snapshot, or null when unavailable.
 */
function getTrackerDebugTrace(integration: TrackerDebugIntegration): TrackerDebugTraceEntry[] | null {
  const instance = getTrackerIntegrationInstance(integration);

  return instance === null ? null : getTrackerInstanceDebugTrace(instance);
}

export type { TrackerDebugIntegration, TrackerDebugTraceEntry };
export { getTrackerDebugTrace };
