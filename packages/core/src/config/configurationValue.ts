import type { TrackerConfiguration } from '../types.js';
import { cloneValue, isPlainObject, withRestoredDiagnosticsOutput } from '../utils/object.js';

/**
 * Detaches a public Tracker configuration graph at an integration boundary.
 *
 * Functions and platform objects retain identity; arrays and plain objects,
 * including circular graphs, are cloned with the same semantics Core uses for
 * deferred configuration operations — including preserving a caller-owned
 * `options.diagnostics.output` sink's identity, matching the guarantee Core's
 * own configuration commit path makes for that field.
 *
 * @param configuration - Configuration graph to detach.
 * @returns Detached configuration preserving the input type.
 */
function cloneTrackerConfiguration<TConfiguration extends TrackerConfiguration>(
  configuration: TConfiguration,
): TConfiguration {
  const clone = cloneValue(configuration);
  const clonedOptions = clone.options;

  if (clonedOptions?.diagnostics) {
    clonedOptions.diagnostics = withRestoredDiagnosticsOutput(
      configuration.options?.diagnostics,
      clonedOptions.diagnostics,
    );
  }

  return clone;
}

/**
 * Checks whether a Tracker configuration candidate is a cross-realm plain object.
 *
 * @param value - Candidate configuration or options object.
 * @returns True for plain objects accepted at Tracker configuration boundaries.
 */
function isTrackerConfigurationObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

export { cloneTrackerConfiguration, isTrackerConfigurationObject };
