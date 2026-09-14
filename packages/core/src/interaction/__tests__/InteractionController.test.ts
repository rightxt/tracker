// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveTrackerOptions } from '../../config/resolveOptions.js';
import type {
  TrackerClusterRenderRecord,
  TrackerEventPayload,
  TrackerMarkerRecord,
  TrackerMarkerRenderRecord,
  TrackerOptions,
  TrackerResolvedOptions,
} from '../../types.js';
import { InteractionController } from '../InteractionController.js';
import { WindowScrollContext } from '../../scroll/WindowScrollContext.js';
import type { TrackerScrollContext } from '../../scroll/scrollContext.js';
import { coordinateTrackerOperation, createTrackerOperationCoordinator } from '../../tracker/operationCoordinator.js';

/**
 * Builds committed options for controller tests.
 *
 * InteractionController consumes resolved options, so fixtures declare only the
 * branches they exercise and the rest is resolved from the defaults.
 *
 * @param optionsPatch - Partial options applied over the defaults.
 * @returns Complete committed options.
 */
function createInteractionOptions(optionsPatch: TrackerOptions = {}): TrackerResolvedOptions {
  return resolveTrackerOptions(optionsPatch);
}

/**
 * Creates a marker render record with a detached DOM element.
 *
 * Scroll behavior is disabled by default so activation stays side-effect free
 * in jsdom.
 *
 * @param key - Render record key.
 * @param overrides - Marker record field overrides.
 * @returns Marker render record.
 */
function createMarkerRenderRecord(key: string, overrides: Record<string, unknown> = {}): TrackerMarkerRenderRecord {
  const element = document.createElement('div');

  document.body.appendChild(element);

  const marker = {
    kind: 'marker',
    key,
    element,
    ruleIndex: 0,
    selector: `.${key}`,
    label: null,
    scroll: { enabled: false },
    focus: { enabled: false },
    ...overrides,
  } as unknown as TrackerMarkerRecord;

  return { kind: 'marker', key, marker } as TrackerMarkerRenderRecord;
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

afterEach(() => {
  domMetricRestorers
    .splice(0)
    .reverse()
    .forEach((restore) => {
      restore();
    });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('InteractionController', () => {
  it('warns and rejects invalid activation keys', () => {
    const diagnostics = { warn: vi.fn() };
    const controller = new InteractionController({ diagnostics });

    expect(controller.activateRenderRecordByKey('')).toBe(false);
    expect(controller.activateRenderRecordByKey(42 as never)).toBe(false);
    expect(diagnostics.warn).toHaveBeenCalledTimes(2);
    expect(diagnostics.warn).toHaveBeenCalledWith('invalid-activation-key', expect.any(String), { key: '' });

    controller.destroy();
  });

  it('warns when manual helpers are used without a connected or fallback root', () => {
    const diagnostics = { warn: vi.fn() };
    const controller = new InteractionController({ diagnostics });

    expect(controller.activateTrack(new MouseEvent('click'))).toBe(false);
    expect(controller.activateFromEvent(new MouseEvent('click'))).toBe(false);
    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
    expect(diagnostics.warn).toHaveBeenCalledTimes(3);
    expect(diagnostics.warn).toHaveBeenCalledWith('interaction-not-connected', expect.any(String));

    controller.destroy();
  });

  it('activates clusters through their primary marker', () => {
    const events = { emit: vi.fn() };
    const markerRecord = createMarkerRenderRecord('a', { focus: { enabled: true, target: 'self' } });
    const focusSpy = vi.spyOn(markerRecord.marker.element as HTMLElement, 'focus');
    const cluster = {
      kind: 'cluster',
      key: 'c:a',
      markers: [markerRecord.marker],
      count: 1,
      primaryMarker: markerRecord.marker,
    } as unknown as TrackerClusterRenderRecord;
    const controller = new InteractionController({
      events,
      getRenderRecordByKey: (key) => (key === 'c:a' ? cluster : null),
    });

    expect(controller.activateRenderRecordByKey('c:a')).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      'cluster:activate',
      expect.objectContaining({
        count: 1,
        key: 'c:a',
        primaryMarker: expect.objectContaining({ key: 'a', selector: '.a' }),
      }),
    );

    controller.destroy();
  });

  it('emits a null primary marker for clusters without markers', () => {
    const events = { emit: vi.fn() };
    const emptyCluster = {
      kind: 'cluster',
      key: 'c:empty',
      markers: [],
      count: 0,
      primaryMarker: null,
    } as unknown as TrackerClusterRenderRecord;
    const controller = new InteractionController({
      events,
      getRenderRecordByKey: () => emptyCluster,
    });

    expect(controller.activateRenderRecordByKey('c:empty')).toBe(true);
    expect(events.emit).toHaveBeenCalledWith(
      'cluster:activate',
      expect.objectContaining({ key: 'c:empty', primaryMarker: null }),
    );

    controller.destroy();
  });

  it('navigates horizontally with arrow keys through the fallback root', () => {
    const events = { emit: vi.fn() };
    const records = [createMarkerRenderRecord('a'), createMarkerRenderRecord('b')];
    const root = document.createElement('div');

    document.body.appendChild(root);

    const controller = new InteractionController({
      canHandleKeyboardEvent: () => true,
      events,
      getFallbackRoot: () => root,
      getRenderRecordByKey: (key) => records.find((record) => record.key === key) ?? null,
      getRenderRecords: () => records,
      onSelectionRequest: (request) => {
        controller.commitSelectionRequest(request);
      },
    });

    controller.update(
      createInteractionOptions({
        a11y: { enabled: true, keyboard: true },
        orientation: 'horizontal',
      }),
    );

    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'ArrowRight' }))).toBe(
      true,
    );
    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(true);
    expect(events.emit).toHaveBeenLastCalledWith('marker:activate', expect.objectContaining({ selector: '.b' }));

    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'ArrowLeft' }))).toBe(
      true,
    );
    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(true);
    expect(events.emit).toHaveBeenLastCalledWith('marker:activate', expect.objectContaining({ selector: '.a' }));

    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'x' }))).toBe(false);

    controller.destroy();
  });

  it('preserves a selected render-record key across insertion and reordering', () => {
    const a = createMarkerRenderRecord('a');
    const b = createMarkerRenderRecord('b');
    const c = createMarkerRenderRecord('c');
    const inserted = createMarkerRenderRecord('inserted');
    let records: TrackerMarkerRenderRecord[] = [a, b, c];
    const controller = new InteractionController({
      canHandleKeyboardEvent: () => true,
      getRenderRecords: () => records,
    });

    controller.update(
      createInteractionOptions({
        a11y: { enabled: true, keyboard: true },
        orientation: 'vertical',
      }),
    );
    controller.commitSelectionRequest({ navigationKey: 'ArrowDown' });

    expect(controller.getSelectedKey()).toBe('b');

    records = [inserted, a, b, c];

    expect(controller.synchronizeSelection('b')).toBeNull();
    expect(controller.getSelectedKey()).toBe('b');

    records = [c, b, inserted, a];

    expect(controller.synchronizeSelection('b')).toBeNull();
    expect(controller.getSelectedKey()).toBe('b');

    controller.destroy();
  });

  it('falls back to the nearest valid index when the selected key disappears', () => {
    const a = createMarkerRenderRecord('a');
    const b = createMarkerRenderRecord('b');
    const c = createMarkerRenderRecord('c');
    let records: TrackerMarkerRenderRecord[] = [a, b, c];
    const controller = new InteractionController({
      canHandleKeyboardEvent: () => true,
      getRenderRecords: () => records,
    });

    controller.update(
      createInteractionOptions({
        a11y: { enabled: true, keyboard: true },
        orientation: 'vertical',
      }),
    );
    controller.commitSelectionRequest({ navigationKey: 'ArrowDown' });
    records = [a, c];

    expect(controller.synchronizeSelection('b')).toEqual({
      nextKey: 'c',
      previousKey: 'b',
    });
    expect(controller.getSelectedKey()).toBe('c');

    controller.destroy();
  });

  it('does not handle arrow keys of the opposite orientation axis', () => {
    const events = { emit: vi.fn() };
    const records = [createMarkerRenderRecord('a'), createMarkerRenderRecord('b')];
    const root = document.createElement('div');

    document.body.appendChild(root);

    const controller = new InteractionController({
      canHandleKeyboardEvent: () => true,
      events,
      getFallbackRoot: () => root,
      getRenderRecordByKey: (key) => records.find((record) => record.key === key) ?? null,
      getRenderRecords: () => records,
      onSelectionRequest: (request) => {
        controller.commitSelectionRequest(request);
      },
    });

    controller.update(
      createInteractionOptions({
        a11y: { enabled: true, keyboard: true },
        orientation: 'vertical',
      }),
    );

    const crossAxisEvent = new KeyboardEvent('keydown', { cancelable: true, key: 'ArrowRight' });

    expect(controller.handleKeyboardEvent(crossAxisEvent)).toBe(false);
    expect(crossAxisEvent.defaultPrevented).toBe(false);
    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(true);
    expect(events.emit).toHaveBeenLastCalledWith('marker:activate', expect.objectContaining({ selector: '.a' }));

    controller.destroy();
  });

  it('gates manual keyboard handling by interaction and accessibility options', () => {
    const events = { emit: vi.fn() };
    const records = [createMarkerRenderRecord('a')];
    const root = document.createElement('div');

    document.body.appendChild(root);

    const controller = new InteractionController({
      canHandleKeyboardEvent: () => true,
      events,
      getFallbackRoot: () => root,
      getRenderRecordByKey: (key) => records.find((record) => record.key === key) ?? null,
      getRenderRecords: () => records,
      onSelectionRequest: (request) => {
        controller.commitSelectionRequest(request);
      },
    });

    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(
      false,
    );

    controller.update(createInteractionOptions({ a11y: { enabled: true, keyboard: true } }));

    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(true);
    expect(events.emit).toHaveBeenCalledTimes(1);

    controller.update(
      createInteractionOptions({
        a11y: { enabled: true, keyboard: true },
        interaction: { activation: false },
      }),
    );

    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(
      false,
    );
    expect(events.emit).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it('ignores keyboard interaction when no records are rendered', () => {
    const root = document.createElement('div');

    document.body.appendChild(root);

    const controller = new InteractionController({
      getFallbackRoot: () => root,
      getRenderRecords: () => [],
    });

    controller.update(createInteractionOptions({ a11y: { enabled: true, keyboard: true } }));

    const navigationEvent = new KeyboardEvent('keydown', { cancelable: true, key: 'ArrowDown' });

    expect(controller.handleKeyboardEvent(navigationEvent)).toBe(false);
    expect(navigationEvent.defaultPrevented).toBe(false);
    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(
      false,
    );

    controller.destroy();
  });

  it('uses the event target geometry for manual track activation on host-owned roots', () => {
    const fallbackRoot = document.createElement('div');
    const track = document.createElement('div');

    document.body.append(fallbackRoot, track);

    const controller = new InteractionController({
      getFallbackRoot: () => fallbackRoot,
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

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

    // A click at the same clientY must resolve against the track rect, not the
    // larger fallback (mount target) rect.
    vi.spyOn(fallbackRoot, 'getBoundingClientRect').mockReturnValue(createRect(1000));
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(createRect(100));

    let activated = false;

    track.addEventListener('pointerup', (event) => {
      activated = controller.activateTrack(event as PointerEvent);
    });

    // Without a mounted scroll context there is no ambient window fallback,
    // so track activation must not scroll anything.
    track.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientY: 50 }));

    expect(activated).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();

    controller.updateContext({ scrollContext: new WindowScrollContext(window) });
    track.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientY: 50 }));

    expect(activated).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 200 });

    scrollTo.mockRestore();
    controller.destroy();
  });

  it('reports invalid delegated roots', () => {
    const diagnostics = { error: vi.fn() };
    const controller = new InteractionController({ diagnostics });

    controller.connect(null as never, createInteractionOptions({}));

    expect(diagnostics.error).toHaveBeenCalledWith('invalid-interaction-root', expect.any(String), { root: null });

    controller.destroy();
  });

  it('continues delegated listener cleanup after removeEventListener throws', () => {
    const root = document.createElement('div');
    const removalError = new Error('pointerdown removal failed');
    const removedEventTypes: string[] = [];
    const nativeRemoveEventListener = root.removeEventListener.bind(root);
    const controller = new InteractionController({});

    document.body.appendChild(root);
    controller.connect(root, createInteractionOptions({ interaction: { activation: false, drag: true } }));
    const removeEventListener = vi
      .spyOn(root, 'removeEventListener')
      .mockImplementation((eventType, listener, options) => {
        removedEventTypes.push(String(eventType));

        if (eventType === 'pointerdown') {
          throw removalError;
        }

        nativeRemoveEventListener(eventType, listener, options);
      });

    expect(() => controller.disconnect()).toThrow(removalError);
    expect(removedEventTypes).toEqual([
      'pointerdown',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'pointermove',
    ]);
    removeEventListener.mockRestore();
    expect(() => controller.disconnect()).not.toThrow();
    expect(() => controller.destroy()).not.toThrow();
  });

  it('does not carry drag click suppression across a disconnect and reconnect', () => {
    const events = { emit: vi.fn() };
    const markerRecord = createMarkerRenderRecord('a');
    const root = document.createElement('div');
    const markerElement = document.createElement('div');
    const controller = new InteractionController({
      events,
      getRenderRecordByKey: () => markerRecord,
      getRenderRecords: () => [markerRecord],
    });
    const options = createInteractionOptions({ interaction: { activation: true, drag: true } });
    const createPointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientY });

      Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: 1 },
      });

      return event;
    };

    markerElement.setAttribute('data-rxtt-key', 'a');
    root.appendChild(markerElement);
    document.body.appendChild(root);
    controller.connect(root, options);
    root.dispatchEvent(createPointerEvent('pointerdown', 0));
    root.dispatchEvent(createPointerEvent('pointermove', 20));
    root.dispatchEvent(createPointerEvent('pointerup', 20));

    controller.disconnect();
    controller.connect(root, options);
    markerElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(events.emit).toHaveBeenCalledWith('marker:activate', expect.objectContaining({ selector: '.a' }));

    controller.destroy();
  });

  it('cancels the pending document-pointer-end recovery timer on disconnect', () => {
    const root = document.createElement('div');
    const blocker = document.createElement('div');
    const controller = new InteractionController({});
    const options = createInteractionOptions({ interaction: { activation: false, drag: true } });
    const createPointerEvent = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });

      Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: 1 },
      });

      return event;
    };

    root.appendChild(blocker);
    document.body.appendChild(root);
    // Stops the pointerup from reaching root's bubble-phase handler, leaving
    // only the document capture-phase recovery timer to end the session.
    blocker.addEventListener('pointerup', (event) => event.stopPropagation());
    controller.connect(root, options);

    vi.useFakeTimers();
    root.dispatchEvent(createPointerEvent('pointerdown'));
    blocker.dispatchEvent(createPointerEvent('pointerup'));

    expect(vi.getTimerCount()).toBe(1);

    controller.disconnect();

    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
    controller.destroy();
  });

  it('cancels the pending document-pointer-end recovery timer once the session ends normally', () => {
    const root = document.createElement('div');
    const controller = new InteractionController({});
    const options = createInteractionOptions({ interaction: { activation: false, drag: true } });
    const createPointerEvent = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });

      Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: 1 },
      });

      return event;
    };

    document.body.appendChild(root);
    controller.connect(root, options);

    vi.useFakeTimers();
    root.dispatchEvent(createPointerEvent('pointerdown'));
    // Bubbles through root's own pointerup handler synchronously, which should
    // clear the recovery timer scheduled by the document capture-phase listener
    // before this dispatch call even returns.
    root.dispatchEvent(createPointerEvent('pointerup'));

    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
    controller.destroy();
  });

  it('rolls back a partially attached document pointer session', () => {
    const root = document.createElement('div');
    const pointerCancelError = new Error('pointercancel registration failed');
    const rootListeners = new Map<string, EventListenerOrEventListenerObject>();
    const nativeRootAddEventListener = root.addEventListener.bind(root);
    const nativeDocumentAddEventListener = document.addEventListener.bind(document);
    const nativeDocumentRemoveEventListener = document.removeEventListener.bind(document);
    const removedDocumentEventTypes: string[] = [];
    const controller = new InteractionController({});

    document.body.appendChild(root);
    vi.spyOn(root, 'addEventListener').mockImplementation((eventType, listener, options) => {
      rootListeners.set(String(eventType), listener);
      nativeRootAddEventListener(eventType, listener, options);
    });
    controller.connect(root, createInteractionOptions({ interaction: { activation: false, drag: true } }));
    const addDocumentListener = vi
      .spyOn(document, 'addEventListener')
      .mockImplementation((eventType, listener, options) => {
        if (eventType === 'pointercancel') {
          throw pointerCancelError;
        }

        nativeDocumentAddEventListener(eventType, listener, options);
      });
    vi.spyOn(document, 'removeEventListener').mockImplementation((eventType, listener, options) => {
      removedDocumentEventTypes.push(String(eventType));
      nativeDocumentRemoveEventListener(eventType, listener, options);
    });

    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, button: 0 });

    Object.defineProperties(pointerDown, {
      isPrimary: { value: true },
      pointerId: { value: 1 },
    });

    const invokePointerDown = () => {
      const pointerDownListener = rootListeners.get('pointerdown');

      if (typeof pointerDownListener === 'function') {
        pointerDownListener(pointerDown);
      } else {
        pointerDownListener?.handleEvent(pointerDown);
      }
    };

    expect(invokePointerDown).toThrow(pointerCancelError);
    expect(removedDocumentEventTypes).toEqual(['pointerup', 'pointercancel']);

    addDocumentListener.mockRestore();
    removedDocumentEventTypes.length = 0;

    expect(invokePointerDown).not.toThrow();
    expect(() => controller.disconnect()).not.toThrow();
    expect(removedDocumentEventTypes).toEqual(['pointerup', 'pointercancel']);
    controller.destroy();
  });

  it('retries only a document pointer listener whose removal failed', () => {
    const root = document.createElement('div');
    const pointerUpRemovalError = new Error('pointerup removal failed');
    const nativeDocumentRemoveEventListener = document.removeEventListener.bind(document);
    const removedDocumentEventTypes: string[] = [];
    const controller = new InteractionController({});
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, button: 0 });

    Object.defineProperties(pointerDown, {
      isPrimary: { value: true },
      pointerId: { value: 1 },
    });

    document.body.appendChild(root);
    controller.connect(root, createInteractionOptions({ interaction: { activation: false, drag: true } }));
    root.dispatchEvent(pointerDown);

    vi.spyOn(document, 'removeEventListener').mockImplementation((eventType, listener, options) => {
      removedDocumentEventTypes.push(String(eventType));

      if (eventType === 'pointerup') {
        throw pointerUpRemovalError;
      }

      nativeDocumentRemoveEventListener(eventType, listener, options);
    });

    expect(() => controller.disconnect()).toThrow(pointerUpRemovalError);
    expect(removedDocumentEventTypes).toEqual(['pointerup', 'pointercancel']);

    removedDocumentEventTypes.length = 0;

    vi.mocked(document.removeEventListener).mockImplementation((eventType, listener, options) => {
      removedDocumentEventTypes.push(String(eventType));
      nativeDocumentRemoveEventListener(eventType, listener, options);
    });

    expect(() => controller.disconnect()).not.toThrow();
    expect(removedDocumentEventTypes).toEqual(['pointerup']);

    removedDocumentEventTypes.length = 0;

    expect(() => controller.disconnect()).not.toThrow();
    expect(removedDocumentEventTypes).toEqual([]);
    controller.destroy();
  });

  it('reconnects delegated handlers when options change on a connected root', () => {
    const events = { emit: vi.fn() };
    const markerRecord = createMarkerRenderRecord('a');
    const root = document.createElement('div');
    const markerElement = document.createElement('div');

    markerElement.setAttribute('data-rxtt-key', 'a');
    root.appendChild(markerElement);
    document.body.appendChild(root);

    const controller = new InteractionController({
      canHandleKeyboardEvent: () => true,
      events,
      getRenderRecordByKey: () => markerRecord,
      getRenderRecords: () => [markerRecord],
    });
    const keyboardOptions = createInteractionOptions({
      a11y: { enabled: true, keyboard: true },
      interaction: { activation: true, drag: false },
    });

    controller.connect(root, keyboardOptions);
    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));

    expect(events.emit).toHaveBeenCalledTimes(1);

    controller.update(
      createInteractionOptions({
        a11y: { enabled: false },
        interaction: { activation: false, drag: false },
      }),
    );
    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));

    expect(events.emit).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it('warns and skips only the affected operation when a resolved target leaves the authoritative element-mode subtree', () => {
    const diagnostics = { warn: vi.fn() };
    const scrollRoot = document.createElement('div');
    const outsideTarget = document.createElement('div');

    document.body.append(scrollRoot, outsideTarget);

    const scrollElement = vi.fn();
    const scrollContext = {
      mode: 'element',
      root: scrollRoot,
      scrollElement,
    } as unknown as TrackerScrollContext;
    const markerRecord = createMarkerRenderRecord('outside', {
      element: outsideTarget,
      scroll: { enabled: true, target: 'self', align: 'start', behavior: 'auto' },
      focus: { enabled: true, target: 'self' },
    });
    const focusSpy = vi.spyOn(outsideTarget, 'focus');
    const controller = new InteractionController({
      diagnostics,
      scrollContext,
      getRenderRecordByKey: () => markerRecord,
    });

    expect(controller.activateRenderRecordByKey('outside')).toBe(true);
    expect(scrollElement).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(diagnostics.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_SCROLL_TARGET_OUTSIDE_ROOT',
      expect.any(String),
      expect.objectContaining({ selector: '.outside', scrollMode: 'element' }),
    );
    expect(diagnostics.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_FOCUS_TARGET_OUTSIDE_ROOT',
      expect.any(String),
      expect.objectContaining({ selector: '.outside', scrollMode: 'element' }),
    );

    controller.destroy();
  });

  it('disables the plain focus fallback only for element mode when preventScroll focus fails', () => {
    const diagnostics = { error: vi.fn() };
    const elementModeRoot = document.createElement('div');
    const elementModeTarget = document.createElement('div');

    elementModeRoot.appendChild(elementModeTarget);
    document.body.appendChild(elementModeRoot);

    const elementScrollContext = {
      mode: 'element',
      root: elementModeRoot,
      scrollElement: vi.fn(),
    } as unknown as TrackerScrollContext;
    const elementModeMarker = createMarkerRenderRecord('element-mode', {
      element: elementModeTarget,
      focus: { enabled: true, target: 'self' },
    });
    const elementModeFocusSpy = vi.spyOn(elementModeTarget, 'focus').mockImplementationOnce(() => {
      throw new Error('preventScroll unsupported');
    });
    const elementModeController = new InteractionController({
      diagnostics,
      scrollContext: elementScrollContext,
      getRenderRecordByKey: () => elementModeMarker,
    });

    expect(elementModeController.activateRenderRecordByKey('element-mode')).toBe(true);
    expect(elementModeFocusSpy).toHaveBeenCalledTimes(1);

    elementModeController.destroy();

    const windowModeTarget = document.createElement('div');

    document.body.appendChild(windowModeTarget);

    const windowScrollContext = { mode: 'window' } as unknown as TrackerScrollContext;
    const windowModeMarker = createMarkerRenderRecord('window-mode', {
      element: windowModeTarget,
      focus: { enabled: true, target: 'self' },
    });
    const windowModeFocusSpy = vi.spyOn(windowModeTarget, 'focus').mockImplementationOnce(() => {
      throw new Error('preventScroll unsupported');
    });
    const windowModeController = new InteractionController({
      diagnostics,
      scrollContext: windowScrollContext,
      getRenderRecordByKey: () => windowModeMarker,
    });

    expect(windowModeController.activateRenderRecordByKey('window-mode')).toBe(true);
    expect(windowModeFocusSpy).toHaveBeenCalledTimes(2);
    expect(diagnostics.error).toHaveBeenCalledTimes(2);

    windowModeController.destroy();
  });

  it('gates every activation entry point while geometry is suspended', () => {
    const events = { emit: vi.fn() };
    const markerRecord = createMarkerRenderRecord('a');
    const root = document.createElement('div');

    document.body.appendChild(root);

    let geometryAvailable = false;
    const controller = new InteractionController({
      events,
      getGeometryAvailable: () => geometryAvailable,
      getRenderRecordByKey: () => markerRecord,
    });

    controller.connect(root, createInteractionOptions({ a11y: { enabled: true, keyboard: true } }));

    expect(controller.activateRenderRecordByKey('a')).toBe(false);
    expect(controller.activateTrack(new MouseEvent('pointerup'))).toBe(false);
    expect(controller.activateFromEvent(new MouseEvent('click'))).toBe(false);
    expect(controller.handleKeyboardEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))).toBe(
      false,
    );
    expect(events.emit).not.toHaveBeenCalled();

    geometryAvailable = true;

    expect(controller.activateRenderRecordByKey('a')).toBe(true);
    expect(events.emit).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it('defers a reentrant destroy triggered from an activation listener until activation settles', () => {
    const sequence: string[] = [];
    const fakeInstance = {
      lifecycleState: 'mounted' as const,
      operationCoordinator: createTrackerOperationCoordinator(),
      diagnostics: {},
    };
    const markerRecord = createMarkerRenderRecord('a');
    const events = {
      emit: vi.fn((eventName: string) => {
        if (eventName === 'marker:activate') {
          coordinateTrackerOperation(fakeInstance, 'destroy', () => sequence.push('destroy'), {
            deferredResult: undefined,
          });
        }

        sequence.push('after-emit');
      }),
    };
    const controller = new InteractionController({
      events,
      getRenderRecordByKey: () => markerRecord,
      coordinateActivation: (run, deferredResult) =>
        coordinateTrackerOperation(fakeInstance, 'interaction', run, { deferredResult }),
    });

    expect(controller.activateRenderRecordByKey('a')).toBe(true);
    expect(sequence).toEqual(['after-emit', 'destroy']);

    controller.destroy();
  });

  it('re-verifies render record freshness before running a deferred activation', () => {
    const fakeInstance = {
      lifecycleState: 'mounted' as const,
      operationCoordinator: createTrackerOperationCoordinator(),
      diagnostics: {},
    };
    const staleRecord = createMarkerRenderRecord('a', { selector: '.stale' });
    const freshRecord = createMarkerRenderRecord('a', { selector: '.fresh' });
    let currentRecord: TrackerMarkerRenderRecord | null = staleRecord;
    const activatedSelectors: string[] = [];
    const events = {
      emit: vi.fn((eventName: string, payload?: TrackerEventPayload) => {
        if (eventName === 'marker:activate' && payload && 'selector' in payload) {
          activatedSelectors.push(payload.selector);
        }
      }),
    };
    const controller = new InteractionController({
      events,
      getRenderRecordByKey: (key) => (key === 'a' ? currentRecord : null),
      coordinateActivation: (run, deferredResult) =>
        coordinateTrackerOperation(fakeInstance, 'interaction', run, { deferredResult }),
    });

    // Nests activation inside an enclosing coordinated operation so
    // #coordinateActivation defers it until this outer operation settles.
    coordinateTrackerOperation(
      fakeInstance,
      'outer',
      () => {
        // Deferred activation cannot confirm the outcome synchronously, so the
        // call reports false rather than claiming an activation that has not
        // run yet.
        expect(controller.activateRenderRecordByKey('a')).toBe(false);
        // Replaces the render record while the activation is still deferred,
        // before its coordinated body actually runs.
        currentRecord = freshRecord;
      },
      { deferredResult: undefined },
    );

    expect(activatedSelectors).toEqual([]);

    controller.destroy();
  });

  it('returns false from activateFromEvent when the marker activation it triggers is deferred', () => {
    const fakeInstance = {
      lifecycleState: 'mounted' as const,
      operationCoordinator: createTrackerOperationCoordinator(),
      diagnostics: {},
    };
    const markerRecord = createMarkerRenderRecord('a');
    const root = document.createElement('div');
    const markerElement = document.createElement('div');

    markerElement.setAttribute('data-rxtt-key', 'a');
    root.appendChild(markerElement);
    document.body.appendChild(root);

    const events = { emit: vi.fn() };
    const controller = new InteractionController({
      events,
      getRenderRecordByKey: () => markerRecord,
      coordinateActivation: (run, deferredResult) =>
        coordinateTrackerOperation(fakeInstance, 'interaction', run, { deferredResult }),
    });

    controller.connect(root, createInteractionOptions({}));

    let capturedEvent: PointerEvent | null = null;

    // Captures a real, target-resolved event without letting it reach the
    // controller's own delegated pointerup listener on root, so the public
    // activateFromEvent() below is the only thing driving activation.
    markerElement.addEventListener(
      'pointerup',
      (event) => {
        event.stopPropagation();
        capturedEvent = event as PointerEvent;
      },
      { once: true },
    );
    markerElement.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));

    expect(capturedEvent).not.toBeNull();

    // Nests activateFromEvent() inside an enclosing coordinated operation so
    // #coordinateActivation defers the marker activation it triggers.
    coordinateTrackerOperation(
      fakeInstance,
      'outer',
      () => {
        // Deferred activation cannot confirm the outcome synchronously, so the
        // call must report false instead of the old hardcoded true.
        expect(controller.activateFromEvent(capturedEvent!)).toBe(false);
        // The deferred activation itself has not run yet at this point.
        expect(events.emit).not.toHaveBeenCalled();
      },
      { deferredResult: undefined },
    );

    // The deferred activation runs once the outer operation settles.
    expect(events.emit).toHaveBeenCalledWith('marker:activate', expect.objectContaining({ selector: '.a' }));

    controller.destroy();
  });
});
