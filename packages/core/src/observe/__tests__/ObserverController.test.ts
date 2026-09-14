// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultOptions } from '../../config/defaultOptions.js';
import { normalizeOptions } from '../../config/normalizeOptions.js';
import { assertResolvedTrackerOptions } from '../../config/resolveOptions.js';
import { getInternalDomRegistry } from '../../dom/internalDomRegistry.js';
import { RENDER_TARGETS } from '../../schedule/renderTargets.js';
import { WindowScrollContext } from '../../scroll/WindowScrollContext.js';
import type { TrackerRuntimeContext } from '../../tracker/mountContext.js';
import { ObserverController } from '../ObserverController.js';
import type { TrackerMutationObserverOptions, TrackerOptions, TrackerResolvedOptions } from '../../types.js';

/**
 * Builds committed options for controller tests.
 *
 * ObserverController consumes resolved options, so fixtures declare only the
 * update branch they exercise and this helper merges it into the default
 * baseline. Validation is skipped on purpose: some fixtures rely on values that
 * validateOptions() rejects while ObserverController still has to handle them.
 *
 * @param optionsPatch - Partial options applied over the defaults.
 * @returns Complete committed options.
 */
function createObserverOptions(optionsPatch: TrackerOptions = {}): TrackerResolvedOptions {
  const options = normalizeOptions(optionsPatch, { baseOptions: createDefaultOptions() });

  assertResolvedTrackerOptions(options);

  return options;
}

/**
 * Creates a complete Window-mode runtime context for controller tests.
 *
 * @param renderRoot - Actual renderer root.
 * @param activeDocument - Active owner document.
 * @param activeWindow - Active owner window.
 * @returns Runtime context used by observers and listeners.
 */
function createRuntimeContext(
  renderRoot: HTMLElement = document.body,
  activeDocument: Document = document,
  activeWindow: Window = window,
): TrackerRuntimeContext {
  return {
    document: activeDocument,
    window: activeWindow,
    sourceRoot: activeDocument.body,
    scrollRoot: activeWindow,
    scrollMode: 'window',
    renderRoot,
    scrollContext: new WindowScrollContext(activeWindow),
  };
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];

  callback: MutationCallback;

  disconnected = false;

  observed: Array<{ options: MutationObserverInit; target: Node }> = [];

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emit(records: Partial<MutationRecord>[]): void {
    this.callback(records as MutationRecord[], this as unknown as MutationObserver);
  }

  observe(target: Node, options: MutationObserverInit): void {
    this.observed.push({
      options,
      target,
    });
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  callback: ResizeObserverCallback;

  disconnected = false;

  observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emit(): void {
    this.callback([], this as unknown as ResizeObserver);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }
}

/** Original jsdom MutationObserver constructor. */
const ORIGINAL_MUTATION_OBSERVER = window.MutationObserver;

/** Original jsdom ResizeObserver constructor. */
const ORIGINAL_RESIZE_OBSERVER = window.ResizeObserver;

/**
 * Replaces the observer constructor on the active runtime Window.
 *
 * @param value - MutationObserver constructor or an unavailable sentinel.
 */
function setWindowMutationObserver(value: typeof MutationObserver | undefined): void {
  Object.defineProperty(window, 'MutationObserver', {
    configurable: true,
    value,
  });
}

/**
 * Replaces the observer constructor on the active runtime Window.
 *
 * @param value - ResizeObserver constructor or an unavailable sentinel.
 */
function setWindowResizeObserver(value: typeof ResizeObserver | undefined): void {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value,
  });
}

describe('ObserverController', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setWindowMutationObserver(ORIGINAL_MUTATION_OBSERVER);
    setWindowResizeObserver(ORIGINAL_RESIZE_OBSERVER);
    FakeMutationObserver.instances = [];
    FakeResizeObserver.instances = [];
  });

  it('keeps update sources disconnected in manual mode', () => {
    vi.useFakeTimers();
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const runtimeContext = createRuntimeContext();
    const scheduler = {
      request: vi.fn(),
    };
    const connectScrollListener = vi.spyOn(runtimeContext.scrollContext, 'connectScrollListener');
    const observer = new ObserverController({
      getRuntimeContext: () => runtimeContext,
      scheduler,
    });
    const addDocumentListener = vi.spyOn(document, 'addEventListener');

    try {
      observer.connect(
        createObserverOptions({
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        }),
      );

      // A valid runtime context is supplied, so connect() actually reaches every
      // per-source branch instead of returning early. Each disabled source must
      // install nothing observable rather than passing the test by accident:
      // no mutation observer, no resize observer, no scroll listener (neither the
      // authoritative one nor the descendant document listener), no interval
      // timer, and the scheduler stays untouched until a real update source fires.
      expect(FakeMutationObserver.instances).toHaveLength(0);
      expect(FakeResizeObserver.instances).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(connectScrollListener).not.toHaveBeenCalled();
      expect(addDocumentListener.mock.calls.some(([type]) => type === 'scroll')).toBe(false);
      expect(scheduler.request).not.toHaveBeenCalled();
    } finally {
      // Both the controller resources and the document spy must be released
      // even when an assertion above throws, otherwise they would leak into the
      // following test cases. The spy is restored even if destroy() throws.
      try {
        observer.destroy();
      } finally {
        addDocumentListener.mockRestore();
      }
    }
  });

  it('continues observer cleanup after one resource throws', () => {
    const disconnectError = new Error('mutation disconnect failed');

    class ThrowingDisconnectMutationObserver extends FakeMutationObserver {
      override disconnect(): void {
        super.disconnect();
        throw disconnectError;
      }
    }

    setWindowMutationObserver(ThrowingDisconnectMutationObserver as unknown as typeof MutationObserver);
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler: { request: vi.fn() },
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { debounce: 0 },
          resize: { debounce: 0 },
          scroll: { enabled: false },
        },
      }),
    );

    expect(() => observer.disconnect()).toThrow(disconnectError);
    expect(FakeMutationObserver.instances[0]?.disconnected).toBe(true);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
    expect(observer.connected).toBe(false);
    expect(() => observer.disconnect()).not.toThrow();
    expect(() => observer.destroy()).not.toThrow();
  });

  it('clears remaining listener ownership when scroll unsubscribe throws', () => {
    const unsubscribeError = new Error('scroll unsubscribe failed');
    const unsubscribe = vi.fn(() => {
      throw unsubscribeError;
    });
    const scrollContext = new WindowScrollContext(window);
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');

    vi.spyOn(scrollContext, 'connectScrollListener').mockReturnValue(unsubscribe);

    const observer = new ObserverController({
      getRuntimeContext: () => ({
        ...createRuntimeContext(),
        scrollContext,
      }),
      scheduler: { request: vi.fn() },
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: true },
        },
      }),
    );

    expect(() => observer.disconnect()).toThrow(unsubscribeError);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeDocumentListener).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true });
    expect(observer.connected).toBe(false);
    expect(() => observer.disconnect()).not.toThrow();
    expect(() => observer.destroy()).not.toThrow();
  });

  it('requests marker updates from interval mode and cancels them on disconnect', () => {
    vi.useFakeTimers();

    const scheduler = {
      request: vi.fn(),
    };
    const diagnostics = {
      recordObserverEvent: vi.fn(),
    };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          interval: { enabled: true, delay: 25 },
          resize: { enabled: false },
          scroll: { enabled: false },
          mutation: { enabled: false },
        },
      }),
    );

    expect(observer.connected).toBe(true);

    vi.advanceTimersByTime(25);

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('interval');
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, {
      source: 'interval',
    });

    observer.disconnect();
    scheduler.request.mockClear();
    vi.advanceTimersByTime(25);

    expect(observer.connected).toBe(false);
    expect(scheduler.request).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('polls with the default delay when interval mode is selected by itself', () => {
    vi.useFakeTimers();

    const scheduler = {
      request: vi.fn(),
    };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          resize: { enabled: false },
          scroll: { enabled: false },
          mutation: { enabled: false },
          interval: { enabled: true },
        },
      }),
    );

    vi.advanceTimersByTime(999);
    expect(scheduler.request).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, {
      source: 'interval',
    });

    observer.destroy();
  });

  it('allows polling to be disabled explicitly in interval mode', () => {
    vi.useFakeTimers();

    const scheduler = {
      request: vi.fn(),
    };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          interval: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          mutation: { enabled: false },
        },
      }),
    );

    vi.advanceTimersByTime(1000);
    expect(scheduler.request).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('observes resolved mutation targets and ignores tracker-owned mutations', () => {
    vi.useFakeTimers();
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const root = document.createElement('div');
    const scheduler = {
      request: vi.fn(),
    };
    const diagnostics = {
      recordObserverEvent: vi.fn(),
    };
    const observer = new ObserverController({
      diagnostics,
      getRoot: () => root,
      getRuntimeContext: () => createRuntimeContext(root),
      scheduler,
    });

    document.body.appendChild(root);
    observer.connect(
      createObserverOptions({
        updates: {
          mutation: {
            debounce: 0,
            enabled: true,
            options: {
              attributes: true,
              childList: true,
              subtree: true,
            },
            targets: () => [document.body],
          },
          resize: {
            enabled: false,
          },
          scroll: {
            enabled: false,
          },
        },
      }),
    );

    expect(FakeMutationObserver.instances).toHaveLength(1);
    expect(FakeMutationObserver.instances[0]?.observed).toEqual([
      {
        options: {
          attributes: true,
          characterData: false,
          childList: true,
          subtree: true,
        },
        target: document.body,
      },
    ]);

    FakeMutationObserver.instances[0]?.emit([
      {
        target: root,
        type: 'attributes',
      },
    ]);
    vi.runOnlyPendingTimers();

    expect(scheduler.request).not.toHaveBeenCalled();

    FakeMutationObserver.instances[0]?.emit([
      {
        target: document.body,
        type: 'attributes',
      },
    ]);
    vi.runOnlyPendingTimers();

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('mutation');
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, {
      source: 'mutation',
    });

    observer.destroy();
    root.remove();
  });

  it('uses the active DOM context window for observers and scroll listeners', () => {
    const iframe = document.createElement('iframe');

    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument!;
    const frameWindow = iframe.contentWindow!;
    const addFrameListener = vi.spyOn(frameWindow, 'addEventListener');
    const removeFrameListener = vi.spyOn(frameWindow, 'removeEventListener');
    const root = frameDocument.createElement('div');

    frameDocument.body.appendChild(root);
    const observer = new ObserverController({
      getRoot: () => root,
      getRuntimeContext: () => createRuntimeContext(root, frameDocument, frameWindow),
      scheduler: { request: vi.fn() },
    });

    Object.defineProperty(frameWindow, 'MutationObserver', {
      configurable: true,
      value: FakeMutationObserver,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: {
            debounce: 0,
            enabled: true,
            targets: () => [frameDocument.body],
          },
          resize: { enabled: false },
        },
      }),
    );

    expect(FakeMutationObserver.instances).toHaveLength(1);
    expect(FakeMutationObserver.instances[0]?.observed[0]?.target).toBe(frameDocument.body);
    expect(addFrameListener.mock.calls.some(([type]) => type === 'scroll')).toBe(true);

    observer.disconnect();

    expect(removeFrameListener.mock.calls.some(([type]) => type === 'scroll')).toBe(true);

    addFrameListener.mockRestore();
    removeFrameListener.mockRestore();
    observer.destroy();
    iframe.remove();
  });

  it('auto-enables attributes and characterData for dependent mutation observer fields', () => {
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const cases: Array<{ options: TrackerMutationObserverOptions; expected: MutationObserverInit }> = [
      {
        options: { attributeFilter: ['class'] },
        expected: {
          attributeFilter: ['class'],
          attributes: true,
          characterData: false,
          childList: true,
          subtree: true,
        },
      },
      {
        options: { attributeOldValue: true },
        expected: {
          attributeOldValue: true,
          attributes: true,
          characterData: false,
          childList: true,
          subtree: true,
        },
      },
      {
        options: { characterDataOldValue: true },
        expected: {
          attributes: false,
          characterData: true,
          characterDataOldValue: true,
          childList: true,
          subtree: true,
        },
      },
      {
        options: { attributeOldValue: true, attributes: false },
        expected: {
          attributeOldValue: true,
          attributes: true,
          characterData: false,
          childList: true,
          subtree: true,
        },
      },
      {
        options: { characterDataOldValue: true, characterData: false },
        expected: {
          attributes: false,
          characterData: true,
          characterDataOldValue: true,
          childList: true,
          subtree: true,
        },
      },
    ];

    cases.forEach(({ options, expected }, index) => {
      const observer = new ObserverController({
        getRuntimeContext: () => createRuntimeContext(),
        scheduler: { request: vi.fn() },
      });

      observer.connect(
        createObserverOptions({
          updates: {
            mutation: {
              debounce: 0,
              enabled: true,
              options,
              targets: () => [document.body],
            },
            resize: {
              enabled: false,
            },
            scroll: {
              enabled: false,
            },
          },
        }),
      );

      expect(FakeMutationObserver.instances[index]?.observed[0]?.options).toEqual(expected);

      observer.destroy();
    });
  });

  it('treats an empty attributeFilter as absent when computing mutation observer options', () => {
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler: { request: vi.fn() },
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: {
            debounce: 0,
            enabled: true,
            options: { attributeFilter: [], childList: false, subtree: false },
            targets: () => [document.body],
          },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      }),
    );

    expect(FakeMutationObserver.instances[0]?.observed[0]?.options).toEqual({
      attributes: false,
      characterData: false,
      childList: false,
      subtree: false,
    });

    observer.destroy();
  });

  it('reconnects observers only when update options change', () => {
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const scheduler = {
      request: vi.fn(),
    };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });
    const options = createObserverOptions({
      updates: {
        mutation: {
          debounce: 10,
          enabled: true,
          targets: () => [document.body],
        },
        resize: {
          enabled: false,
        },
        scroll: {
          enabled: false,
        },
      },
    });

    observer.connect(options);

    const firstObserver = FakeMutationObserver.instances[0];

    observer.update(options);

    expect(FakeMutationObserver.instances).toHaveLength(1);

    observer.update(
      createObserverOptions({
        updates: {
          mutation: {
            debounce: 20,
            enabled: true,
            targets: options.updates.mutation.targets,
          },
          resize: {
            enabled: false,
          },
          scroll: {
            enabled: false,
          },
        },
      }),
    );

    expect(firstObserver?.disconnected).toBe(true);
    expect(FakeMutationObserver.instances).toHaveLength(2);

    observer.destroy();
  });

  it('coalesces scroll events through animation frames and cancels pending frames', () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
        },
      }),
    );

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks[0]!(0);

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('scroll');
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'scroll' });

    window.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(2);

    observer.disconnect();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(2);

    frameCallbacks[1]!(0);

    expect(scheduler.request).toHaveBeenCalledTimes(1);

    scheduler.request.mockClear();
    window.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(2);
    expect(scheduler.request).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('ignores an obsolete scroll frame after disconnect and reconnect when cancellation is ineffective', () => {
    const frameCallbacks: FrameRequestCallback[] = [];

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(createObserverOptions({ updates: { mutation: { enabled: false }, resize: { enabled: false } } }));
    window.dispatchEvent(new Event('scroll'));
    observer.disconnect();
    observer.connect(createObserverOptions({ updates: { mutation: { enabled: false }, resize: { enabled: false } } }));

    frameCallbacks[0]!(0);

    expect(scheduler.request).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('ignores an obsolete MutationObserver callback delivered after disconnect and reconnect', () => {
    vi.useFakeTimers();
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    const connectOptions = createObserverOptions({
      updates: {
        mutation: { debounce: 0 },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });

    observer.connect(connectOptions);

    const staleMutationObserver = FakeMutationObserver.instances[0];

    observer.disconnect();
    observer.connect(connectOptions);

    expect(FakeMutationObserver.instances).toHaveLength(2);

    staleMutationObserver?.emit([{ target: document.body, type: 'attributes' }]);
    vi.runOnlyPendingTimers();

    expect(scheduler.request).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('ignores an obsolete ResizeObserver callback delivered after disconnect and reconnect', () => {
    vi.useFakeTimers();
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    const connectOptions = createObserverOptions({
      updates: {
        mutation: { enabled: false },
        resize: { debounce: 0 },
        scroll: { enabled: false },
      },
    });

    observer.connect(connectOptions);

    const staleResizeObserver = FakeResizeObserver.instances[0];

    observer.disconnect();
    observer.connect(connectOptions);

    expect(FakeResizeObserver.instances).toHaveLength(2);

    staleResizeObserver?.emit();
    vi.runOnlyPendingTimers();

    expect(scheduler.request).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('requests marker updates from debounced window resize events', () => {
    vi.useFakeTimers();

    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 10 },
          scroll: { enabled: false },
        },
      }),
    );

    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('resize');
    expect(scheduler.request).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);

    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'window-resize' });

    observer.destroy();
  });

  it('observes resolved resize targets and requests marker updates', () => {
    vi.useFakeTimers();
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const root = document.createElement('div');
    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRoot: () => root,
      getRuntimeContext: () => createRuntimeContext(root),
      scheduler,
    });

    document.body.appendChild(root);
    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 0 },
          scroll: { enabled: false },
        },
      }),
    );

    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]?.observed).toEqual([document.body, root]);

    FakeResizeObserver.instances[0]?.emit();
    vi.runOnlyPendingTimers();

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('resize');
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'resize-observer' });

    observer.destroy();

    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);

    root.remove();
  });

  it('coalesces ResizeObserver and window resize signals through one request channel', () => {
    vi.useFakeTimers();
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 10 },
          scroll: { enabled: false },
        },
      }),
    );

    FakeResizeObserver.instances[0]?.emit();
    window.dispatchEvent(new Event('resize'));

    vi.advanceTimersByTime(10);

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledTimes(2);
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, {
      reasons: [{ source: 'resize-observer' }, { source: 'window-resize' }],
    });

    observer.destroy();
  });

  it('cancels the shared pending resize request on disconnect', () => {
    vi.useFakeTimers();
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 10 },
          scroll: { enabled: false },
        },
      }),
    );

    FakeResizeObserver.instances[0]?.emit();
    window.dispatchEvent(new Event('resize'));
    observer.disconnect();
    vi.advanceTimersByTime(10);

    expect(scheduler.request).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('replaces the shared resize debounce delay when options change', () => {
    vi.useFakeTimers();

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 10 },
          scroll: { enabled: false },
        },
      }),
    );
    window.dispatchEvent(new Event('resize'));

    observer.update(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 20 },
          scroll: { enabled: false },
        },
      }),
    );
    window.dispatchEvent(new Event('resize'));

    vi.advanceTimersByTime(19);
    expect(scheduler.request).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'window-resize' });

    observer.destroy();
  });

  it('warns when resize observation fails or resolves no targets', () => {
    class ThrowingResizeObserver extends FakeResizeObserver {
      observe(): void {
        throw new Error('observe failed');
      }
    }

    setWindowResizeObserver(ThrowingResizeObserver as unknown as typeof ResizeObserver);

    const scheduler = { request: vi.fn() };
    const diagnostics = { warn: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });
    const baseUpdates = {
      mutation: { enabled: false },
      scroll: { enabled: false },
    };

    observer.connect(
      createObserverOptions({
        updates: { ...baseUpdates, resize: { debounce: 0 } },
      }),
    );

    expect(diagnostics.warn).toHaveBeenCalledWith(
      'resize-observer-observe-failed',
      expect.any(String),
      expect.objectContaining({
        error: 'observe failed',
        target: expect.objectContaining({ candidateType: 'node' }),
      }),
    );
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
    expect(diagnostics.warn).toHaveBeenCalledWith('WARN_TRACKER_OBSERVER_EMPTY_TARGETS', expect.any(String), {
      observerType: 'resize',
      reason: 'observe-failed',
    });

    observer.connect(
      createObserverOptions({
        updates: { ...baseUpdates, resize: { debounce: 0, targets: () => [] } },
      }),
    );

    expect(diagnostics.warn).toHaveBeenCalledWith('WARN_TRACKER_OBSERVER_EMPTY_TARGETS', expect.any(String), {
      observerType: 'resize',
    });

    observer.destroy();
  });

  it('retains ResizeObserver when at least one resolved target is observed', () => {
    class PartiallyThrowingResizeObserver extends FakeResizeObserver {
      observe(target: Element): void {
        if (target === document.body) {
          throw new Error('body observe failed');
        }

        super.observe(target);
      }
    }

    setWindowResizeObserver(PartiallyThrowingResizeObserver as unknown as typeof ResizeObserver);

    const scheduler = { request: vi.fn() };
    const diagnostics = { warn: vi.fn() };
    const runtimeContext = createRuntimeContext();
    const successfulTarget = document.createElement('div');
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => runtimeContext,
      scheduler,
    });

    document.body.appendChild(successfulTarget);
    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 0, targets: () => [document.body, successfulTarget] },
          scroll: { enabled: false },
        },
      }),
    );

    expect(FakeResizeObserver.instances[0]?.observed).toEqual([successfulTarget]);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(false);
    expect(diagnostics.warn).not.toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_EMPTY_TARGETS',
      expect.any(String),
      expect.objectContaining({ reason: 'observe-failed' }),
    );

    observer.destroy();
  });

  it('warns when mutation observation is unavailable, fails or resolves no targets', () => {
    const scheduler = { request: vi.fn() };
    const diagnostics = { warn: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });
    const baseUpdates = {
      resize: { enabled: false },
      scroll: { enabled: false },
    };

    setWindowMutationObserver(undefined);
    observer.connect(
      createObserverOptions({
        updates: { ...baseUpdates, mutation: { debounce: 0 } },
      }),
    );

    expect(diagnostics.warn).toHaveBeenCalledWith('mutation-observer-unavailable', expect.any(String));

    class ThrowingMutationObserver extends FakeMutationObserver {
      observe(): void {
        throw new Error('observe failed');
      }
    }

    setWindowMutationObserver(ThrowingMutationObserver as unknown as typeof MutationObserver);
    observer.connect(
      createObserverOptions({
        updates: { ...baseUpdates, mutation: { debounce: 0, targets: () => [document.body] } },
      }),
    );

    expect(diagnostics.warn).toHaveBeenCalledWith(
      'mutation-observer-observe-failed',
      expect.any(String),
      expect.objectContaining({
        error: 'observe failed',
        target: expect.objectContaining({ candidateType: 'node' }),
      }),
    );
    expect(FakeMutationObserver.instances[0]?.disconnected).toBe(true);
    expect(diagnostics.warn).toHaveBeenCalledWith('WARN_TRACKER_OBSERVER_EMPTY_TARGETS', expect.any(String), {
      observerType: 'mutation',
      reason: 'observe-failed',
    });

    observer.connect(
      createObserverOptions({
        updates: { ...baseUpdates, mutation: { debounce: 0, targets: () => [] } },
      }),
    );

    expect(diagnostics.warn).toHaveBeenCalledWith('WARN_TRACKER_OBSERVER_EMPTY_TARGETS', expect.any(String), {
      observerType: 'mutation',
    });

    observer.destroy();
  });

  it('keeps window resize fallback active when ResizeObserver is unavailable', () => {
    vi.useFakeTimers();
    setWindowResizeObserver(undefined);

    const scheduler = { request: vi.fn() };
    const diagnostics = { warn: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 5 },
          scroll: { enabled: false },
        },
      }),
    );

    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(5);

    expect(diagnostics.warn).toHaveBeenCalledWith('resize-observer-unavailable', expect.any(String));
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'window-resize' });

    observer.destroy();
  });

  it('classifies childList mutations against the tracker root', () => {
    vi.useFakeTimers();
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const root = document.createElement('div');
    const ownChild = document.createElement('div');
    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRoot: () => root,
      getRuntimeContext: () => createRuntimeContext(root),
      scheduler,
    });

    root.appendChild(ownChild);
    document.body.appendChild(root);
    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { debounce: 0, targets: () => [document.body] },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      }),
    );

    const mutationObserver = FakeMutationObserver.instances[0];

    mutationObserver?.emit([
      {
        addedNodes: [ownChild] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
        target: document.body,
        type: 'childList',
      },
    ]);
    vi.runOnlyPendingTimers();

    expect(scheduler.request).not.toHaveBeenCalled();

    mutationObserver?.emit([
      {
        addedNodes: [document.createElement('div')] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
        target: document.body,
        type: 'childList',
      },
    ]);
    vi.runOnlyPendingTimers();

    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'mutation' });

    observer.destroy();
    root.remove();
  });

  it('coalesces descendant scroll into one marker request per frame without scanning', () => {
    const frameCallbacks: FrameRequestCallback[] = [];

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const sourceRoot = document.createElement('div');
    const scroller = document.createElement('div');

    sourceRoot.appendChild(scroller);
    document.body.appendChild(sourceRoot);

    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => ({ ...createRuntimeContext(), sourceRoot }),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
        },
      }),
    );

    scroller.dispatchEvent(new Event('scroll'));
    scroller.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(1);
    expect(scheduler.request).not.toHaveBeenCalled();

    frameCallbacks[0]!(0);

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('scroll');
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'scroll' });

    scroller.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(2);

    observer.destroy();
    sourceRoot.remove();
  });

  it('captures descendant scroll inside the containing ShadowRoot', () => {
    const frameCallbacks: FrameRequestCallback[] = [];

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const host = document.createElement('div');

    document.body.appendChild(host);

    const sourceRoot = host.attachShadow({ mode: 'open' });
    const scroller = document.createElement('div');

    sourceRoot.appendChild(scroller);

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => ({ ...createRuntimeContext(), sourceRoot }),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
        },
      }),
    );

    scroller.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks[0]!(0);

    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'scroll' });

    observer.destroy();
    host.remove();
  });

  it('ignores descendant scroll from documents, the scroll root, outside subtrees and internal DOM', () => {
    const frameCallbacks: FrameRequestCallback[] = [];

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const scrollRoot = document.createElement('div');
    const sourceRoot = document.createElement('div');
    const internalRoot = document.createElement('div');
    const outside = document.createElement('div');

    scrollRoot.appendChild(sourceRoot);
    sourceRoot.appendChild(internalRoot);
    document.body.append(scrollRoot, outside);

    const registry = getInternalDomRegistry(document);

    registry.register(internalRoot, 'render');

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => ({
        ...createRuntimeContext(),
        scrollMode: 'element',
        scrollRoot,
        sourceRoot,
      }),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
        },
      }),
    );

    document.dispatchEvent(new Event('scroll'));
    scrollRoot.dispatchEvent(new Event('scroll'));
    outside.dispatchEvent(new Event('scroll'));
    internalRoot.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(0);

    sourceRoot.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(1);

    observer.destroy();
    registry.release(internalRoot);
    scrollRoot.remove();
    outside.remove();
  });

  it('cleans descendant scroll up idempotently and reconnects it on options update', () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

    const sourceRoot = document.createElement('div');
    const scroller = document.createElement('div');

    sourceRoot.appendChild(scroller);
    document.body.appendChild(sourceRoot);

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => ({ ...createRuntimeContext(), sourceRoot }),
      scheduler,
    });
    const connectOptions = createObserverOptions({
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
      },
    });

    observer.connect(connectOptions);
    scroller.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(1);

    observer.disconnect();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

    observer.disconnect();
    scroller.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(1);

    observer.connect(connectOptions);
    observer.update(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          interval: { enabled: true, delay: 500 },
        },
      }),
    );
    scroller.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(2);

    observer.destroy();
    scroller.dispatchEvent(new Event('scroll'));

    expect(frameCallbacks).toHaveLength(2);

    sourceRoot.remove();
  });

  it('supports the broad body observation recipe while excluding internal mutations', () => {
    vi.useFakeTimers();
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const internalRoot = document.createElement('div');
    const internalChild = document.createElement('div');

    internalRoot.appendChild(internalChild);
    document.body.appendChild(internalRoot);

    const registry = getInternalDomRegistry(document);

    registry.register(internalRoot, 'render');

    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: {
            debounce: 0,
            enabled: true,
            targets: ({ document: activeDocument }) => [activeDocument.body],
          },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      }),
    );

    expect(FakeMutationObserver.instances[0]?.observed[0]?.target).toBe(document.body);

    FakeMutationObserver.instances[0]?.emit([
      {
        target: internalChild,
        type: 'attributes',
      },
      {
        addedNodes: [internalRoot] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
        target: document.body,
        type: 'childList',
      },
    ]);
    vi.runOnlyPendingTimers();

    expect(scheduler.request).not.toHaveBeenCalled();

    FakeMutationObserver.instances[0]?.emit([
      {
        target: document.body,
        type: 'attributes',
      },
    ]);
    vi.runOnlyPendingTimers();

    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'mutation' });

    observer.destroy();
    registry.release(internalRoot);
    internalRoot.remove();
  });

  it('accepts an open ShadowRoot as an explicit mutation target', () => {
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const host = document.createElement('div');

    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const diagnostics = { warn: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler: { request: vi.fn() },
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { debounce: 0, enabled: true, targets: () => [shadowRoot] },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      }),
    );

    expect(FakeMutationObserver.instances[0]?.observed.map((entry) => entry.target)).toEqual([shadowRoot]);
    expect(diagnostics.warn).not.toHaveBeenCalled();

    observer.destroy();
    host.remove();
  });

  it('derives scoped default targets from a ShadowRoot source root', () => {
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const host = document.createElement('div');
    const renderRoot = document.createElement('div');

    document.body.append(host, renderRoot);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const observer = new ObserverController({
      getRoot: () => renderRoot,
      getRuntimeContext: () => ({ ...createRuntimeContext(renderRoot), sourceRoot: shadowRoot }),
      scheduler: { request: vi.fn() },
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { debounce: 0, enabled: true },
          resize: { debounce: 0, enabled: true },
          scroll: { enabled: false },
        },
      }),
    );

    expect(FakeMutationObserver.instances[0]?.observed.map((entry) => entry.target)).toEqual([shadowRoot]);
    expect(FakeResizeObserver.instances[0]?.observed).toEqual([host, renderRoot]);

    observer.destroy();
    host.remove();
    renderRoot.remove();
  });

  it('applies context patches to scheduler, diagnostics and providers', () => {
    const frameCallbacks: FrameRequestCallback[] = [];

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const initialScheduler = { request: vi.fn() };
    const nextScheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler: initialScheduler,
    });

    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
        },
      }),
    );

    observer.updateContext({
      diagnostics: null,
      scheduler: nextScheduler,
    });
    observer.updateContext({});

    window.dispatchEvent(new Event('scroll'));
    frameCallbacks[0]!(0);

    expect(initialScheduler.request).not.toHaveBeenCalled();
    expect(nextScheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'scroll' });
    expect(diagnostics.recordObserverEvent).not.toHaveBeenCalled();

    observer.destroy();
  });

  it('ignores a MutationObserver callback that fires after disconnect()', () => {
    vi.useFakeTimers();
    setWindowMutationObserver(FakeMutationObserver as unknown as typeof MutationObserver);

    const root = document.createElement('div');
    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRoot: () => root,
      getRuntimeContext: () => createRuntimeContext(root),
      scheduler,
    });

    document.body.appendChild(root);
    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { debounce: 0 },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      }),
    );

    const mutationObserver = FakeMutationObserver.instances[0];

    observer.disconnect();
    mutationObserver?.emit([{ target: root, type: 'attributes' }]);
    vi.runOnlyPendingTimers();

    expect(diagnostics.recordObserverEvent).not.toHaveBeenCalled();
    expect(scheduler.request).not.toHaveBeenCalled();

    root.remove();
  });

  it('ignores a ResizeObserver callback that fires after disconnect()', () => {
    vi.useFakeTimers();
    setWindowResizeObserver(FakeResizeObserver as unknown as typeof ResizeObserver);

    const root = document.createElement('div');
    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRoot: () => root,
      getRuntimeContext: () => createRuntimeContext(root),
      scheduler,
    });

    document.body.appendChild(root);
    observer.connect(
      createObserverOptions({
        updates: {
          mutation: { enabled: false },
          resize: { debounce: 0 },
          scroll: { enabled: false },
        },
      }),
    );

    const resizeObserver = FakeResizeObserver.instances[0];

    observer.disconnect();
    resizeObserver?.emit();
    vi.runOnlyPendingTimers();

    expect(diagnostics.recordObserverEvent).not.toHaveBeenCalled();
    expect(scheduler.request).not.toHaveBeenCalled();

    root.remove();
  });

  it('ignores an interval callback retained from an earlier connection', () => {
    const intervalCallbacks: Array<() => void> = [];
    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    vi.spyOn(window, 'setInterval').mockImplementation((callback) => {
      intervalCallbacks.push(callback as () => void);
      return intervalCallbacks.length as unknown as ReturnType<typeof window.setInterval>;
    });
    vi.spyOn(window, 'clearInterval').mockImplementation(() => {});

    const options = createObserverOptions({
      updates: {
        interval: { delay: 10, enabled: true },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });

    observer.connect(options);
    observer.disconnect();
    observer.connect(options);

    intervalCallbacks[0]?.();

    expect(diagnostics.recordObserverEvent).not.toHaveBeenCalled();
    expect(scheduler.request).not.toHaveBeenCalled();

    intervalCallbacks[1]?.();

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('interval');
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'interval' });

    observer.destroy();
  });

  it('ignores a window resize listener retained from an earlier connection', () => {
    vi.useFakeTimers();
    setWindowResizeObserver(undefined);

    const resizeHandlers: Array<() => void> = [];
    const scheduler = { request: vi.fn() };
    const diagnostics = { recordObserverEvent: vi.fn() };
    const observer = new ObserverController({
      diagnostics,
      getRuntimeContext: () => createRuntimeContext(),
      scheduler,
    });

    vi.spyOn(window, 'addEventListener').mockImplementation((eventType, listener) => {
      if (eventType === 'resize' && typeof listener === 'function') {
        resizeHandlers.push(listener as () => void);
      }
    });

    const options = createObserverOptions({
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { debounce: 0, enabled: true },
        scroll: { enabled: false },
      },
    });

    observer.connect(options);
    observer.disconnect();
    observer.connect(options);

    resizeHandlers[0]?.();
    vi.runOnlyPendingTimers();

    expect(diagnostics.recordObserverEvent).not.toHaveBeenCalled();
    expect(scheduler.request).not.toHaveBeenCalled();

    resizeHandlers[1]?.();
    vi.runOnlyPendingTimers();

    expect(diagnostics.recordObserverEvent).toHaveBeenCalledWith('resize');
    expect(scheduler.request).toHaveBeenCalledWith(RENDER_TARGETS.MARKERS, { source: 'window-resize' });

    observer.destroy();
  });

  it('ignores authoritative and descendant scroll listeners retained from an earlier connection', () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const authoritativeHandlers: Array<() => void> = [];
    const descendantHandlers: Array<(event: Event) => void> = [];
    const sourceTarget = document.createElement('div');
    const runtimeContext = createRuntimeContext();
    const scheduler = { request: vi.fn() };
    const observer = new ObserverController({
      getRuntimeContext: () => runtimeContext,
      scheduler,
    });

    document.body.appendChild(sourceTarget);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(runtimeContext.scrollContext, 'connectScrollListener').mockImplementation((handler) => {
      authoritativeHandlers.push(handler);
      return () => {};
    });
    vi.spyOn(document, 'addEventListener').mockImplementation((eventType, listener) => {
      if (eventType === 'scroll' && typeof listener === 'function') {
        descendantHandlers.push(listener as (event: Event) => void);
      }
    });

    const options = createObserverOptions({
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: true },
      },
    });

    observer.connect(options);
    observer.disconnect();
    observer.connect(options);

    const descendantEvent = new Event('scroll');

    Object.defineProperty(descendantEvent, 'target', { value: sourceTarget });
    authoritativeHandlers[0]?.();
    descendantHandlers[0]?.(descendantEvent);

    expect(frameCallbacks).toHaveLength(0);

    authoritativeHandlers[1]?.();
    expect(frameCallbacks).toHaveLength(1);
    frameCallbacks[0]?.(0);

    descendantHandlers[1]?.(descendantEvent);
    expect(frameCallbacks).toHaveLength(2);

    observer.destroy();
    sourceTarget.remove();
  });
});
