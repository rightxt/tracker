import { describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES, createTrackerStateIntegration } from '../../__tests__/testIntegration.js';
import type { TrackerEventName } from '../../types.js';

describe('core tracker event facade', () => {
  it('supports known public event names and rejects unknown names', () => {
    const runtime = createTrackerStateIntegration();

    expect(runtime.on(EVENT_NAMES.DESTROY, vi.fn())).toEqual(expect.any(Function));

    expect(() => runtime.on('unknown:event' as TrackerEventName, vi.fn())).toThrow(TypeError);

    runtime.destroy();
  });

  it('rejects invalid event handlers', () => {
    const runtime = createTrackerStateIntegration();
    expect(() => runtime.on(EVENT_NAMES.DESTROY, null as never)).toThrow(TypeError);
    expect(() => runtime.off(EVENT_NAMES.DESTROY, null as never)).toThrow(TypeError);

    runtime.destroy();
  });

  it('emits destroy events through public subscriptions', () => {
    const runtime = createTrackerStateIntegration();
    const handler = vi.fn();

    runtime.on(EVENT_NAMES.DESTROY, handler);
    runtime.destroy();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({});
  });

  it('rejects unknown event names during removal', () => {
    const runtime = createTrackerStateIntegration();
    expect(() => runtime.off('unknown:event' as TrackerEventName, vi.fn())).toThrow(TypeError);

    runtime.destroy();
  });

  it('rejects new subscriptions and returns false from removals after destroy', () => {
    const runtime = createTrackerStateIntegration();

    runtime.destroy();

    expect(() => runtime.on(EVENT_NAMES.DESTROY, vi.fn())).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }),
    );
    expect(runtime.off(EVENT_NAMES.DESTROY, vi.fn())).toBe(false);
  });
});
