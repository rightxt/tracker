// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTRIBUTES, EVENT_NAMES, createTrackerStateIntegration } from '../../__tests__/testIntegration.js';

/**
 * Creates a PointerEvent-compatible jsdom event with explicit pointer metadata.
 *
 * @param type - Pointer event type.
 * @param init - Pointer metadata and mouse event initialization.
 * @returns PointerEvent-compatible event.
 */
function createPointerEvent(
  type: string,
  init: MouseEventInit & { isPrimary?: boolean; pointerId?: number } = {},
): PointerEvent {
  const event = new MouseEvent(type, init);

  Object.defineProperties(event, {
    isPrimary: { value: init.isPrimary ?? true },
    pointerId: { value: init.pointerId ?? 1 },
  });

  return event as PointerEvent;
}

/**
 * Creates a mounted runtime with one manually activated marker.
 *
 * @returns Runtime, target, source element, and first snapshot item.
 */
function createMountedRuntimeWithMarker() {
  const source = document.createElement('div');
  const target = document.createElement('div');
  const runtime = createTrackerStateIntegration({
    options: {
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    },
    rules: [
      {
        scroll: false,
        selector: '.target',
      },
    ],
  });

  source.className = 'target';
  document.body.append(source, target);
  runtime.mount({ renderRoot: target });

  const [item] = runtime.getSnapshotProps().items;

  return {
    item: item!,
    runtime,
    source,
    target,
  };
}

/**
 * Creates a mounted runtime with default delegated interaction enabled.
 *
 * Core connects the delegated interaction handlers to the mount target during
 * `mount()`, so this helper only mounts the runtime and appends one marker
 * element addressed by the first snapshot item's activation key.
 *
 * @param options - Runtime option overrides.
 * @returns Runtime, target, source element, marker element, and first snapshot item.
 */
function createMountedRuntimeWithDelegatedMarker(options = {}) {
  const source = document.createElement('div');
  const target = document.createElement('div');
  const runtime = createTrackerStateIntegration({
    options: {
      ...options,
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    },
    rules: [
      {
        scroll: false,
        selector: '.target',
      },
    ],
  });

  source.className = 'target';
  document.body.append(source, target);
  runtime.mount({ renderRoot: target });

  const [item] = runtime.getSnapshotProps().items;
  const marker = document.createElement('div');

  marker.setAttribute(DATA_ATTRIBUTES.KEY, item!.activationKey);
  target.appendChild(marker);

  return {
    item: item!,
    marker,
    runtime,
    source,
    target,
  };
}

/**
 * Creates a mounted runtime with several keyboard-addressable markers.
 *
 * @returns Runtime, target, and source elements.
 */
function createMountedKeyboardRuntime() {
  const first = document.createElement('div');
  const second = document.createElement('div');
  const third = document.createElement('div');
  const target = document.createElement('div');
  const runtime = createTrackerStateIntegration({
    options: {
      a11y: {
        enabled: true,
        keyboard: true,
      },
      clustering: {
        enabled: false,
      },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    },
    rules: [
      {
        scroll: false,
        selector: '.first-target',
      },
      {
        scroll: false,
        selector: '.second-target',
      },
      {
        scroll: false,
        selector: '.third-target',
      },
    ],
  });

  first.className = 'first-target';
  second.className = 'second-target';
  third.className = 'third-target';
  document.body.append(first, second, third, target);
  runtime.mount({ renderRoot: target });

  return {
    first,
    runtime,
    second,
    target,
    third,
  };
}

/** Pending DOM-metric descriptor restorers applied after each test. */
const domMetricRestorers: Array<() => void> = [];

/**
 * Overrides a read-only DOM metric for the current test and registers its
 * restoration.
 *
 * The original own property descriptor (or its absence) is captured so the
 * metric is returned to its real accessor after the test, even when an
 * assertion fails first.
 *
 * @param target - Object that owns the metric.
 * @param key - Metric property name.
 * @param value - Overridden metric value.
 */
function overrideDomMetric(target: object, key: string, value: number): void {
  const original = Object.getOwnPropertyDescriptor(target, key);

  domMetricRestorers.push(() => {
    if (original === undefined) {
      Reflect.deleteProperty(target, key);

      return;
    }

    Object.defineProperty(target, key, original);
  });
  Object.defineProperty(target, key, {
    configurable: true,
    value,
  });
}

/**
 * Restores every DOM metric and spy installed during the finished test.
 *
 * Some pointer-session cases spy on shared `document` listener methods, so
 * `vi.restoreAllMocks()` runs unconditionally to keep those spies from leaking
 * into sibling tests when an assertion fails before an inline restore.
 */
afterEach(() => {
  domMetricRestorers
    .splice(0)
    .reverse()
    .forEach((restore) => {
      restore();
    });
  vi.restoreAllMocks();
});

describe('core manual interaction helpers', () => {
  it('activates a render record by activation key and ignores the same event on repeat', () => {
    const { item, runtime, source, target } = createMountedRuntimeWithMarker();
    const handler = vi.fn();
    const sourceEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);

    expect(runtime.activateRenderRecord(item.activationKey, sourceEvent)).toBe(true);
    expect(runtime.activateRenderRecord(item.activationKey, sourceEvent)).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      element: source,
      selector: '.target',
      sourceEvent,
    });

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('activates a marker from a framework-owned root event, includes its key, and excludes track:activate', () => {
    const { item, runtime, source, target } = createMountedRuntimeWithMarker();
    const marker = document.createElement('div');
    const markerHandler = vi.fn();
    const trackHandler = vi.fn();
    const sourceEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    marker.setAttribute(DATA_ATTRIBUTES.KEY, item.activationKey);
    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, markerHandler);
    runtime.on(EVENT_NAMES.TRACK_ACTIVATE, trackHandler);
    marker.dispatchEvent(sourceEvent);
    target.appendChild(marker);

    expect(runtime.activateFromEvent(sourceEvent)).toBe(true);
    expect(markerHandler).toHaveBeenCalledTimes(1);
    expect(markerHandler.mock.calls[0]?.[0]).toMatchObject({
      element: source,
      key: item.activationKey,
      selector: '.target',
      sourceEvent,
    });
    expect(trackHandler).not.toHaveBeenCalled();

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('warns and returns false for an unknown activation key', () => {
    const { runtime, source, target } = createMountedRuntimeWithMarker();
    const warningsBefore = runtime.getStats().warnings.total;

    expect(runtime.activateRenderRecord('missing')).toBe(false);
    expect(runtime.getStats().warnings.total).toBe(warningsBefore + 1);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('rejects all interaction helpers after destroy', () => {
    const { item, runtime, source, target } = createMountedRuntimeWithMarker();
    const sourceEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    runtime.destroy();

    expect(runtime.activateRenderRecord(item.activationKey, sourceEvent)).toBe(false);
    expect(runtime.activateFromEvent(sourceEvent)).toBe(false);
    expect(runtime.activateTrack(sourceEvent)).toBe(false);
    expect(runtime.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);

    source.remove();
    target.remove();
  });

  it('ignores repeated source events in the manual event helper', () => {
    const { item, runtime, source, target } = createMountedRuntimeWithMarker();
    const marker = document.createElement('div');
    const sourceEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    marker.setAttribute(DATA_ATTRIBUTES.KEY, item.activationKey);
    marker.dispatchEvent(sourceEvent);
    target.appendChild(marker);

    expect(runtime.activateFromEvent(sourceEvent)).toBe(true);
    expect(runtime.activateFromEvent(sourceEvent)).toBe(false);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('activates track behavior through the manual track helper and emits track:activate exactly once', () => {
    const { runtime, source, target } = createMountedRuntimeWithMarker();
    const handler = vi.fn();
    const sourceEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientY: 10,
    });

    runtime.on(EVENT_NAMES.TRACK_ACTIVATE, handler);

    expect(runtime.activateTrack(sourceEvent)).toBe(true);
    expect(runtime.activateTrack(sourceEvent)).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ sourceEvent });
    expect(
      typeof handler.mock.calls[0]?.[0].position === 'number' || handler.mock.calls[0]?.[0].position === null,
    ).toBe(true);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('keeps the connected actual root authoritative for manual track activation', () => {
    const { runtime, source, target } = createMountedRuntimeWithMarker();
    const track = document.createElement('div');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    document.body.appendChild(track);
    overrideDomMetric(document.documentElement, 'clientHeight', 100);
    overrideDomMetric(document.documentElement, 'scrollHeight', 500);
    overrideDomMetric(document.body, 'scrollHeight', 500);

    const createRect = (height: number) =>
      ({
        bottom: height,
        height,
        left: 0,
        right: 20,
        toJSON: () => ({}),
        top: 0,
        width: 20,
        x: 0,
        y: 0,
      }) as DOMRect;

    // A forwarded event from an unrelated element cannot replace the mounted
    // actual root as the authoritative track geometry.
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(createRect(1000));
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(createRect(100));

    track.addEventListener('pointerup', (event) => {
      runtime.activateTrack(event as PointerEvent);
    });
    track.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientY: 50 }));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 20 });

    runtime.destroy();
    scrollTo.mockRestore();
    source.remove();
    target.remove();
    track.remove();
  });

  it('gates the manual keyboard helper by accessibility keyboard options', () => {
    const source = document.createElement('div');
    const target = document.createElement('div');
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [
        {
          scroll: false,
          selector: '.target',
        },
      ],
    });
    const handler = vi.fn();

    source.className = 'target';
    document.body.append(source, target);
    runtime.mount({ renderRoot: target });
    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);

    expect(runtime.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    runtime.patchOptions({ a11y: { enabled: true, keyboard: true } });

    expect(runtime.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    runtime.destroy();
    source.remove();
    target.remove();
  });
});

describe('core delegated interaction handlers', () => {
  it('activates a marker through delegated semantic click interaction', () => {
    const { marker, runtime, source, target } = createMountedRuntimeWithDelegatedMarker();
    const handler = vi.fn();
    const setPointerCapture = vi.fn();
    const sourceEvent = new MouseEvent('click', {
      bubbles: true,
      button: 0,
      cancelable: true,
    });

    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);
    target.setPointerCapture = setPointerCapture;
    marker.dispatchEvent(sourceEvent);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      element: source,
      selector: '.target',
      sourceEvent,
    });
    expect(sourceEvent.defaultPrevented).toBe(true);
    expect(setPointerCapture).not.toHaveBeenCalled();

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('captures a pointer only for delegated track drag sessions', () => {
    const { marker, runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      interaction: { drag: true },
    });
    const setPointerCapture = vi.fn();

    target.setPointerCapture = setPointerCapture;

    // A marker-origin pointer session is never drag-eligible, so it must not
    // capture the pointer even though the session itself is opened.
    marker.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 4 }));

    expect(setPointerCapture).not.toHaveBeenCalled();

    // A track-origin pointer session is drag-eligible and captures its pointer.
    target.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7 }));

    expect(setPointerCapture).toHaveBeenCalledTimes(1);
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('ignores pointerup events outside the active primary-button session', () => {
    // Pointer-session handlers are only installed when track drag is enabled.
    const { runtime, source, target } = createMountedRuntimeWithDelegatedMarker({ interaction: { drag: true } });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();

    target.setPointerCapture = setPointerCapture;
    target.hasPointerCapture = vi.fn(() => true);
    target.releasePointerCapture = releasePointerCapture;

    // A lone terminal event and non-primary / secondary-button starts never open
    // a pointer session, so nothing is captured.
    target.dispatchEvent(createPointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
    target.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 2, pointerId: 2 }));
    target.dispatchEvent(
      createPointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: false, pointerId: 2 }),
    );

    expect(setPointerCapture).not.toHaveBeenCalled();

    // A valid primary-button start opens exactly one capturing session.
    target.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 3 }));

    expect(setPointerCapture).toHaveBeenCalledTimes(1);
    expect(setPointerCapture).toHaveBeenCalledWith(3);

    // Terminal events that do not match the active primary-button session leave
    // it untouched.
    target.dispatchEvent(createPointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 4 }));
    target.dispatchEvent(createPointerEvent('pointerup', { bubbles: true, button: 2, pointerId: 3 }));

    expect(releasePointerCapture).not.toHaveBeenCalled();

    // The matching terminal event ends the still-valid session cleanly.
    target.dispatchEvent(createPointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 3 }));

    expect(releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(3);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('releases a marker pointer session when its terminal event occurs outside the tracker root', async () => {
    const { marker, runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      interaction: { drag: true },
    });
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');

    // A marker-origin session is intentionally not drag-eligible and never
    // captures the pointer, so its only discriminating cleanup signal is the
    // teardown of the document-level terminal listeners it owns.
    marker.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 10 }));

    const terminalHandler = addEventListener.mock.calls.find(([type]) => type === 'pointerup')?.[1];

    expect(terminalHandler).toBeTypeOf('function');
    expect(addEventListener).toHaveBeenCalledWith('pointercancel', terminalHandler, true);

    // The terminal event leaves the tracker root but is still seen by the
    // document capture-phase listener, which defers recovery to a timer task.
    document.body.dispatchEvent(createPointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 10 }));

    expect(removeEventListener).not.toHaveBeenCalledWith('pointerup', terminalHandler, true);

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });

    // Fallback recovery has now detached the session's own document terminal
    // listeners, before any subsequent pointerdown could reset the session.
    expect(removeEventListener).toHaveBeenCalledWith('pointerup', terminalHandler, true);
    expect(removeEventListener).toHaveBeenCalledWith('pointercancel', terminalHandler, true);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it.each(['pointerup', 'pointercancel'])(
    'releases a pointer session when a descendant stops %s propagation',
    async (terminalEventType) => {
      const { marker, runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
        interaction: { drag: true },
      });
      const handler = vi.fn();
      const stopPropagation = (event: Event) => event.stopPropagation();
      const addEventListener = vi.spyOn(document, 'addEventListener');
      const removeEventListener = vi.spyOn(document, 'removeEventListener');

      runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);
      marker.addEventListener(terminalEventType, stopPropagation);
      marker.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 10 }));

      const terminalHandler = addEventListener.mock.calls.find(([type]) => type === 'pointerup')?.[1];

      // The descendant hides the terminal event from the root listener; only the
      // document capture-phase recovery can still end this session.
      marker.dispatchEvent(createPointerEvent(terminalEventType, { bubbles: true, button: 0, pointerId: 10 }));

      expect(removeEventListener).not.toHaveBeenCalledWith('pointerup', terminalHandler, true);

      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });

      marker.removeEventListener(terminalEventType, stopPropagation);

      // The session's own document terminal listeners are gone before any new
      // pointerdown could reset the session by itself.
      expect(removeEventListener).toHaveBeenCalledWith('pointerup', terminalHandler, true);
      expect(removeEventListener).toHaveBeenCalledWith('pointercancel', terminalHandler, true);

      marker.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 11 }));
      marker.dispatchEvent(createPointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 11 }));

      expect(handler).not.toHaveBeenCalled();

      runtime.destroy();
      source.remove();
      target.remove();
    },
  );

  it('replaces an orphaned pointer session on the next valid pointerdown', () => {
    const { runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      interaction: { drag: true },
    });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const stopImmediately = (event: Event) => event.stopImmediatePropagation();

    target.setPointerCapture = setPointerCapture;
    target.hasPointerCapture = vi.fn(() => true);
    target.releasePointerCapture = releasePointerCapture;
    overrideDomMetric(document.documentElement, 'clientHeight', 100);
    overrideDomMetric(document.documentElement, 'scrollHeight', 500);
    overrideDomMetric(document.body, 'scrollHeight', 500);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 20,
      toJSON: () => ({}),
      top: 0,
      width: 20,
      x: 0,
      y: 0,
    });

    // Orphan the first session: a one-shot capture listener swallows the
    // terminal event before the controller's own recovery listener reacts.
    document.addEventListener('pointerup', stopImmediately, { capture: true, once: true });
    target.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 0, pointerId: 10 }));
    target.dispatchEvent(createPointerEvent('pointerup', { bubbles: true, button: 0, clientY: 0, pointerId: 10 }));

    expect(setPointerCapture).toHaveBeenCalledTimes(1);
    expect(setPointerCapture).toHaveBeenLastCalledWith(10);

    // The next valid pointerdown retires the orphan and establishes a fresh
    // capturing session for the new pointer id.
    target.dispatchEvent(createPointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 0, pointerId: 11 }));

    expect(releasePointerCapture).toHaveBeenCalledWith(10);
    expect(setPointerCapture).toHaveBeenCalledTimes(2);
    expect(setPointerCapture).toHaveBeenLastCalledWith(11);

    // Only the new session's pointer drives drag scrolling; the retired pointer
    // id is ignored.
    target.dispatchEvent(createPointerEvent('pointermove', { bubbles: true, clientY: 50, pointerId: 10 }));

    expect(scrollTo).not.toHaveBeenCalled();

    target.dispatchEvent(createPointerEvent('pointermove', { bubbles: true, clientY: 50, pointerId: 11 }));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'instant', top: 200 });

    runtime.destroy();
    scrollTo.mockRestore();
    source.remove();
    target.remove();
  });

  it('activates a marker through delegated click when drag interaction is disabled', () => {
    const { marker, runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      interaction: {
        drag: false,
      },
    });
    const handler = vi.fn();
    const sourceEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);
    marker.dispatchEvent(sourceEvent);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      element: source,
      selector: '.target',
      sourceEvent,
    });
    expect(sourceEvent.defaultPrevented).toBe(true);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('handles delegated keyboard activation only in accessibility keyboard mode', () => {
    const { runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      a11y: {
        enabled: true,
        keyboard: true,
      },
    });
    const handler = vi.fn();
    const sourceEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });

    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);
    target.dispatchEvent(sourceEvent);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      element: source,
      selector: '.target',
      sourceEvent,
    });
    expect(sourceEvent.defaultPrevented).toBe(true);
    expect(runtime.handleKeyboardEvent(sourceEvent)).toBe(false);

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('moves delegated keyboard selection before activation and emits matching selection:change transitions', () => {
    const { first, runtime, second, target, third } = createMountedKeyboardRuntime();
    const handler = vi.fn();
    const selectionHandler = vi.fn();

    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);
    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);

    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'End',
      }),
    );
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      }),
    );
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Home',
      }),
    );
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      }),
    );
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowDown',
      }),
    );
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      }),
    );
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowUp',
      }),
    );
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      }),
    );

    expect(handler.mock.calls.map((call) => call[0].element)).toEqual([third, first, second, first]);

    // One selection:change transition per navigation key (End, Home, ArrowDown, ArrowUp), each
    // committing the logical selection consumed by the immediately following Enter activation.
    expect(selectionHandler).toHaveBeenCalledTimes(4);
    expect(selectionHandler.mock.calls.map((call) => call[0].selectedKey)).toEqual(
      handler.mock.calls.map((call) => call[0].key),
    );
    selectionHandler.mock.calls.slice(1).forEach((call, index) => {
      expect(call[0].previousKey).toBe(selectionHandler.mock.calls[index]?.[0].selectedKey);
    });

    runtime.destroy();
    first.remove();
    second.remove();
    third.remove();
    target.remove();
  });

  it('falls back the current selection and emits selection:change when the selected marker disappears from a render', () => {
    const { first, runtime, second, third, target } = createMountedKeyboardRuntime();
    const selectionHandler = vi.fn();
    const itemsBefore = runtime.getSnapshotProps().items;
    const firstKey = itemsBefore[0]!.activationKey;
    const secondKey = itemsBefore[1]!.activationKey;
    const thirdKey = itemsBefore[2]!.activationKey;

    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    first.remove();
    runtime.render();

    const itemsAfter = runtime.getSnapshotProps().items;

    expect(itemsAfter.map((item) => item.activationKey)).toEqual([secondKey, thirdKey]);
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(selectionHandler).toHaveBeenCalledWith({ previousKey: firstKey, selectedKey: secondKey });

    runtime.destroy();
    second.remove();
    third.remove();
    target.remove();
  });

  it('preserves the current selection without emitting selection:change when a delegated navigation render rolls back', () => {
    const { first, runtime, second, third, target } = createMountedKeyboardRuntime();
    const selectionHandler = vi.fn();
    const itemsBefore = runtime.getSnapshotProps().items;
    const keysBefore = itemsBefore.map((item) => item.activationKey);

    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    vi.spyOn(runtime.renderer, 'renderMarkers').mockImplementationOnce(() => {
      throw new Error('marker render failed');
    });

    first.remove();
    runtime.render();

    const itemsAfter = runtime.getSnapshotProps().items;

    // Rollback restores the exact pre-render record set (DOM removal never
    // committed), so the selected key is untouched and no transition fires.
    expect(itemsAfter.map((item) => item.activationKey)).toEqual(keysBefore);
    expect(selectionHandler).not.toHaveBeenCalled();

    runtime.destroy();
    first.remove();
    second.remove();
    third.remove();
    target.remove();
  });

  it('updates the delegated keyboard axis after an orientation change', () => {
    const { first, runtime, second, target, third } = createMountedKeyboardRuntime();

    runtime.patchOptions({ orientation: 'horizontal' });

    const verticalEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowDown',
    });
    const horizontalEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    });

    target.dispatchEvent(verticalEvent);
    target.dispatchEvent(horizontalEvent);

    expect(verticalEvent.defaultPrevented).toBe(false);
    expect(horizontalEvent.defaultPrevented).toBe(true);

    runtime.destroy();
    first.remove();
    second.remove();
    third.remove();
    target.remove();
  });

  it('does not attach delegated activation when activation is disabled', () => {
    const { marker, runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      interaction: {
        activation: false,
      },
    });
    const handler = vi.fn();

    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);
    marker.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(handler).not.toHaveBeenCalled();

    runtime.destroy();
    source.remove();
    target.remove();
  });

  it('scrolls from delegated drag movement after the drag threshold is crossed', () => {
    const { runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      interaction: {
        drag: true,
      },
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    overrideDomMetric(document.documentElement, 'clientHeight', 100);
    overrideDomMetric(document.documentElement, 'scrollHeight', 500);
    overrideDomMetric(document.body, 'scrollHeight', 500);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 20,
      toJSON: () => ({}),
      top: 0,
      width: 20,
      x: 0,
      y: 0,
    });

    target.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientY: 0,
      }),
    );
    const moveEvent = new MouseEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientY: 50,
    });

    target.dispatchEvent(moveEvent);

    expect(scrollTo).toHaveBeenCalledWith({
      behavior: 'instant',
      top: 200,
    });
    expect(moveEvent.defaultPrevented).toBe(true);

    runtime.destroy();
    scrollTo.mockRestore();
    source.remove();
    target.remove();
  });

  it('keeps marker pointer sessions in activation mode when track drag is enabled', () => {
    const { marker, runtime, source, target } = createMountedRuntimeWithDelegatedMarker({
      interaction: {
        drag: true,
      },
    });
    const handler = vi.fn();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    overrideDomMetric(document.documentElement, 'clientHeight', 100);
    overrideDomMetric(document.documentElement, 'scrollHeight', 500);
    overrideDomMetric(document.body, 'scrollHeight', 500);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 20,
      toJSON: () => ({}),
      top: 0,
      width: 20,
      x: 0,
      y: 0,
    });

    runtime.on(EVENT_NAMES.MARKER_ACTIVATE, handler);
    marker.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientY: 0,
      }),
    );
    const moveEvent = new MouseEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientY: 50,
    });

    marker.dispatchEvent(moveEvent);

    const upEvent = new MouseEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientY: 50,
    });

    marker.dispatchEvent(upEvent);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(moveEvent.defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    runtime.destroy();
    scrollTo.mockRestore();
    source.remove();
    target.remove();
  });
});
