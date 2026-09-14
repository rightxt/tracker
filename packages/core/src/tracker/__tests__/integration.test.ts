import { describe, expect, it } from 'vitest';

import type { TrackerRendererLike } from '../../types.js';
import { createTrackerInstance } from '../createTrackerInstance.js';
import { createTrackerIntegrationInstance } from '../integration.js';

/** Minimal renderer stub satisfying the required renderer contract shape. */
const rendererStub: TrackerRendererLike = {
  mount: () => document.createElement('div'),
};

describe('core tracker integration factory', () => {
  it('rejects a missing integrationOptions argument at runtime', () => {
    expect(() => (createTrackerIntegrationInstance as (configuration?: object) => unknown)({})).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('rejects integrationOptions missing getInstance', () => {
    expect(() =>
      (createTrackerIntegrationInstance as (configuration: object, options: unknown) => unknown)(
        {},
        { renderer: rendererStub },
      ),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
  });

  it('rejects integrationOptions missing renderer', () => {
    expect(() =>
      (createTrackerIntegrationInstance as (configuration: object, options: unknown) => unknown)(
        {},
        { getInstance: () => null },
      ),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
  });

  it('rejects a non-object integrationOptions', () => {
    expect(() =>
      (createTrackerIntegrationInstance as (configuration: object, options: unknown) => unknown)({}, null),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
  });

  it('creates an instance when both getInstance and renderer are provided', () => {
    const instance = createTrackerIntegrationInstance(
      {},
      {
        getInstance: () => null,
        renderer: rendererStub,
      },
    );

    expect(instance).toBeTruthy();
  });

  it('forwards an explicit whole-configuration null to canonical validation instead of masking it', () => {
    expect(() =>
      (createTrackerIntegrationInstance as (configuration: unknown, options: unknown) => unknown)(null, {
        getInstance: () => null,
        renderer: rendererStub,
      }),
    ).toThrow(TypeError);
  });

  it('creates an instance when configuration is omitted or explicitly undefined', () => {
    expect(
      createTrackerIntegrationInstance(undefined, {
        getInstance: () => null,
        renderer: rendererStub,
      }),
    ).toBeTruthy();
  });
});

describe('canonical Core whole-configuration validation', () => {
  it('creates a default instance when configuration is omitted or explicitly undefined', () => {
    expect(createTrackerInstance()).toBeTruthy();
    expect(createTrackerInstance(undefined)).toBeTruthy();
  });

  it('rejects an explicit null configuration', () => {
    expect(() => (createTrackerInstance as (configuration: unknown) => unknown)(null)).toThrow(TypeError);
  });

  it('rejects an array configuration', () => {
    expect(() => (createTrackerInstance as (configuration: unknown) => unknown)([])).toThrow(TypeError);
  });

  it('rejects a non-plain-object configuration such as a Date instance', () => {
    expect(() => (createTrackerInstance as (configuration: unknown) => unknown)(new Date())).toThrow(TypeError);
  });

  it('accepts a valid plain object configuration', () => {
    expect(createTrackerInstance({})).toBeTruthy();
  });
});
