import { isElement } from '../dom/element.js';
import { toTrackPercent } from '../dom/geometry.js';
import type {
  TrackerMarkerLayoutRecord,
  TrackerMarkerRecord,
  TrackerOrientation,
  TrackerResolvedOptions,
  TrackerViewportLayoutRecord,
} from '../types.js';
import type { TrackerScrollContext, TrackerScrollMetrics } from '../scroll/scrollContext.js';

interface LayoutEngineContext {
  /** Active normalized scroll and geometry boundary. */
  scrollContext?: TrackerScrollContext | null;
}

/**
 * Creates a layout record for a marker.
 *
 * @param markerRecord - Marker record.
 * @param orientation - Layout orientation.
 * @param contentSize - Content size on the main axis.
 * @param scrollContext - Active normalized geometry boundary.
 * @returns Layout record or null.
 */
function createMarkerLayout(
  markerRecord: TrackerMarkerRecord,
  orientation: TrackerOrientation,
  contentSize: number,
  scrollContext: TrackerScrollContext,
): TrackerMarkerLayoutRecord | null {
  if (!markerRecord || !isElement(markerRecord.element) || !isElementConnected(markerRecord.element)) {
    return null;
  }

  const coordinates = scrollContext.getElementCoordinates(markerRecord.element, orientation);

  if (!coordinates) {
    return null;
  }

  const start = toTrackPercent(coordinates.start, contentSize);
  const end = toTrackPercent(coordinates.end, contentSize);
  const size = Math.max(0, end - start);

  return {
    marker: markerRecord,
    start,
    end,
    size,
    orientation,
    source: {
      start: coordinates.start,
      end: coordinates.end,
      size: Math.max(0, coordinates.end - coordinates.start),
    },
  };
}

/**
 * Checks whether an element is connected to the current document tree.
 *
 * @param element - Element to check.
 * @returns True when the element is connected or connection cannot be checked.
 */
function isElementConnected(element: Element): boolean {
  return typeof element.isConnected === 'boolean' ? element.isConnected : true;
}

/**
 * Returns safe zero metrics while no scroll context is mounted.
 *
 * @param orientation - Tracker orientation.
 * @returns Empty physical metrics.
 */
function createEmptyScrollMetrics(orientation: TrackerOrientation): TrackerScrollMetrics {
  return {
    axis: orientation === 'horizontal' ? 'x' : 'y',
    contentSize: 0,
    viewportSize: 0,
    scrollOffset: 0,
    maxOffset: 0,
  };
}

/**
 * Calculates marker and viewport geometry.
 *
 * LayoutEngine performs DOM reads and in-memory calculations only. DOM writes
 * are owned by the active renderer.
 */
class LayoutEngine {
  /**
   * Layout engine context.
   */
  #context: LayoutEngineContext;

  /**
   * @param context - Active scroll context used for measurements. The reference is
   * retained until updateContext() or destroy(). The constructor performs no DOM reads.
   */
  constructor(context: LayoutEngineContext = {}) {
    this.#context = {
      scrollContext: context.scrollContext || null,
    };
  }

  /**
   * Measures marker positions on the track.
   *
   * Returned coordinates are percentages in the 0..100 track range.
   *
   * @param markerRecords - Marker records.
   * @param options - Committed Tracker options.
   * @returns Layout records.
   */
  measureMarkers(
    markerRecords: readonly TrackerMarkerRecord[],
    options: TrackerResolvedOptions,
  ): TrackerMarkerLayoutRecord[] {
    if (!Array.isArray(markerRecords) || markerRecords.length === 0) {
      return [];
    }

    const orientation = options.orientation;
    const scrollContext = this.#context.scrollContext ?? null;

    if (scrollContext === null) {
      return [];
    }

    const { contentSize } = scrollContext.getMetrics(orientation);

    if (!Number.isFinite(contentSize) || contentSize <= 0) {
      return [];
    }

    return markerRecords.reduce<TrackerMarkerLayoutRecord[]>((records, markerRecord) => {
      const layoutRecord = createMarkerLayout(markerRecord, orientation, contentSize, scrollContext);

      if (layoutRecord !== null) {
        records.push(layoutRecord);
      }

      return records;
    }, []);
  }

  /**
   * Measures the visible viewport indicator on the track.
   *
   * Returned coordinates are percentages in the 0..100 track range.
   *
   * @param options - Committed Tracker options.
   * @returns Viewport layout record.
   */
  measureViewport(options: TrackerResolvedOptions): TrackerViewportLayoutRecord {
    const orientation = options.orientation;
    const { viewportSize, contentSize, scrollOffset } =
      this.#context.scrollContext?.getMetrics(orientation) ?? createEmptyScrollMetrics(orientation);

    if (!options.viewport.enabled || contentSize <= 0 || viewportSize <= 0) {
      return {
        start: 0,
        end: 0,
        size: 0,
        visible: false,
        orientation,
        source: {
          scrollOffset,
          viewportSize,
          contentSize,
        },
      };
    }

    if (viewportSize >= contentSize) {
      return {
        start: 0,
        end: 100,
        size: 100,
        visible: false,
        orientation,
        source: {
          scrollOffset,
          viewportSize,
          contentSize,
        },
      };
    }

    const start = toTrackPercent(scrollOffset, contentSize);
    const end = toTrackPercent(scrollOffset + viewportSize, contentSize);

    return {
      start,
      end,
      size: Math.max(0, end - start),
      visible: true,
      orientation,
      source: {
        scrollOffset,
        viewportSize,
        contentSize,
      },
    };
  }

  /**
   * Releases the active scroll context reference.
   */
  destroy(): void {
    this.#context = {
      scrollContext: null,
    };
  }

  /**
   * Updates layout context.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<LayoutEngineContext> = {}): void {
    this.#context = {
      ...this.#context,
      ...context,
    };
  }
}

export { LayoutEngine };
export type { LayoutEngineContext };
