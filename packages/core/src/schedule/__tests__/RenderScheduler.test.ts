import { afterEach, describe, expect, it, vi } from 'vitest';

import { RenderScheduler } from '../RenderScheduler.js';
import { RENDER_TARGETS, isRenderTarget, mergeRenderTargets } from '../renderTargets.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('core render targets', () => {
  it('validates and merges render targets according to internal render semantics', () => {
    expect(isRenderTarget(RENDER_TARGETS.TRACK)).toBe(true);
    expect(isRenderTarget('unknown')).toBe(false);
    expect(mergeRenderTargets(null, RENDER_TARGETS.VIEWPORT)).toBe(RENDER_TARGETS.VIEWPORT);
    expect(mergeRenderTargets(RENDER_TARGETS.TRACK, RENDER_TARGETS.MARKERS)).toBe(RENDER_TARGETS.ALL);
    expect(mergeRenderTargets('invalid' as never, RENDER_TARGETS.MARKERS)).toBe(RENDER_TARGETS.ALL);
    expect(mergeRenderTargets(RENDER_TARGETS.VIEWPORT, 'invalid' as never)).toBe(RENDER_TARGETS.VIEWPORT);
  });
});

describe('core RenderScheduler', () => {
  it('coalesces pending targets and reasons into a single scheduled render', () => {
    vi.useFakeTimers();

    const render = vi.fn();
    const diagnostics = {
      recordRenderRequested: vi.fn(),
    };
    const scheduler = new RenderScheduler({
      diagnostics,
      render,
    });

    scheduler.request(RENDER_TARGETS.TRACK, {
      source: 'track',
    });
    scheduler.request(RENDER_TARGETS.MARKERS, {
      source: 'markers',
    });

    expect(scheduler.pending).toBe(true);
    expect(diagnostics.recordRenderRequested).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(16);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(
      RENDER_TARGETS.ALL,
      {
        reasons: [
          {
            source: 'track',
          },
          {
            source: 'markers',
          },
        ],
        scheduled: true,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(scheduler.pending).toBe(false);
  });

  it('flattens an already coalesced reason list into the scheduled render reason', () => {
    vi.useFakeTimers();

    const render = vi.fn();
    const scheduler = new RenderScheduler({ render });

    scheduler.request(RENDER_TARGETS.MARKERS, {
      reasons: [{ source: 'resize-observer' }, { source: 'window-resize' }],
    });
    vi.advanceTimersByTime(16);

    expect(render).toHaveBeenCalledWith(
      RENDER_TARGETS.MARKERS,
      {
        reasons: [{ source: 'resize-observer' }, { source: 'window-resize' }],
        scheduled: true,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('cancels pending work and reports cancelled renders', () => {
    vi.useFakeTimers();

    const render = vi.fn();
    const diagnostics = {
      recordRenderCancelled: vi.fn(),
    };
    const scheduler = new RenderScheduler({
      diagnostics,
      render,
    });

    scheduler.request(RENDER_TARGETS.ALL);
    scheduler.cancel();
    vi.runAllTimers();

    expect(render).not.toHaveBeenCalled();
    expect(diagnostics.recordRenderCancelled).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
  });

  it('schedules and cancels frames through the configured window', () => {
    const cancelAnimationFrame = vi.fn();
    const requestAnimationFrame = vi.fn(() => 17);
    const scheduler = new RenderScheduler({
      render: vi.fn(),
      window: {
        cancelAnimationFrame,
        requestAnimationFrame,
      } as unknown as Window,
    });

    scheduler.request(RENDER_TARGETS.ALL);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    scheduler.cancel();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });

  it('warns and ignores invalid render targets', () => {
    const render = vi.fn();
    const diagnostics = {
      warn: vi.fn(),
    };
    const scheduler = new RenderScheduler({
      diagnostics,
      render,
    });

    scheduler.request('invalid' as never);
    scheduler.flush();

    expect(render).not.toHaveBeenCalled();
    expect(diagnostics.warn).toHaveBeenCalledWith(
      'invalid-render-target',
      'Invalid internal render target "invalid".',
      {
        target: 'invalid',
      },
    );
  });

  it('schedules a follow-up frame when a render requests more work while running', async () => {
    vi.useFakeTimers();

    const context: { scheduler: RenderScheduler | null } = {
      scheduler: null,
    };
    const render = vi.fn(async (_target: unknown, _reason: unknown) => {
      context.scheduler!.request(RENDER_TARGETS.VIEWPORT, {
        source: 'follow-up',
      });
    });

    context.scheduler = new RenderScheduler({
      render,
    });

    const scheduler = context.scheduler;

    scheduler.request(RENDER_TARGETS.MARKERS, {
      source: 'initial',
    });
    vi.advanceTimersByTime(16);

    expect(scheduler.running).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.pending).toBe(true);

    vi.advanceTimersByTime(16);
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]?.[0]).toBe(RENDER_TARGETS.VIEWPORT);
  });

  it('lets cancel() reclaim the scheduler from a render whose promise never settles', async () => {
    let resolveFirstRender: (() => void) | null = null;
    const firstRenderPromise = new Promise<void>((resolve) => {
      resolveFirstRender = resolve;
    });
    const render = vi.fn((target: string) => (target === RENDER_TARGETS.MARKERS ? firstRenderPromise : undefined));
    const scheduler = new RenderScheduler({ render });

    scheduler.request(RENDER_TARGETS.MARKERS);
    scheduler.flush();

    expect(scheduler.running).toBe(true);

    scheduler.cancel();

    expect(scheduler.running).toBe(false);

    scheduler.request(RENDER_TARGETS.VIEWPORT);
    scheduler.flush();

    expect(render).toHaveBeenCalledTimes(2);
    expect(scheduler.running).toBe(false);

    resolveFirstRender!();
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.running).toBe(false);
  });

  it('aborts the render control signal when cancel() supersedes an in-flight async render', async () => {
    let capturedSignal: AbortSignal | null = null;
    let resolveFirstRender: (() => void) | null = null;
    const firstRenderPromise = new Promise<void>((resolve) => {
      resolveFirstRender = resolve;
    });
    const render = vi.fn((_target: unknown, _reason: unknown, control?: { signal: AbortSignal }) => {
      capturedSignal = control!.signal;
      return firstRenderPromise;
    });
    const scheduler = new RenderScheduler({ render });

    scheduler.request(RENDER_TARGETS.MARKERS);
    scheduler.flush();

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    scheduler.cancel();

    expect(capturedSignal!.aborted).toBe(true);

    resolveFirstRender!();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('does not abort the render control signal for a run that completes without being superseded', async () => {
    let capturedSignal: AbortSignal | null = null;
    const render = vi.fn((_target: unknown, _reason: unknown, control?: { signal: AbortSignal }) => {
      capturedSignal = control!.signal;
      return Promise.resolve();
    });
    const scheduler = new RenderScheduler({ render });

    scheduler.request(RENDER_TARGETS.MARKERS);
    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);
  });

  it('relinquishes internal state before a throwing cancelFrame during cancel()', () => {
    const cancelAnimationFrame = vi.fn(() => {
      throw new Error('cancelFrame failed');
    });
    const requestAnimationFrame = vi.fn(() => 17);
    const render = vi.fn();
    const scheduler = new RenderScheduler({
      render,
      window: { cancelAnimationFrame, requestAnimationFrame } as unknown as Window,
    });

    scheduler.request(RENDER_TARGETS.ALL);

    expect(scheduler.pending).toBe(true);

    expect(() => {
      scheduler.cancel();
    }).toThrow('cancelFrame failed');

    expect(scheduler.pending).toBe(false);
    expect(scheduler.running).toBe(false);

    scheduler.request(RENDER_TARGETS.MARKERS);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it.each(['no-op', 'throw'] as const)(
    'keeps replacement work owned when a retired frame fires after native cancellation is a %s',
    (cancelMode) => {
      const callbacks = new Map<number, FrameRequestCallback>();
      let nextFrameId = 1;
      const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId;

        nextFrameId += 1;
        callbacks.set(frameId, callback);
        return frameId;
      });
      const cancelAnimationFrame = vi.fn(() => {
        if (cancelMode === 'throw') {
          throw new Error('cancelFrame failed');
        }
      });
      const render = vi.fn();
      const scheduler = new RenderScheduler({
        render,
        window: { cancelAnimationFrame, requestAnimationFrame } as unknown as Window,
      });

      scheduler.request(RENDER_TARGETS.TRACK, { source: 'A' });
      const staleCallback = callbacks.get(1)!;

      if (cancelMode === 'throw') {
        expect(() => scheduler.cancel()).toThrow('cancelFrame failed');
      } else {
        scheduler.cancel();
      }

      scheduler.request(RENDER_TARGETS.VIEWPORT, { source: 'B' });
      const currentCallback = callbacks.get(2)!;

      expect(scheduler.pending).toBe(true);
      staleCallback(1);
      expect(render).not.toHaveBeenCalled();
      expect(scheduler.pending).toBe(true);

      currentCallback(2);
      expect(render).toHaveBeenCalledOnce();
      expect(render).toHaveBeenCalledWith(
        RENDER_TARGETS.VIEWPORT,
        { reasons: [{ source: 'B' }], scheduled: true },
        { signal: expect.any(AbortSignal) },
      );
      expect(scheduler.pending).toBe(false);
    },
  );

  it.each(['no-op', 'throw'] as const)(
    'preserves replacement frame cancellation ownership after a retired %s-cancelled callback fires',
    (cancelMode) => {
      const callbacks = new Map<number, FrameRequestCallback>();
      let nextFrameId = 1;
      const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId;

        nextFrameId += 1;
        callbacks.set(frameId, callback);
        return frameId;
      });
      const cancelAnimationFrame = vi.fn(() => {
        if (cancelMode === 'throw') {
          throw new Error('cancelFrame failed');
        }
      });
      const scheduler = new RenderScheduler({
        render: vi.fn(),
        window: { cancelAnimationFrame, requestAnimationFrame } as unknown as Window,
      });

      scheduler.request(RENDER_TARGETS.TRACK);
      const staleCallback = callbacks.get(1)!;

      if (cancelMode === 'throw') {
        expect(() => scheduler.cancel()).toThrow('cancelFrame failed');
      } else {
        scheduler.cancel();
      }

      scheduler.request(RENDER_TARGETS.VIEWPORT);
      staleCallback(1);

      if (cancelMode === 'throw') {
        expect(() => scheduler.cancel()).toThrow('cancelFrame failed');
      } else {
        scheduler.cancel();
      }

      expect(cancelAnimationFrame).toHaveBeenLastCalledWith(2);
      expect(scheduler.pending).toBe(false);
    },
  );

  it('relinquishes internal state before a throwing AbortController.abort() during cancel()', async () => {
    let resolveFirstRender: (() => void) | null = null;
    const firstRenderPromise = new Promise<void>((resolve) => {
      resolveFirstRender = resolve;
    });
    const render = vi.fn(() => firstRenderPromise);
    const scheduler = new RenderScheduler({ render });

    scheduler.request(RENDER_TARGETS.MARKERS);
    scheduler.flush();

    expect(scheduler.running).toBe(true);

    const originalAbort = AbortController.prototype.abort;
    AbortController.prototype.abort = function throwingAbort(): void {
      throw new Error('abort failed');
    };

    try {
      expect(() => {
        scheduler.cancel();
      }).toThrow('abort failed');
    } finally {
      AbortController.prototype.abort = originalAbort;
    }

    expect(scheduler.running).toBe(false);

    resolveFirstRender!();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('still marks the scheduler destroyed when cancel() throws during destroy()', () => {
    const cancelAnimationFrame = vi.fn(() => {
      throw new Error('cancelFrame failed');
    });
    const requestAnimationFrame = vi.fn(() => 17);
    const render = vi.fn();
    const scheduler = new RenderScheduler({
      render,
      window: { cancelAnimationFrame, requestAnimationFrame } as unknown as Window,
    });

    scheduler.request(RENDER_TARGETS.ALL);

    expect(() => {
      scheduler.destroy();
    }).toThrow('cancelFrame failed');

    scheduler.request(RENDER_TARGETS.MARKERS);

    expect(render).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
