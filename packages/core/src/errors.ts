import type { TrackerErrorCode, TrackerErrorOptions } from './types.js';

/** Base error carrying a stable Tracker error code. */
class TrackerError extends Error {
  /** Stable machine-readable error code. */
  readonly code: TrackerErrorCode;

  /**
   * @param message - Human-readable error message.
   * @param options - Stable code and optional native cause.
   */
  constructor(message: string, options: TrackerErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = options.code;
  }
}

/** Error raised for invalid or unsupported Tracker configuration. */
class TrackerConfigurationError extends TrackerError {}

/** Error raised for an invalid Tracker lifecycle transition. */
class TrackerLifecycleError extends TrackerError {}

export { TrackerConfigurationError, TrackerError, TrackerLifecycleError };
