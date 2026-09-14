import type { TrackerInstance } from './createTrackerInstance.js';

/** Internal instance ownership keyed by opaque public integration facades. */
const trackerIntegrationInstances = new WeakMap<object, TrackerInstance>();

/**
 * Associates an opaque integration facade with its internal instance.
 *
 * @param integration - Public facade object.
 * @param instance - Internal runtime owned by the facade.
 */
function registerTrackerIntegration(integration: object, instance: TrackerInstance): void {
  trackerIntegrationInstances.set(integration, instance);
}

/**
 * Resolves an internal instance for privileged diagnostics.
 *
 * @param integration - Candidate public facade.
 * @returns Owned instance or null for an unknown object.
 */
function getTrackerIntegrationInstance(integration: object): TrackerInstance | null {
  return trackerIntegrationInstances.get(integration) ?? null;
}

export { getTrackerIntegrationInstance, registerTrackerIntegration };
