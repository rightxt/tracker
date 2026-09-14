import { isInComposedSubtree } from '../dom/composedTree.js';
import { getOwnerDocument, getOwnerWindow } from '../dom/context.js';
import { resolveScrollPaddingLength } from '../dom/cssLength.js';
import { isElement } from '../dom/element.js';
import { readElementNativeOffset, resolveAxisOffsetConverter, writeElementNativeOffset } from '../dom/physicalAxis.js';
import { noop } from '../utils/function.js';
import {
  getOrientationAxis,
  isActiveDocumentRealm,
  normalizeActivationBehavior,
  normalizeAlignment,
  normalizeExecutionBehavior,
  normalizeMetric,
} from './contextShared.js';
import type { TrackerOrientation } from '../types.js';
import type {
  TrackerElementCoordinates,
  TrackerPhysicalAxis,
  TrackerScrollActivationOptions,
  TrackerScrollContext,
  TrackerScrollExecutionBehavior,
  TrackerScrollMetrics,
  TrackerScrollMode,
} from './scrollContext.js';

/** Scroll-padding fallback diagnostic payload. */
interface ElementScrollPaddingFallback {
  /** Physical scroll-padding property that fell back. */
  property: string;
  /** Original computed value. */
  value: string;
}

/** Internal element-context diagnostics options. */
interface ElementScrollContextOptions {
  /** Called once per unresolvable scroll-padding value falling back to 0. */
  onScrollPaddingFallback?: (fallback: ElementScrollPaddingFallback) => void;
}

/** Resolved physical scroll padding for one represented axis. */
interface PhysicalScrollPadding {
  /** Physical start padding in CSS pixels. */
  start: number;
  /** Physical end padding in CSS pixels. */
  end: number;
}

/**
 * Returns the physical start/end scroll property names for one axis.
 *
 * @param axis - Physical axis.
 * @param prefix - Property family: scroll-padding or scroll-margin.
 * @returns Physical property names.
 */
function getPhysicalEdgeProperties(axis: TrackerPhysicalAxis, prefix: string): { start: string; end: string } {
  return axis === 'x'
    ? { start: `${prefix}-left`, end: `${prefix}-right` }
    : { start: `${prefix}-top`, end: `${prefix}-bottom` };
}

/**
 * Parses one computed scroll-margin value.
 *
 * Computed scroll-margin values are absolute lengths; negative values remain
 * valid and are normalized later by the alignment formulas.
 *
 * @param value - Computed scroll-margin value.
 * @returns Finite CSS pixel value.
 */
function parseScrollMargin(value: string | undefined | null): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number.parseFloat(value) : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Element-mode implementation of the internal physical scroll contract.
 *
 * The context owns every raw native offset read/write for its root, exposes
 * both-axis normalized physical metrics, and implements the deterministic
 * element-mode physical alignment formulas. Activation and drag never scroll
 * any element other than the authoritative root.
 */
class ElementScrollContext implements TrackerScrollContext {
  /** Active mode. */
  readonly mode: TrackerScrollMode = 'element';

  /** Authoritative element scroll root. */
  readonly root: HTMLElement;

  /** Document captured for this mount cycle. */
  readonly document: Document;

  /** Window captured for this mount cycle. */
  readonly window: Window;

  /** Public diagnostic bridge for scroll-padding fallback normalization. */
  readonly #onScrollPaddingFallback: ((fallback: ElementScrollPaddingFallback) => void) | null;

  /**
   * @param root - Validated authoritative element scroll root.
   * @param options - Internal fallback diagnostics options.
   * @throws TypeError when the root has no owner document/window pair.
   */
  constructor(root: HTMLElement, options: ElementScrollContextOptions = {}) {
    const ownerDocument = getOwnerDocument(root);
    const ownerWindow = getOwnerWindow(root);

    if (ownerDocument === null || ownerWindow === null) {
      throw new TypeError('ElementScrollContext root must belong to an active document and window.');
    }

    this.root = root;
    this.document = ownerDocument;
    this.window = ownerWindow;
    this.#onScrollPaddingFallback =
      typeof options.onScrollPaddingFallback === 'function' ? options.onScrollPaddingFallback : null;
  }

  /**
   * Returns normalized element metrics for one represented orientation.
   *
   * @param orientation - Tracker orientation.
   * @returns Normalized physical metrics.
   */
  getMetrics(orientation: TrackerOrientation): TrackerScrollMetrics {
    const axis = getOrientationAxis(orientation);

    if (!this.#isActiveRealm()) {
      return {
        axis,
        contentSize: 0,
        viewportSize: 0,
        scrollOffset: 0,
        maxOffset: 0,
      };
    }

    return this.#readMetrics(axis);
  }

  /**
   * Returns border-aware content coordinates along one physical axis.
   *
   * Coordinates are physical offsets inside the root's scrollable content
   * space, so `0` is the physical start of the content regardless of writing
   * mode or direction.
   *
   * @param element - Same-realm element inside the authoritative subtree.
   * @param orientation - Tracker orientation.
   * @returns Physical coordinates, or null for an invalid source.
   */
  getElementCoordinates(element: Element, orientation: TrackerOrientation): TrackerElementCoordinates | null {
    if (!this.#isValidSubtreeElement(element)) {
      return null;
    }

    const axis = getOrientationAxis(orientation);
    const metrics = this.#readMetrics(axis);
    const rootRect = this.root.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const clientBorderStart = axis === 'x' ? this.root.clientLeft : this.root.clientTop;
    const rectStart = axis === 'x' ? elementRect.left : elementRect.top;
    const rootStart = axis === 'x' ? rootRect.left : rootRect.top;
    const rectSize = axis === 'x' ? elementRect.width : elementRect.height;
    const start = rectStart - rootStart - clientBorderStart + metrics.scrollOffset;
    const end = start + normalizeMetric(rectSize);

    return {
      start,
      end,
      center: start + (end - start) / 2,
    };
  }

  /**
   * Scrolls the root to one normalized physical offset.
   *
   * Internal `instant` execution never inherits CSS smooth scrolling.
   *
   * @param offset - Requested physical offset.
   * @param orientation - Tracker orientation.
   * @param behavior - Internal execution behavior.
   */
  scrollToPhysicalOffset(
    offset: number,
    orientation: TrackerOrientation,
    behavior: TrackerScrollExecutionBehavior,
  ): void {
    if (!this.#isActiveRealm()) {
      return;
    }

    const axis = getOrientationAxis(orientation);
    const metrics = this.#readMetrics(axis);
    const converter = resolveAxisOffsetConverter(this.root, axis, metrics.maxOffset);
    const nativeOffset = converter.toNativeOffset(normalizeMetric(offset), metrics.maxOffset);

    if (typeof this.root.scrollTo === 'function') {
      this.root.scrollTo(
        axis === 'x'
          ? { behavior: normalizeExecutionBehavior(behavior), left: nativeOffset }
          : { behavior: normalizeExecutionBehavior(behavior), top: nativeOffset },
      );

      return;
    }

    writeElementNativeOffset(this.root, axis, nativeOffset);
  }

  /**
   * Scrolls the authoritative root so a subtree target satisfies alignment.
   *
   * Implements the deterministic element-mode physical alignment formulas with
   * physical scroll padding from the root and physical scroll margin from the
   * target. Only the authoritative root is scrolled; nested-ancestor and
   * cross-axis scrolling are intentionally out of contract.
   *
   * @param element - Activation target inside the authoritative subtree.
   * @param orientation - Tracker orientation.
   * @param options - Behavior and represented-axis alignment.
   * @returns True when a deterministic scroll request was accepted.
   */
  scrollElement(element: Element, orientation: TrackerOrientation, options: TrackerScrollActivationOptions): boolean {
    if (!this.#isValidSubtreeElement(element)) {
      return false;
    }

    const axis = getOrientationAxis(orientation);
    const metrics = this.#readMetrics(axis);
    const coordinates = this.getElementCoordinates(element, orientation);

    if (coordinates === null) {
      return false;
    }

    const padding = this.#resolveScrollPadding(axis, metrics.viewportSize);
    const margin = this.#resolveScrollMargin(element, axis);
    let targetStart = coordinates.start - margin.start;
    let targetEnd = coordinates.end + margin.end;

    if (targetStart > targetEnd) {
      const midpoint = (targetStart + targetEnd) / 2;

      targetStart = midpoint;
      targetEnd = midpoint;
    }

    const align = normalizeAlignment(options.align);
    const requestedOffset = this.#resolveAlignedOffset(align, targetStart, targetEnd, padding, metrics);

    if (requestedOffset !== null) {
      this.scrollToPhysicalOffset(requestedOffset, orientation, normalizeActivationBehavior(options.behavior));
    }

    return true;
  }

  /**
   * Connects the authoritative element scroll listener.
   *
   * @param listener - Scroll invalidation listener.
   * @returns Idempotent disconnect callback.
   */
  connectScrollListener(listener: () => void): () => void {
    if (!this.#isActiveRealm() || typeof this.root.addEventListener !== 'function' || typeof listener !== 'function') {
      return noop;
    }

    let connected = true;

    this.root.addEventListener('scroll', listener, { passive: true });

    return () => {
      if (!connected) {
        return;
      }

      connected = false;

      try {
        this.root.removeEventListener('scroll', listener);
      } catch {
        // A navigated or torn-down realm may reject listener cleanup.
      }
    };
  }

  /**
   * Resolves the desired physical offset for one alignment.
   *
   * @param align - Normalized physical alignment.
   * @param targetStart - Normalized physical target start.
   * @param targetEnd - Normalized physical target end.
   * @param padding - Scaled physical scroll padding.
   * @param metrics - Current axis metrics.
   * @returns Requested offset, or null when `nearest` requires no movement.
   */
  #resolveAlignedOffset(
    align: TrackerScrollActivationOptions['align'],
    targetStart: number,
    targetEnd: number,
    padding: PhysicalScrollPadding,
    metrics: TrackerScrollMetrics,
  ): number | null {
    const { viewportSize, scrollOffset: currentOffset, maxOffset } = metrics;
    const paddedViewportSize = Math.max(0, viewportSize - padding.start - padding.end);

    if (align === 'start') {
      return targetStart - padding.start;
    }

    if (align === 'end') {
      return targetEnd - (viewportSize - padding.end);
    }

    if (align === 'center') {
      return (targetStart + targetEnd) / 2 - (padding.start + paddedViewportSize / 2);
    }

    const visibleStart = currentOffset + padding.start;
    const visibleEnd = currentOffset + viewportSize - padding.end;

    if (targetStart >= visibleStart && targetEnd <= visibleEnd) {
      return null;
    }

    if (targetStart <= visibleStart && targetEnd >= visibleEnd) {
      return null;
    }

    const startCandidate = targetStart - padding.start;
    const endCandidate = targetEnd - (viewportSize - padding.end);
    const selected =
      Math.abs(startCandidate - currentOffset) <= Math.abs(endCandidate - currentOffset)
        ? startCandidate
        : endCandidate;

    return Math.min(maxOffset, Math.max(0, selected));
  }

  /**
   * Resolves scaled physical scroll padding from the authoritative root.
   *
   * @param axis - Physical axis.
   * @param viewportSize - Physical scrollport size.
   * @returns Non-negative padding pair scaled to fit the viewport.
   */
  #resolveScrollPadding(axis: TrackerPhysicalAxis, viewportSize: number): PhysicalScrollPadding {
    const properties = getPhysicalEdgeProperties(axis, 'scroll-padding');
    const style = typeof this.window.getComputedStyle === 'function' ? this.window.getComputedStyle(this.root) : null;
    const rawStart = this.#resolveOnePadding(style, properties.start, axis, viewportSize);
    const rawEnd = this.#resolveOnePadding(style, properties.end, axis, viewportSize);
    const paddingSum = rawStart + rawEnd;
    const scale = paddingSum > viewportSize && paddingSum > 0 ? viewportSize / paddingSum : 1;

    return {
      start: rawStart * scale,
      end: rawEnd * scale,
    };
  }

  /**
   * Resolves one physical scroll-padding property with the documented fallback.
   *
   * @param style - Computed root style.
   * @param property - Physical scroll-padding property name.
   * @param axis - Physical axis supplying the percentage basis.
   * @param viewportSize - Physical scrollport size.
   * @returns Non-negative finite padding value.
   */
  #resolveOnePadding(
    style: CSSStyleDeclaration | null,
    property: string,
    axis: TrackerPhysicalAxis,
    viewportSize: number,
  ): number {
    const value = style?.getPropertyValue(property) ?? '';
    const resolved = resolveScrollPaddingLength(value, axis, viewportSize, this.document);

    if (resolved === null) {
      this.#onScrollPaddingFallback?.({ property, value });

      return 0;
    }

    return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
  }

  /**
   * Resolves physical scroll margin from one activation target.
   *
   * @param element - Activation target.
   * @param axis - Physical axis.
   * @returns Physical margin pair; negative values remain valid.
   */
  #resolveScrollMargin(element: Element, axis: TrackerPhysicalAxis): { start: number; end: number } {
    const properties = getPhysicalEdgeProperties(axis, 'scroll-margin');
    const style = typeof this.window.getComputedStyle === 'function' ? this.window.getComputedStyle(element) : null;

    return {
      start: parseScrollMargin(style?.getPropertyValue(properties.start)),
      end: parseScrollMargin(style?.getPropertyValue(properties.end)),
    };
  }

  /**
   * Reads current normalized physical metrics for one axis.
   *
   * @param axis - Physical axis.
   * @returns Normalized physical metrics.
   */
  #readMetrics(axis: TrackerPhysicalAxis): TrackerScrollMetrics {
    const viewportSize = normalizeMetric(axis === 'x' ? this.root.clientWidth : this.root.clientHeight);
    const contentSize = Math.max(
      viewportSize,
      normalizeMetric(axis === 'x' ? this.root.scrollWidth : this.root.scrollHeight),
    );
    const maxOffset = Math.max(0, contentSize - viewportSize);
    const converter = resolveAxisOffsetConverter(this.root, axis, maxOffset);
    const scrollOffset = converter.toPhysicalOffset(readElementNativeOffset(this.root, axis), maxOffset);

    return {
      axis,
      contentSize,
      viewportSize,
      scrollOffset,
      maxOffset,
    };
  }

  /**
   * Validates one same-realm activation or measurement source.
   *
   * @param element - Candidate element.
   * @returns True for a connected same-realm element inside the root subtree.
   */
  #isValidSubtreeElement(element: Element): boolean {
    return (
      this.#isActiveRealm() &&
      isElement(element) &&
      element.isConnected &&
      getOwnerDocument(element) === this.document &&
      getOwnerWindow(element) === this.window &&
      isInComposedSubtree(element, this.root)
    );
  }

  /**
   * Checks that iframe navigation has not replaced the captured document.
   *
   * @returns True while the captured Window/Document identity is current.
   */
  #isActiveRealm(): boolean {
    return isActiveDocumentRealm(this.document, this.window);
  }
}

export { ElementScrollContext };
export type { ElementScrollContextOptions, ElementScrollPaddingFallback };
