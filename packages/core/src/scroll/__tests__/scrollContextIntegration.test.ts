// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveTrackerOptions } from '../../config/resolveOptions.js';
import { InteractionController } from '../../interaction/InteractionController.js';
import { LayoutEngine } from '../../layout/LayoutEngine.js';
import { ObserverController } from '../../observe/ObserverController.js';

import type { TrackerMarkerRecord, TrackerOrientation, TrackerRenderRecord } from '../../types.js';
import type { TrackerScrollContext, TrackerScrollMetrics } from '../scrollContext.js';

/**
 * Creates a spy-backed Window context for downstream routing tests.
 *
 * @param metrics - Metrics returned for both orientations.
 * @returns Internal scroll-context test double.
 */
function createScrollContext(
  metrics: TrackerScrollMetrics = {
    axis: 'x',
    contentSize: 1000,
    viewportSize: 200,
    scrollOffset: 100,
    maxOffset: 800,
  },
): TrackerScrollContext {
  return {
    mode: 'window',
    root: window,
    document,
    window,
    connectScrollListener: vi.fn(() => () => {}),
    getElementCoordinates: vi.fn(() => ({ start: 250, end: 350, center: 300 })),
    getMetrics: vi.fn((orientation: TrackerOrientation): TrackerScrollMetrics => ({
      ...metrics,
      axis: orientation === 'horizontal' ? 'x' : 'y',
    })),
    scrollElement: vi.fn(() => true),
    scrollToPhysicalOffset: vi.fn(),
  };
}

/** Restores test-owned DOM and mocks. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('TrackerScrollContext downstream routing', () => {
  it('supplies marker and viewport geometry to LayoutEngine', () => {
    const scrollContext = createScrollContext();
    const layoutEngine = new LayoutEngine({ scrollContext });
    const element = document.createElement('div');
    const marker = { element } as unknown as TrackerMarkerRecord;

    document.body.appendChild(element);

    const horizontalOptions = resolveTrackerOptions({ orientation: 'horizontal' });
    const [layout] = layoutEngine.measureMarkers([marker], horizontalOptions);
    const viewport = layoutEngine.measureViewport(horizontalOptions);

    expect(scrollContext.getMetrics).toHaveBeenCalledWith('horizontal');
    expect(scrollContext.getElementCoordinates).toHaveBeenCalledWith(element, 'horizontal');
    expect(layout).toMatchObject({
      start: 25,
      end: 35,
      size: 10,
      source: { start: 250, end: 350, size: 100 },
    });
    expect(viewport).toMatchObject({
      start: 10,
      end: 30,
      size: 20,
      source: { scrollOffset: 100, viewportSize: 200, contentSize: 1000 },
    });

    layoutEngine.destroy();
  });

  it('routes marker and track activation through the same interaction context', () => {
    const scrollContext = createScrollContext();
    const sourceElement = document.createElement('section');
    const root = document.createElement('div');
    const markerElement = document.createElement('div');
    const marker = {
      element: sourceElement,
      focus: { enabled: false },
      key: 'marker-a',
      kind: 'marker',
      label: null,
      ruleIndex: 0,
      scroll: { align: 'end', behavior: 'smooth', enabled: true, target: 'self' },
      selector: '.source',
    } as unknown as TrackerMarkerRecord;
    const renderRecord = { kind: 'marker', key: 'marker-a', marker } as TrackerRenderRecord;
    const controller = new InteractionController({
      getRenderRecordByKey: () => renderRecord,
      getRenderRecords: () => [renderRecord],
      scrollContext,
    });

    markerElement.setAttribute('data-rxtt-key', 'marker-a');
    root.appendChild(markerElement);
    document.body.append(sourceElement, root);
    root.getBoundingClientRect = () =>
      ({
        bottom: 20,
        height: 20,
        left: 0,
        right: 100,
        toJSON: () => ({}),
        top: 0,
        width: 100,
        x: 0,
        y: 0,
      }) as DOMRect;
    controller.connect(root, resolveTrackerOptions({ orientation: 'horizontal' }));

    expect(controller.activateRenderRecordByKey('marker-a')).toBe(true);
    expect(scrollContext.scrollElement).toHaveBeenCalledWith(sourceElement, 'horizontal', {
      behavior: 'smooth',
      align: 'end',
    });

    expect(controller.activateTrack(new MouseEvent('click', { clientX: 50 }))).toBe(true);
    expect(scrollContext.scrollToPhysicalOffset).toHaveBeenCalledWith(400, 'horizontal', 'auto');

    controller.destroy();
  });

  it('connects authoritative scroll observation through the context cleanup', () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const disconnectScroll = vi.fn();
    let scrollListener = () => {};
    const scrollContext = createScrollContext();
    const connectScrollListener = vi.mocked(scrollContext.connectScrollListener);
    const scheduler = { request: vi.fn() };
    const root = document.createElement('div');

    document.body.appendChild(root);

    const observer = new ObserverController({
      getRoot: () => root,
      getRuntimeContext: () => ({
        document,
        window,
        sourceRoot: document.body,
        scrollRoot: window,
        scrollMode: 'window',
        renderRoot: root,
        scrollContext,
      }),
      scheduler,
    });

    connectScrollListener.mockImplementation((listener) => {
      scrollListener = listener;

      return disconnectScroll;
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);

      return frameCallbacks.length;
    });

    observer.connect(resolveTrackerOptions({ updates: { mutation: { enabled: false }, resize: { enabled: false } } }));

    expect(connectScrollListener).toHaveBeenCalledTimes(1);

    scrollListener();
    scrollListener();

    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks[0]!(0);

    expect(scheduler.request).toHaveBeenCalledWith('markers', { source: 'scroll' });

    observer.destroy();

    expect(disconnectScroll).toHaveBeenCalledTimes(1);
  });
});
