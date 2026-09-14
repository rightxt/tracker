import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDebounced } from '../debounce.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('core debounce utility', () => {
  it('throws when created without a function', () => {
    expect(() => {
      createDebounced(null as never, 10);
    }).toThrow(TypeError);
  });

  it('runs once with the latest arguments after the delay', () => {
    vi.useFakeTimers();

    const fn = vi.fn();
    const debounced = createDebounced(fn, 10);

    debounced('first');
    debounced('second');
    vi.advanceTimersByTime(9);

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });

  it('cancels and flushes pending calls', () => {
    vi.useFakeTimers();

    const fn = vi.fn();
    const debounced = createDebounced(fn, 10);

    debounced('cancelled');
    debounced.cancel();
    vi.advanceTimersByTime(10);

    expect(fn).not.toHaveBeenCalled();

    debounced('flushed');
    debounced.flush();
    debounced.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('flushed');
  });

  it('relinquishes internal state before a throwing clearTimeout so a later call is not blocked', () => {
    vi.useFakeTimers();

    const fn = vi.fn();
    let shouldThrow = false;
    const activeWindow = {
      setTimeout: ((handler: () => void, delay: number) =>
        setTimeout(handler, delay)) as unknown as Window['setTimeout'],
      clearTimeout: vi.fn((id: number) => {
        if (shouldThrow) {
          throw new Error('clearTimeout failed');
        }
        clearTimeout(id);
      }) as unknown as Window['clearTimeout'],
    } as unknown as Window;
    const debounced = createDebounced(fn, 10, activeWindow);

    debounced('first');
    shouldThrow = true;

    expect(() => {
      debounced.cancel();
    }).toThrow('clearTimeout failed');

    shouldThrow = false;
    debounced('second');
    vi.advanceTimersByTime(10);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });
});
