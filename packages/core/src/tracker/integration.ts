import type { TrackerConfiguration, TrackerRendererLike } from '../types.js';
import { TrackerConfigurationError } from '../errors.js';
import { isPlainObject } from '../utils/object.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { createTrackerInstance } from './createTrackerInstance.js';
import { createTrackerLifecycleCallbacks } from './lifecycleCallbacks.js';

interface TrackerIntegrationInstanceOptions {
  /** Current instance provider. */
  getInstance: () => TrackerInstance | null | undefined;
  /** Integration renderer. */
  renderer: TrackerRendererLike;
}

/**
 * Creates a Tracker instance for an integration package.
 *
 * Integration packages provide renderer ownership and an instance provider.
 * Core wires the standard lifecycle callbacks and stores them in the instance.
 *
 * @param configuration - Tracker configuration. Pass `undefined` explicitly to use
 *   the default empty configuration while still supplying `integrationOptions`.
 * @param integrationOptions - Integration options. Both `renderer` and `getInstance`
 *   are required: `getInstance` backs the standard lifecycle callbacks, and `renderer`
 *   is the renderer Core mounts against.
 * @throws {TrackerConfigurationError} When `integrationOptions` does not provide a
 *   `getInstance` function and a `renderer`.
 * @returns Internal core instance.
 */
function createTrackerIntegrationInstance(
  configuration: TrackerConfiguration | undefined,
  integrationOptions: TrackerIntegrationInstanceOptions,
): TrackerInstance {
  if (
    !isPlainObject(integrationOptions) ||
    typeof integrationOptions.getInstance !== 'function' ||
    integrationOptions.renderer === undefined ||
    integrationOptions.renderer === null
  ) {
    throw new TrackerConfigurationError(
      'createTrackerIntegrationInstance() requires integrationOptions.getInstance and integrationOptions.renderer.',
      { code: 'ERR_TRACKER_INVALID_CONFIGURATION' },
    );
  }

  const lifecycleCallbacks = createTrackerLifecycleCallbacks({
    getInstance: integrationOptions.getInstance,
  });

  return createTrackerInstance(configuration, {
    ...lifecycleCallbacks,
    renderer: integrationOptions.renderer,
  });
}

export { createTrackerIntegrationInstance };
export type { TrackerIntegrationInstanceOptions };
