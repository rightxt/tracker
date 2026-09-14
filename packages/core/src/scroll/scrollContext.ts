import type { TrackerOrientation, TrackerScrollAlign, TrackerScrollBehavior, TrackerScrollMode } from '../types.js';

/** Physical axes used by internal scroll contexts. */
type TrackerPhysicalAxis = 'x' | 'y';

/** Public scroll behavior plus the drag-only immediate execution mode. */
type TrackerScrollExecutionBehavior = TrackerScrollBehavior | 'instant';

/** Normalized metrics for one represented physical axis. */
interface TrackerScrollMetrics {
  /** Represented physical axis. */
  axis: TrackerPhysicalAxis;
  /** Total content extent on the represented axis. */
  contentSize: number;
  /** Visible extent on the represented axis. */
  viewportSize: number;
  /** Normalized physical scroll offset. */
  scrollOffset: number;
  /** Maximum normalized physical offset. */
  maxOffset: number;
}

/** Element coordinates in the scroll context's physical coordinate space. */
interface TrackerElementCoordinates {
  /** Physical start coordinate. */
  start: number;
  /** Physical end coordinate. */
  end: number;
  /** Physical center coordinate. */
  center: number;
}

/** Marker or cluster scroll activation options. */
interface TrackerScrollActivationOptions {
  /** Native execution behavior. */
  behavior: TrackerScrollBehavior;
  /** Physical represented-axis alignment. */
  align: TrackerScrollAlign;
}

/** Internal scroll and geometry boundary shared by layout, interaction, and observation. */
interface TrackerScrollContext {
  /** Active scroll mode. */
  readonly mode: TrackerScrollMode;
  /** Authoritative native scroll root. */
  readonly root: Window | HTMLElement;
  /** Document owning all accepted source elements. */
  readonly document: Document;
  /** Window owning metrics, events, and native scrolling. */
  readonly window: Window;

  /**
   * Returns normalized metrics for one Tracker orientation.
   *
   * @param orientation - Represented Tracker orientation.
   * @returns Normalized physical metrics.
   */
  getMetrics(orientation: TrackerOrientation): TrackerScrollMetrics;

  /**
   * Returns source coordinates in the context's physical coordinate space.
   *
   * @param element - Source element.
   * @param orientation - Represented Tracker orientation.
   * @returns Physical coordinates, or null for an invalid source.
   */
  getElementCoordinates(element: Element, orientation: TrackerOrientation): TrackerElementCoordinates | null;

  /**
   * Scrolls to one normalized physical offset.
   *
   * @param offset - Requested physical offset.
   * @param orientation - Represented Tracker orientation.
   * @param behavior - Internal execution behavior.
   */
  scrollToPhysicalOffset(
    offset: number,
    orientation: TrackerOrientation,
    behavior: TrackerScrollExecutionBehavior,
  ): void;

  /**
   * Requests native or deterministic element activation scrolling.
   *
   * @param element - Activation target.
   * @param orientation - Represented Tracker orientation.
   * @param options - Scroll behavior and physical alignment.
   * @returns True when a valid native scroll request was accepted.
   */
  scrollElement(element: Element, orientation: TrackerOrientation, options: TrackerScrollActivationOptions): boolean;

  /**
   * Connects the authoritative scroll listener.
   *
   * @param listener - Scroll invalidation listener.
   * @returns Idempotent disconnect callback.
   */
  connectScrollListener(listener: () => void): () => void;
}

export type {
  TrackerElementCoordinates,
  TrackerPhysicalAxis,
  TrackerScrollActivationOptions,
  TrackerScrollAlign,
  TrackerScrollContext,
  TrackerScrollExecutionBehavior,
  TrackerScrollMetrics,
  TrackerScrollMode,
};
