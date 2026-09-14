// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelFrame, scheduleFrame } from '../frame.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('frame helpers', () => {
  it('uses the ambient animation-frame API when the window is omitted', () => {
    const callback = vi.fn();
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(17);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const frameId = scheduleFrame(callback);

    expect(frameId).toBe(17);
    expect(requestAnimationFrame).toHaveBeenCalledWith(callback);

    cancelFrame(frameId);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });

  it('uses the timeout fallback when the active window is explicitly null', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');

    const frameId = scheduleFrame(callback, null);

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    cancelFrame(frameId, null);
    vi.runAllTimers();

    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});
