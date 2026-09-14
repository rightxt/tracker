// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TrackerLifecycleError } from '../../errors.js';
import { Diagnostics } from '../Diagnostics.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('core diagnostics', () => {
  it('records warnings with console output and warning events', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = { emit: vi.fn() };
    const diagnostics = new Diagnostics({ events });

    diagnostics.warn('invalid-option-value', 'Warning message.');
    diagnostics.warn('invalid-option-value', 'Warning message.', { key: 1 });

    const stats = diagnostics.getStats();

    expect(consoleWarn).toHaveBeenCalledTimes(2);
    expect(consoleWarn).toHaveBeenNthCalledWith(1, 'Warning message.');
    expect(consoleWarn).toHaveBeenNthCalledWith(2, 'Warning message.', { key: 1 });
    expect(stats.warnings.total).toBe(2);
    expect(stats.warnings.byCode['invalid-option-value']).toBe(2);
    expect(stats.warnings.last).toEqual({
      code: 'invalid-option-value',
      message: 'Warning message.',
      details: { key: 1 },
    });
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledWith('warning', expect.objectContaining({ code: 'invalid-option-value' }));
  });

  it('suppresses console warnings when the warnings option is disabled', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostics = new Diagnostics({ options: { warnings: false } });

    diagnostics.warn('invalid-option-value', 'Warning message.');

    expect(consoleWarn).not.toHaveBeenCalled();
    expect(diagnostics.getStats().warnings.total).toBe(1);
  });

  it('routes diagnostic output through a configured sink instead of global console', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = { error: vi.fn(), warn: vi.fn() };
    const diagnostics = new Diagnostics({ options: { output: sink } });

    diagnostics.error('invalid-options', 'Error message.', { error: true });
    diagnostics.warn('invalid-option-value', 'Warning message.', { warning: true });

    expect(sink.error).toHaveBeenCalledWith('invalid-options', 'Error message.', { error: true });
    expect(sink.warn).toHaveBeenCalledWith('invalid-option-value', 'Warning message.', { warning: true });
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('swallows a rejected thenable returned by an async output sink without an unhandled rejection', async () => {
    // vi.fn() wraps async implementations with its own promise tracking, which
    // masks unhandled rejections from Node's detection — plain functions with
    // manual call counters are required to observe the real defect.
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

    process.on('unhandledRejection', onUnhandledRejection);

    try {
      let errorCalls = 0;
      let warnCalls = 0;
      const sink = {
        error: async () => {
          errorCalls += 1;
          throw new Error('sink error failed');
        },
        warn: async () => {
          warnCalls += 1;
          throw new Error('sink warn failed');
        },
      };
      const diagnostics = new Diagnostics({ options: { output: sink } });

      diagnostics.error('invalid-options', 'Error message.');
      diagnostics.warn('invalid-option-value', 'Warning message.');

      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(errorCalls).toBe(1);
      expect(warnCalls).toBe(1);
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('records errors with console output', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const diagnostics = new Diagnostics();

    diagnostics.error('invalid-options', 'Error message.', { key: 1 });
    diagnostics.error('invalid-options', 'Error message.');

    const stats = diagnostics.getStats();

    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenNthCalledWith(1, 'Error message.', { key: 1 });
    expect(consoleError).toHaveBeenNthCalledWith(2, 'Error message.');
    expect(stats.errors.total).toBe(2);
    expect(stats.errors.byCode['invalid-options']).toBe(2);
  });

  it('stores retention-safe detail copies in stats while console and events receive original details', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = { emit: vi.fn() };
    const diagnostics = new Diagnostics({ events });
    const element = document.createElement('div');
    const details = { element };

    element.id = 'retained';
    diagnostics.warn('invalid-option-value', 'Warning message.', details);

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0]?.[0]).toBe('Warning message.');
    expect(consoleWarn.mock.calls[0]?.[1]).toBe(details);
    expect(events.emit).toHaveBeenCalledWith('warning', expect.objectContaining({ details }));
    expect(diagnostics.getStats().warnings.last?.details).toEqual({ element: '[Element div#retained]' });
  });

  it('normalizes empty codes, messages and non-object details', () => {
    const diagnostics = new Diagnostics({ options: { warnings: false } });

    diagnostics.warn('' as never, '', 'details' as never);

    expect(diagnostics.getStats().warnings.last).toEqual({
      code: 'unknown',
      message: 'Tracker diagnostic message.',
      details: null,
    });
  });

  it('tracks marker and rule counters and ignores unknown or negative input', () => {
    const diagnostics = new Diagnostics();

    diagnostics.recordMarker('created');
    diagnostics.recordMarker('created', 2);
    diagnostics.recordMarker('removed', -5);
    diagnostics.recordMarker('unknown' as never);
    diagnostics.recordRule('added', 3);
    diagnostics.recordRule('rejected');
    diagnostics.recordRule('unknown' as never, 2);

    const stats = diagnostics.getStats();

    expect(stats.markers.created).toBe(3);
    expect(stats.markers.removed).toBe(0);
    expect(stats.rules.added).toBe(3);
    expect(stats.rules.rejected).toBe(1);
  });

  it('tracks observer events and ignores unknown observers', () => {
    const diagnostics = new Diagnostics();

    diagnostics.recordObserverEvent('mutation');
    diagnostics.recordObserverEvent('scroll');
    diagnostics.recordObserverEvent('scroll');
    diagnostics.recordObserverEvent('unknown' as never);

    const stats = diagnostics.getStats();

    expect(stats.observers.mutation).toBe(1);
    expect(stats.observers.scroll).toBe(2);
    expect(stats.observers.interval).toBe(0);
  });

  it('tracks render lifecycle counters and the last render summary', () => {
    const diagnostics = new Diagnostics();

    diagnostics.recordRenderRequested();
    diagnostics.recordRenderStarted();
    diagnostics.recordRenderSkipped();
    diagnostics.recordRenderCancelled();
    diagnostics.recordRenderCompleted({ markersCount: 3, clustersCount: 1 });

    const stats = diagnostics.getStats();

    expect(stats.renders).toEqual({ requested: 1, started: 1, completed: 1, cancelled: 1, skipped: 1 });
    expect(stats.lastRender).toEqual({ markersCount: 3, clustersCount: 1 });
  });

  it('updates current render counts only for valid non-negative integers', () => {
    const diagnostics = new Diagnostics();

    diagnostics.setCurrentRenderCounts({ markers: 5, clusters: 2 });
    diagnostics.setCurrentRenderCounts({ markers: -1, clusters: 1.5 });
    diagnostics.setCurrentRenderCounts({});

    const stats = diagnostics.getStats();

    expect(stats.markers.current).toBe(5);
    expect(stats.clusters.current).toBe(2);
  });

  it('updates diagnostics options and ignores invalid values', () => {
    const diagnostics = new Diagnostics();

    expect(diagnostics.metricsEnabled).toBe(false);

    diagnostics.updateOptions({ metrics: true });

    expect(diagnostics.metricsEnabled).toBe(true);

    diagnostics.updateOptions({ metrics: 'no' as never, warnings: 1 as never });

    expect(diagnostics.metricsEnabled).toBe(true);
  });

  it('replaces diagnostics options from defaults', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const firstSink = { warn: vi.fn() };
    const secondSink = { warn: vi.fn() };
    const diagnostics = new Diagnostics({
      options: {
        metrics: true,
        output: firstSink,
        warnings: false,
      },
    });

    diagnostics.replaceOptions({});
    diagnostics.warn('invalid-option-value', 'Warning message.');

    expect(diagnostics.metricsEnabled).toBe(false);
    expect(firstSink.warn).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenNthCalledWith(1, 'Warning message.');

    diagnostics.replaceOptions({ output: secondSink, warnings: true });
    diagnostics.warn('invalid-css-variable-name', 'Second warning message.');

    expect(secondSink.warn).toHaveBeenCalledWith('invalid-css-variable-name', 'Second warning message.', undefined);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
  });

  it('flattens a warning triggered from a warning event handler instead of recursing', () => {
    const emittedCodes: string[] = [];
    const events = { emit: (..._args: unknown[]) => {} };
    const diagnostics = new Diagnostics({ events, options: { warnings: false } });

    events.emit = vi.fn((...args: unknown[]) => {
      const entry = args[1] as { code: string };

      emittedCodes.push(entry.code);
      if (entry.code === 'invalid-option-value') {
        diagnostics.warn('invalid-css-variable-name', 'Inner warning message.');
      }
    });
    diagnostics.warn('invalid-option-value', 'Outer warning message.');

    expect(emittedCodes).toEqual(['invalid-option-value', 'invalid-css-variable-name']);
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it('flattens warnings triggered by the configured output sink', () => {
    const codes: string[] = [];
    let depth = 0;
    let maxDepth = 0;
    const diagnostics = new Diagnostics();
    const sink = {
      warn(code: string) {
        depth += 1;
        maxDepth = Math.max(maxDepth, depth);
        codes.push(code);

        if (code === 'invalid-option-value') {
          diagnostics.warn('invalid-css-variable-name', 'Inner warning message.');
        }

        depth -= 1;
      },
    };

    diagnostics.updateOptions({ output: sink });
    diagnostics.warn('invalid-option-value', 'Outer warning message.');

    expect(codes).toEqual(['invalid-option-value', 'invalid-css-variable-name']);
    expect(maxDepth).toBe(1);
  });

  it('closes a warning batch safely when a handler destroys diagnostics', () => {
    const events = { emit: (..._args: unknown[]) => {} };
    const diagnostics = new Diagnostics({ events, options: { warnings: false } });

    events.emit = vi.fn(() => {
      diagnostics.warn('invalid-css-variable-name', 'Queued warning message.');
      diagnostics.destroy();
    });

    expect(() => diagnostics.warn('invalid-option-value', 'Outer warning message.')).not.toThrow();
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('stops a non-terminating warning feedback loop with a reentrancy-limit error', () => {
    const sink = { error: () => {}, warn: () => {} };
    const events = { emit: (..._args: unknown[]) => {} };
    const diagnostics = new Diagnostics({ events, options: { output: sink } });

    events.emit = vi.fn(() => {
      diagnostics.warn('invalid-option-value', 'Looping warning message.');
    });

    expect(() => diagnostics.warn('invalid-option-value', 'Looping warning message.')).toThrow(TrackerLifecycleError);
    expect(diagnostics.getStats().errors.byCode.ERR_TRACKER_REENTRANCY_LIMIT).toBe(1);
  });

  it('resets stats and releases references on destroy', () => {
    const sink = { warn: vi.fn() };

    const diagnostics = new Diagnostics({ options: { output: sink, warnings: false } });

    diagnostics.warn('invalid-option-value', 'Warning message.');
    diagnostics.resetStats();

    expect(diagnostics.getStats().warnings.total).toBe(0);

    diagnostics.warn('invalid-option-value', 'Warning message.');
    diagnostics.recordRenderCompleted({});
    diagnostics.destroy();

    const stats = diagnostics.getStats();

    expect(stats.warnings.last).toBeNull();
    expect(stats.errors.last).toBeNull();
    expect(stats.lastRender).toBeNull();

    sink.warn.mockClear();
    diagnostics.warn('invalid-css-variable-name', 'Warning after destroy.');

    expect(sink.warn).not.toHaveBeenCalled();
  });
});
