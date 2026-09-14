import { getOwnerDocument, getOwnerWindow } from './context.js';
import { getInternalDomRegistry } from './internalDomRegistry.js';
import { createIsolatedProbeStyle } from './probeIsolation.js';

/** Physical axis used by Tracker geometry. */
type TrackerPhysicalAxis = 'x' | 'y';

/** Direction in which native offsets move between physical edges. */
type TrackerAxisFlowDirection = 'positive' | 'negative';

/** Root- and axis-specific native offset model. */
interface TrackerNativeAxisModel {
  /** Physical axis represented by this model. */
  axis: TrackerPhysicalAxis;
  /** Native numeric direction from physical start to end. */
  flowDirection: TrackerAxisFlowDirection;
  /** Native offset at physical top or left. */
  nativeStart: number;
  /** Native offset at physical bottom or right. */
  nativeEnd: number;
  /** Minimum accepted native value. */
  nativeMinimum: number;
  /** Maximum accepted native value. */
  nativeMaximum: number;
}

/** Converts one native axis into Tracker physical offsets. */
interface TrackerAxisOffsetConverter {
  /** Physical axis represented by this converter. */
  readonly axis: TrackerPhysicalAxis;
  /** Resolved native endpoint model. */
  readonly model: TrackerNativeAxisModel;
  /** Converts a raw native offset to a physical offset. */
  toPhysicalOffset(nativeOffset: number, maxOffset: number): number;
  /** Converts a physical offset to the raw native model. */
  toNativeOffset(physicalOffset: number, maxOffset: number): number;
}

/** Realm-wide endpoint ratios measured by an internal probe. */
interface NativeAxisBehavior {
  /** Native endpoint ratio at physical top or left. */
  nativeStartRatio: number;
  /** Native endpoint ratio at physical bottom or right. */
  nativeEndRatio: number;
}

/** Browser behavior caches keyed weakly by document. */
const BEHAVIOR_CACHE = new WeakMap<Document, Map<string, NativeAxisBehavior>>();

/** Safe positive native behavior used when a DOM probe is unavailable. */
const POSITIVE_BEHAVIOR: Readonly<NativeAxisBehavior> = Object.freeze({
  nativeStartRatio: 0,
  nativeEndRatio: 1,
});

/**
 * Clamps a finite value to an inclusive range.
 *
 * @param value - Candidate value.
 * @param minimum - Minimum value.
 * @param maximum - Maximum value.
 * @returns Clamped finite value.
 */
function clampFinite(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Normalizes a maximum physical offset.
 *
 * @param maxOffset - Candidate maximum offset.
 * @returns Non-negative finite maximum.
 */
function normalizeMaxOffset(maxOffset: number): number {
  return Number.isFinite(maxOffset) ? Math.max(0, maxOffset) : 0;
}

/**
 * Creates a converter from concrete native endpoints.
 *
 * @param model - Native endpoint model.
 * @returns Axis converter.
 */
function createAxisOffsetConverter(model: TrackerNativeAxisModel): TrackerAxisOffsetConverter {
  const nativeSpan = model.nativeEnd - model.nativeStart;

  return {
    axis: model.axis,
    model,
    toPhysicalOffset(nativeOffset, maxOffset) {
      const safeMaxOffset = normalizeMaxOffset(maxOffset);

      if (safeMaxOffset === 0 || !Number.isFinite(nativeSpan) || Math.abs(nativeSpan) < Number.EPSILON) {
        return 0;
      }

      const progress =
        (clampFinite(nativeOffset, model.nativeMinimum, model.nativeMaximum) - model.nativeStart) / nativeSpan;

      return clampFinite(progress * safeMaxOffset, 0, safeMaxOffset);
    },
    toNativeOffset(physicalOffset, maxOffset) {
      const safeMaxOffset = normalizeMaxOffset(maxOffset);

      if (safeMaxOffset === 0 || !Number.isFinite(nativeSpan) || Math.abs(nativeSpan) < Number.EPSILON) {
        return clampFinite(model.nativeStart, model.nativeMinimum, model.nativeMaximum);
      }

      const progress = clampFinite(physicalOffset, 0, safeMaxOffset) / safeMaxOffset;
      const nativeOffset = model.nativeStart + nativeSpan * progress;

      return clampFinite(nativeOffset, model.nativeMinimum, model.nativeMaximum);
    },
  };
}

/**
 * Reads one raw element scroll offset inside the conversion boundary.
 *
 * @param root - Scrollable element.
 * @param axis - Physical axis.
 * @returns Native offset.
 */
function readElementNativeOffset(root: Element, axis: TrackerPhysicalAxis): number {
  return axis === 'x' ? root.scrollLeft : root.scrollTop;
}

/**
 * Writes one raw element scroll offset inside the conversion boundary.
 *
 * @param root - Scrollable element.
 * @param axis - Physical axis.
 * @param offset - Native offset.
 */
function writeElementNativeOffset(root: Element, axis: TrackerPhysicalAxis, offset: number): void {
  if (axis === 'x') {
    root.scrollLeft = offset;
    return;
  }

  root.scrollTop = offset;
}

/**
 * Returns the physical rect start for an axis.
 *
 * @param rect - DOM rectangle.
 * @param axis - Physical axis.
 * @returns Rect start.
 */
function getRectStart(rect: DOMRect, axis: TrackerPhysicalAxis): number {
  return axis === 'x' ? rect.left : rect.top;
}

/**
 * Returns the element's maximum raw scroll extent for an axis.
 *
 * @param root - Scrollable element.
 * @param axis - Physical axis.
 * @returns Non-negative maximum offset.
 */
function getElementMaxOffset(root: Element, axis: TrackerPhysicalAxis): number {
  return axis === 'x'
    ? Math.max(0, root.scrollWidth - root.clientWidth)
    : Math.max(0, root.scrollHeight - root.clientHeight);
}

/**
 * Normalizes a measured native endpoint to a reusable maximum-offset ratio.
 *
 * @param nativeOffset - Measured native endpoint.
 * @param maxOffset - Probe maximum offset.
 * @returns Endpoint ratio.
 */
function normalizeEndpointRatio(nativeOffset: number, maxOffset: number): number {
  if (!Number.isFinite(nativeOffset) || !Number.isFinite(maxOffset) || maxOffset <= 0) {
    return 0;
  }

  const ratio = nativeOffset / maxOffset;

  if (Math.abs(ratio) <= 0.01) {
    return 0;
  }

  if (Math.abs(ratio - 1) <= 0.01) {
    return 1;
  }

  if (Math.abs(ratio + 1) <= 0.01) {
    return -1;
  }

  return ratio;
}

/**
 * Measures native endpoints for one writing-mode/direction/axis combination.
 *
 * The application scroll root is never mutated. The probe is registered before
 * insertion, removed in `finally`, and retired through pending mutation delivery.
 *
 * @param document - Document providing the browser realm.
 * @param writingMode - Concrete computed writing mode.
 * @param direction - Concrete computed direction.
 * @param axis - Physical axis.
 * @returns Measured realm-wide behavior.
 */
function measureNativeAxisBehavior(
  document: Document,
  writingMode: string,
  direction: string,
  axis: TrackerPhysicalAxis,
): NativeAxisBehavior {
  const parent = document.body ?? document.documentElement;

  if (!parent) {
    return { ...POSITIVE_BEHAVIOR };
  }

  const root = document.createElement('div');
  const content = document.createElement('div');
  const registry = getInternalDomRegistry(document);

  root.setAttribute('data-rxtt-internal-probe', 'axis');
  // `position: absolute` also takes the probe out of any flex/grid formatting
  // context a hostile `body { display: flex }`-style rule might impose on its
  // parent, since out-of-flow elements never participate as flex/grid items.
  root.style.cssText = createIsolatedProbeStyle({
    'box-sizing': 'content-box',
    direction,
    display: 'block',
    height: '32px',
    left: '-10000px',
    margin: '0',
    'max-height': 'none',
    'max-width': 'none',
    'min-height': '0',
    'min-width': '0',
    overflow: 'scroll',
    padding: '0',
    'pointer-events': 'none',
    position: 'absolute',
    top: '-10000px',
    transform: 'none',
    visibility: 'hidden',
    width: '32px',
    'writing-mode': writingMode,
  });
  content.style.cssText = createIsolatedProbeStyle({
    'box-sizing': 'content-box',
    display: 'block',
    height: '96px',
    'max-height': 'none',
    'max-width': 'none',
    'min-height': '0',
    'min-width': '0',
    position: 'relative',
    width: '96px',
  });
  root.appendChild(content);
  registry.register(root, 'probe');

  try {
    parent.appendChild(root);

    const maxOffset = getElementMaxOffset(root, axis);

    if (maxOffset <= 0) {
      return { ...POSITIVE_BEHAVIOR };
    }

    const rootStart =
      getRectStart(root.getBoundingClientRect(), axis) + (axis === 'x' ? root.clientLeft : root.clientTop);
    const samples = [-1_000_000, 0, 1_000_000].map((requestedOffset) => {
      writeElementNativeOffset(root, axis, requestedOffset);

      return {
        nativeOffset: readElementNativeOffset(root, axis),
        physicalOffset: clampFinite(rootStart - getRectStart(content.getBoundingClientRect(), axis), 0, maxOffset),
      };
    });
    const startSample = samples.reduce((best, sample) => (sample.physicalOffset < best.physicalOffset ? sample : best));
    const endSample = samples.reduce((best, sample) => (sample.physicalOffset > best.physicalOffset ? sample : best));

    return {
      nativeStartRatio: normalizeEndpointRatio(startSample.nativeOffset, maxOffset),
      nativeEndRatio: normalizeEndpointRatio(endSample.nativeOffset, maxOffset),
    };
  } finally {
    root.remove();
    registry.retire(root);
  }
}

/**
 * Returns a stable cache key for realm-wide native behavior.
 *
 * @param writingMode - Computed writing mode.
 * @param direction - Computed direction.
 * @param axis - Physical axis.
 * @returns Cache key.
 */
function createBehaviorCacheKey(writingMode: string, direction: string, axis: TrackerPhysicalAxis): string {
  return `${writingMode}\u0000${direction}\u0000${axis}`;
}

/**
 * Resolves cached realm-wide native behavior.
 *
 * @param document - Active document.
 * @param writingMode - Computed writing mode.
 * @param direction - Computed direction.
 * @param axis - Physical axis.
 * @returns Native endpoint behavior.
 */
function resolveNativeAxisBehavior(
  document: Document,
  writingMode: string,
  direction: string,
  axis: TrackerPhysicalAxis,
): NativeAxisBehavior {
  let documentCache = BEHAVIOR_CACHE.get(document);

  if (documentCache === undefined) {
    documentCache = new Map();
    BEHAVIOR_CACHE.set(document, documentCache);
  }

  const cacheKey = createBehaviorCacheKey(writingMode, direction, axis);
  const cachedBehavior = documentCache.get(cacheKey);

  if (cachedBehavior !== undefined) {
    return cachedBehavior;
  }

  const behavior = measureNativeAxisBehavior(document, writingMode, direction, axis);

  documentCache.set(cacheKey, behavior);

  return behavior;
}

/**
 * Resolves a converter for one concrete root and current maximum offset.
 *
 * Computed flow metadata and dimensions are root-specific. Only the measured
 * endpoint behavior for the same realm/style/axis combination is cached.
 *
 * @param styleRoot - Element supplying computed flow metadata.
 * @param axis - Physical axis.
 * @param maxOffset - Current concrete maximum offset.
 * @returns Axis converter.
 */
function resolveAxisOffsetConverter(
  styleRoot: Element,
  axis: TrackerPhysicalAxis,
  maxOffset: number,
): TrackerAxisOffsetConverter {
  const document = getOwnerDocument(styleRoot);
  const window = getOwnerWindow(styleRoot);
  const safeMaxOffset = normalizeMaxOffset(maxOffset);
  let behavior = POSITIVE_BEHAVIOR;

  if (document !== null && window !== null && typeof window.getComputedStyle === 'function') {
    const computedStyle = window.getComputedStyle(styleRoot);

    behavior = resolveNativeAxisBehavior(document, computedStyle.writingMode, computedStyle.direction, axis);
  }

  const nativeStart = behavior.nativeStartRatio * safeMaxOffset;
  const nativeEnd = behavior.nativeEndRatio * safeMaxOffset;
  const model: TrackerNativeAxisModel = {
    axis,
    flowDirection: nativeEnd >= nativeStart ? 'positive' : 'negative',
    nativeStart,
    nativeEnd,
    nativeMinimum: Math.min(nativeStart, nativeEnd),
    nativeMaximum: Math.max(nativeStart, nativeEnd),
  };

  return createAxisOffsetConverter(model);
}

/**
 * Returns page content and viewport extents for one physical axis.
 *
 * @param window - Active Window.
 * @param axis - Physical axis.
 * @returns Page axis extents.
 */
function getWindowAxisExtents(
  window: Window,
  axis: TrackerPhysicalAxis,
): { contentSize: number; viewportSize: number } {
  const { document } = window;
  const { body, documentElement } = document;

  if (!body || !documentElement) {
    return { contentSize: 0, viewportSize: 0 };
  }

  if (axis === 'x') {
    const viewportSize = documentElement.clientWidth || window.innerWidth || 0;
    const contentSize = Math.max(
      body.scrollWidth,
      documentElement.scrollWidth,
      body.offsetWidth,
      documentElement.offsetWidth,
      body.clientWidth,
      viewportSize,
    );

    return { contentSize, viewportSize };
  }

  const viewportSize = documentElement.clientHeight || window.innerHeight || 0;
  const contentSize = Math.max(
    body.scrollHeight,
    documentElement.scrollHeight,
    body.offsetHeight,
    documentElement.offsetHeight,
    body.clientHeight,
    viewportSize,
  );

  return { contentSize, viewportSize };
}

/**
 * Reads a normalized physical Window offset.
 *
 * @param window - Active Window.
 * @param axis - Physical axis.
 * @returns Physical offset in CSS pixels.
 */
function readWindowPhysicalOffset(window: Window, axis: TrackerPhysicalAxis): number {
  const { document } = window;
  const styleRoot = document.documentElement;

  if (!styleRoot) {
    return 0;
  }

  const { contentSize, viewportSize } = getWindowAxisExtents(window, axis);
  const maxOffset = Math.max(0, contentSize - viewportSize);
  const converter = resolveAxisOffsetConverter(styleRoot, axis, maxOffset);
  const scrollingElement = document.scrollingElement ?? styleRoot ?? document.body;
  const nativeOffset = scrollingElement
    ? readElementNativeOffset(scrollingElement, axis)
    : axis === 'x'
      ? window.scrollX
      : window.scrollY;

  return converter.toPhysicalOffset(nativeOffset, maxOffset);
}

/**
 * Writes a normalized physical Window offset.
 *
 * @param window - Active Window.
 * @param axis - Physical axis.
 * @param physicalOffset - Requested physical offset.
 * @param behavior - Native scroll behavior.
 */
function writeWindowPhysicalOffset(
  window: Window,
  axis: TrackerPhysicalAxis,
  physicalOffset: number,
  behavior: ScrollBehavior,
): void {
  const { document } = window;
  const styleRoot = document.documentElement;

  if (!styleRoot) {
    return;
  }

  const { contentSize, viewportSize } = getWindowAxisExtents(window, axis);
  const maxOffset = Math.max(0, contentSize - viewportSize);
  const converter = resolveAxisOffsetConverter(styleRoot, axis, maxOffset);
  const nativeOffset =
    maxOffset > 0 ? converter.toNativeOffset(physicalOffset, maxOffset) : Math.max(0, physicalOffset);

  if (axis === 'x') {
    window.scrollTo({ behavior, left: nativeOffset });
    return;
  }

  window.scrollTo({ behavior, top: nativeOffset });
}

/**
 * Clears cached engine behavior for one document.
 *
 * Root-specific dimensions and computed styles are never stored here. This
 * helper exists for deterministic internal tests and realm teardown paths.
 *
 * @param document - Document whose engine cache is released.
 */
function clearNativeAxisBehaviorCache(document: Document): void {
  BEHAVIOR_CACHE.delete(document);
}

export {
  clearNativeAxisBehaviorCache,
  createAxisOffsetConverter,
  getElementMaxOffset,
  getWindowAxisExtents,
  readElementNativeOffset,
  readWindowPhysicalOffset,
  resolveAxisOffsetConverter,
  writeElementNativeOffset,
  writeWindowPhysicalOffset,
};
export type {
  NativeAxisBehavior,
  TrackerAxisFlowDirection,
  TrackerAxisOffsetConverter,
  TrackerNativeAxisModel,
  TrackerPhysicalAxis,
};
