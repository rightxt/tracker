import { TrackerConfigurationError } from '../errors.js';
import { isPlainObject } from '../utils/object.js';

import type { TrackerConfigurationReplacement } from '../types.js';

/**
 * Validates the envelope shape of a complete configuration replacement:
 * both `options` and `rules` must be present as own properties, with no
 * other keys, and must carry the correct container types. Deep option and
 * rule content validation is intentionally out of scope; callers run that
 * separately once the envelope itself is confirmed complete.
 *
 * Unlike {@link assertValidTrackerConfiguration}, which accepts an omitted
 * `options` or `rules` key for constructor-style initialization, this
 * assertion is for operations that atomically replace both channels at
 * once and therefore require the caller to state both explicitly.
 *
 * @param configuration - Complete replacement candidate.
 * @throws TypeError when the argument is not a plain object.
 * @throws TrackerConfigurationError when `options` or `rules` is missing, an unknown key is present,
 *   or either value has the wrong container type.
 */
function assertCompleteTrackerConfigurationEnvelope(
  configuration: unknown,
): asserts configuration is TrackerConfigurationReplacement {
  if (!isPlainObject(configuration)) {
    throw new TypeError('Tracker configuration replacement requires a configuration object.');
  }

  if (!Object.hasOwn(configuration, 'options') || !Object.hasOwn(configuration, 'rules')) {
    throw new TrackerConfigurationError(
      'Tracker configuration replacement requires own "options" and "rules" fields.',
      {
        code: 'ERR_TRACKER_INVALID_CONFIGURATION',
      },
    );
  }

  const unknownKeys = Object.keys(configuration).filter((key) => key !== 'options' && key !== 'rules');

  if (unknownKeys.length > 0 || !isPlainObject(configuration.options) || !Array.isArray(configuration.rules)) {
    throw new TrackerConfigurationError('Tracker configuration replacement is invalid.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }
}

export { assertCompleteTrackerConfigurationEnvelope };
