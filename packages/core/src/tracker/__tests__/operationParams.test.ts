import { describe, expect, it } from 'vitest';

import { shouldRender } from '../operationParams.js';

describe('core tracker operation params', () => {
  it('defaults to rendering when params are missing', () => {
    expect(shouldRender(undefined)).toBe(true);
  });

  it('rejects params that are not plain objects', () => {
    expect(() => shouldRender(null)).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
    expect(() => shouldRender(42)).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
  });

  it('defaults to rendering when the render flag is absent', () => {
    expect(shouldRender({})).toBe(true);
  });

  it('rejects invalid and unknown fields', () => {
    expect(() => shouldRender({ render: 'yes' })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
    expect(() => shouldRender({ unknown: true })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('rejects an own undefined render flag rather than treating it as omission', () => {
    expect(() => shouldRender({ render: undefined })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('ignores an own undefined value for an allowed operation-specific field, since that field has its own dedicated own-undefined check', () => {
    expect(shouldRender({ index: undefined }, ['index'])).toBe(true);
  });

  it('returns explicit boolean render flags', () => {
    expect(shouldRender({ render: true })).toBe(true);
    expect(shouldRender({ render: false })).toBe(false);
  });

  it('accepts explicitly allowed operation-specific fields', () => {
    expect(shouldRender({ index: 0, render: false }, ['index'])).toBe(false);
  });
});
