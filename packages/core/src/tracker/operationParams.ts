import { isPlainObject } from '../utils/object.js';
import { TrackerConfigurationError } from '../errors.js';

/**
 * Checks whether params.render should trigger rendering.
 *
 * @param params - Operation params.
 * @param additionalKeys - Operation-specific allowed keys.
 * @returns Normalized render flag.
 */
function shouldRender(params: unknown, additionalKeys: readonly string[] = []): boolean {
  if (params === undefined) {
    return true;
  }

  if (!isPlainObject(params)) {
    throw new TrackerConfigurationError('Tracker operation params must be a plain object.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const allowedKeys = new Set(['render', ...additionalKeys]);
  const unknownKeys = Object.keys(params).filter((key) => !allowedKeys.has(key));

  if (unknownKeys.length > 0) {
    throw new TrackerConfigurationError(`Unknown Tracker operation param "${unknownKeys[0]}".`, {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  if (Object.hasOwn(params, 'render') && typeof params.render !== 'boolean') {
    throw new TrackerConfigurationError('Tracker operation params.render must be a boolean.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  return typeof params.render === 'boolean' ? params.render : true;
}

export { shouldRender };
