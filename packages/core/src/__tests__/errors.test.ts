import { describe, expect, it } from 'vitest';

import { TrackerConfigurationError, TrackerError, TrackerLifecycleError } from '../errors.js';

describe('public errors', () => {
  it('preserves stable names, codes, inheritance, and native causes', () => {
    const cause = new Error('underlying failure');
    const configurationError = new TrackerConfigurationError('Invalid context.', {
      code: 'ERR_TRACKER_INVALID_CONTEXT',
      cause,
    });
    const lifecycleError = new TrackerLifecycleError('Transition active.', {
      code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS',
    });

    expect(configurationError).toBeInstanceOf(TrackerError);
    expect(configurationError).toBeInstanceOf(Error);
    expect(configurationError).toMatchObject({
      name: 'TrackerConfigurationError',
      code: 'ERR_TRACKER_INVALID_CONTEXT',
      cause,
    });
    expect(lifecycleError).toMatchObject({
      name: 'TrackerLifecycleError',
      code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS',
    });
  });
});
