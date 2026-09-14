// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { LayoutEngine } from '../LayoutEngine.js';
import type { TrackerMarkerRecord, TrackerResolvedOptions } from '../../types.js';
import type {
  TrackerElementCoordinates,
  TrackerScrollContext,
  TrackerScrollMetrics,
} from '../../scroll/scrollContext.js';

/**
 * Creates a minimal marker record wrapping a live DOM element.
 *
 * @param element - Marker element.
 * @returns Marker record stub.
 */
function createMarkerRecord(element: Element): TrackerMarkerRecord {
  return {
    kind: 'marker',
    key: 'k',
    element,
    rule: { selector: '.tracked' } as TrackerMarkerRecord['rule'],
    ruleIndex: 0,
    selector: '.tracked',
    label: null,
    scroll: {} as TrackerMarkerRecord['scroll'],
    focus: {} as TrackerMarkerRecord['focus'],
    cluster: null,
  };
}

/**
 * Scroll context stub whose element coordinates and track content size both
 * come from mutable lookups rather than values captured once, so a test can
 * change what the next measurement sees.
 *
 * @param coordinatesByElement - Mutable map from element to current coordinates.
 * @param contentSizeRef - Mutable holder for the current track content size.
 * @param contentSizeRef.current - Track content size used by the next measurement.
 * @returns Scroll context stub.
 */
function createLiveScrollContextStub(
  coordinatesByElement: Map<Element, TrackerElementCoordinates>,
  contentSizeRef: { current: number } = { current: 1000 },
): TrackerScrollContext {
  return {
    getMetrics(): TrackerScrollMetrics {
      return {
        axis: 'y',
        contentSize: contentSizeRef.current,
        viewportSize: 200,
        scrollOffset: 0,
        maxOffset: contentSizeRef.current - 200,
      };
    },
    getElementCoordinates(element: Element): TrackerElementCoordinates | null {
      return coordinatesByElement.get(element) ?? null;
    },
  } as unknown as TrackerScrollContext;
}

describe('core layout engine', () => {
  it('measureMarkers() reads current element coordinates on every call, with no caching between calls', () => {
    const element = document.createElement('div');

    document.body.appendChild(element);

    const coordinates = new Map<Element, TrackerElementCoordinates>();

    coordinates.set(element, { start: 100, end: 120, center: 110 });

    const scrollContext = createLiveScrollContextStub(coordinates);
    const layoutEngine = new LayoutEngine({ scrollContext });
    const options = { orientation: 'vertical' } as TrackerResolvedOptions;
    const before = layoutEngine.measureMarkers([createMarkerRecord(element)], options);

    expect(before[0]).toMatchObject({ start: 10, end: 12 });

    // The element's coordinates change with no LayoutEngine method called in
    // between (e.g. an ancestor CSS transform completing outside any observed
    // signal). The next measurement must reflect it immediately.
    coordinates.set(element, { start: 300, end: 340, center: 320 });

    const after = layoutEngine.measureMarkers([createMarkerRecord(element)], options);

    expect(after[0]).toMatchObject({ start: 30, end: 34 });
  });

  it('measureMarkers() reflects a content-size change on the very next measurement', () => {
    const element = document.createElement('div');

    document.body.appendChild(element);

    const coordinates = new Map<Element, TrackerElementCoordinates>();

    coordinates.set(element, { start: 200, end: 250, center: 225 });

    const contentSizeRef = { current: 500 };
    const scrollContext = createLiveScrollContextStub(coordinates, contentSizeRef);
    const layoutEngine = new LayoutEngine({ scrollContext });
    const options = { orientation: 'vertical' } as TrackerResolvedOptions;

    const before = layoutEngine.measureMarkers([createMarkerRecord(element)], options);

    expect(before[0]).toMatchObject({ start: 40, end: 50 });

    // Simulates a late track content-size change (e.g. an image or font
    // finishing load and growing the scrollable content) with the element
    // coordinates unchanged and no LayoutEngine method called in between. The
    // next measurement must move only because the denominator changed.
    contentSizeRef.current = 1000;

    const result = layoutEngine.measureMarkers([createMarkerRecord(element)], options);

    expect(result[0]).toMatchObject({ start: 20, end: 25 });
  });
});
