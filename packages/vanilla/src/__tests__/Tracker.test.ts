// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES } from '@rightxt/tracker-core';
import Tracker from '..';

describe('vanilla Tracker public facade', () => {
  it('defaults omitted or undefined configuration without masking null and exposes the injected Vanilla version', () => {
    const omitted = new Tracker();

    expect(omitted.state).toBe('unmounted');
    expect(omitted.version).toBe('0.1.0-test');
    omitted.destroy();

    const explicitUndefined = new Tracker(undefined);

    expect(explicitUndefined.state).toBe('unmounted');
    explicitUndefined.destroy();

    // @ts-expect-error An explicit null configuration is rejected, not defaulted like an omitted argument.
    expect(() => new Tracker(null)).toThrow(TypeError);
  });

  it('rejects render arguments at both the Vanilla type and runtime boundaries', () => {
    const target = document.createElement('div');
    const tracker = new Tracker({
      options: {
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
    });

    document.body.appendChild(target);
    tracker.mount({ renderHost: target });

    expect(() => {
      // @ts-expect-error Public render() takes no arguments; extra arguments are a misuse, not silently ignored.
      tracker.render('markers');
    }).toThrow(TypeError);

    tracker.destroy();
    target.remove();
  });

  it('supports public handler removal until destroy, then clears terminal event ownership', () => {
    const tracker = new Tracker();
    const handlerAEvents: unknown[] = [];
    const handlerB = vi.fn();
    const unsubscribeA = tracker.on(EVENT_NAMES.DESTROY, (event) => {
      handlerAEvents.push(event);
    });

    tracker.on(EVENT_NAMES.DESTROY, handlerB);
    tracker.off(EVENT_NAMES.DESTROY, handlerB);
    tracker.destroy();

    expect(handlerAEvents).toEqual([{}]);
    expect(handlerB).not.toHaveBeenCalled();
    expect(() => {
      unsubscribeA();
      unsubscribeA();
    }).not.toThrow();
    expect(tracker.off(EVENT_NAMES.DESTROY, handlerB)).toBe(false);
    expect(() => tracker.on(EVENT_NAMES.DESTROY, handlerB)).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }),
    );
  });

  it('does not inspect thenables returned by public Vanilla event handlers', () => {
    const tracker = new Tracker();
    const then = vi.fn();

    tracker.on(EVENT_NAMES.DESTROY, (() => ({ then })) as never);
    tracker.destroy();

    expect(then).not.toHaveBeenCalled();
    expect(tracker.getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
  });

  it('keeps public event ownership and explicit renderHost binding across reversible mount generations', () => {
    const renderHost = document.createElement('div');
    const tracker = new Tracker({
      options: {
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
    });
    const syncEnd = vi.fn();

    document.body.appendChild(renderHost);
    tracker.on(EVENT_NAMES.SYNC_END, syncEnd);

    tracker.mount({ renderHost });

    const firstRoot = tracker.root;

    expect(tracker.mounted).toBe(true);
    expect(firstRoot).toBeInstanceOf(HTMLElement);
    expect(renderHost.contains(firstRoot)).toBe(true);
    expect(syncEnd).toHaveBeenCalledTimes(1);

    tracker.unmount();

    expect(tracker.mounted).toBe(false);
    expect(tracker.root).toBeNull();

    tracker.mount({ renderHost });

    const secondRoot = tracker.root;

    expect(tracker.mounted).toBe(true);
    expect(secondRoot).toBeInstanceOf(HTMLElement);
    expect(secondRoot).not.toBe(firstRoot);
    expect(renderHost.contains(secondRoot)).toBe(true);
    expect(syncEnd).toHaveBeenCalledTimes(2);

    tracker.destroy();
    renderHost.remove();
  });

  it('applies a reentrant Tracker mutation after the active public listener batch', () => {
    const target = document.createElement('div');
    const tracker = new Tracker({
      options: {
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
    });
    const observedPlacements: string[] = [];
    let requested = false;

    document.body.appendChild(target);
    tracker.on(EVENT_NAMES.SYNC_START, () => {
      if (!requested) {
        requested = true;
        tracker.patchOptions({ placement: 'right' });
      }
    });
    tracker.on(EVENT_NAMES.SYNC_START, () => {
      observedPlacements.push(tracker.getOptions().placement);
    });

    tracker.mount({ renderHost: target });

    expect(observedPlacements[0]).toBe('left');
    expect(tracker.getOptions().placement).toBe('right');

    tracker.destroy();
    target.remove();
  });

  it('exposes one stable Promise that resolves after permanent destruction', async () => {
    const tracker = new Tracker();
    const first = tracker.whenDestroyed();
    const second = tracker.whenDestroyed();
    let resolved = false;

    first.then(() => {
      resolved = true;
    });

    expect(first).toBe(second);
    await Promise.resolve();
    expect(resolved).toBe(false);

    tracker.destroy();

    await expect(first).resolves.toBeUndefined();
    expect(resolved).toBe(true);
    expect(tracker.whenDestroyed()).toBe(first);
  });

  it('rejects invalid TrackerRule shapes at both the Vanilla type and runtime boundaries', () => {
    const tracker = new Tracker();

    expect(() => {
      // @ts-expect-error addRule() accepts a TrackerRule, not an arbitrary value.
      tracker.addRule(null);
    }).toThrow();
    expect(() => {
      // @ts-expect-error TrackerRule.selector must be a string.
      tracker.addRule({ selector: 1 });
    }).toThrow();

    tracker.destroy();
  });

  it('rejects mount() calls made after destroy() before validating the request', () => {
    const tracker = new Tracker();

    tracker.destroy();

    // The request is otherwise invalid (null renderHost) to prove the destroyed
    // check short-circuits before mount-request normalization instead of just
    // no-oping inside the integration.
    expect(() => tracker.mount({ renderHost: null as never })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }),
    );
    expect(tracker.destroyed).toBe(true);
    expect(tracker.mounted).toBe(false);
    expect(tracker.root).toBeNull();
  });

  it('rejects getOptions() and getRules() after destroy() while keeping terminal state readable', () => {
    const target = document.createElement('div');
    const tracker = new Tracker({ rules: [{ selector: '.target' }] });

    document.body.appendChild(target);
    tracker.mount({ renderHost: target });
    tracker.destroy();

    expect(() => tracker.getOptions()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }));
    expect(() => tracker.getRules()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }));
    expect(tracker.destroyed).toBe(true);
    expect(tracker.mounted).toBe(false);
    expect(tracker.root).toBeNull();
    expect(tracker.getSnapshot().lifecycle.destroyed).toBe(true);
    expect(tracker.getSnapshot().lifecycle.mounted).toBe(false);
    expect(tracker.getStats().errors.total).toBe(0);
    expect(() => tracker.destroy()).not.toThrow();
    expect(tracker.destroyed).toBe(true);
    target.remove();
  });

  it('validates the Vanilla mount-request envelope before delegating to Core', () => {
    const tracker = new Tracker();

    expect(() =>
      // @ts-expect-error A mount request must be a plain options object, not an array.
      tracker.mount([]),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }));

    expect(() =>
      tracker.mount({
        // @ts-expect-error An explicit null DOM reference is rejected, not treated as omitted.
        renderHost: null,
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }));

    const scrollRoot = document.createElement('div');

    document.body.appendChild(scrollRoot);
    expect(() => tracker.mount({ scrollRoot })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }),
    );

    expect(tracker.mounted).toBe(false);
    expect(tracker.root).toBeNull();

    tracker.destroy();
    scrollRoot.remove();
  });
});
