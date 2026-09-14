import { getOwnerDocument, getOwnerWindow } from '../dom/context.js';
import type { TrackerPhysicalAxis } from '../dom/physicalAxis.js';

/** Stable machine-readable reasons for a rejected or suspended element profile. */
type TrackerElementProfileReason =
  | 'quirks-document'
  | 'disconnected-root'
  | 'no-principal-box'
  | 'zero-viewport-extent'
  | 'unsupported-display'
  | 'native-non-container'
  | 'unsupported-overflow'
  | 'scroll-snap-active'
  | 'reverse-flex-origin'
  | 'wrap-reverse-origin'
  | 'unavailable-computed-style';

/** Element scroll-profile validation result. */
type TrackerElementProfileResult = { ok: true } | { ok: false; reason: TrackerElementProfileReason };

/** Exact guaranteed ordinary container display categories (Section 5.4). */
const ALLOWED_DISPLAY_VALUES: ReadonlySet<string> = Object.freeze(
  new Set(['block', 'flow-root', 'flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block']),
);

/** Fixed bounded native non-container denylist (Section 5.4). */
const NATIVE_NON_CONTAINER_LOCAL_NAMES: ReadonlySet<string> = Object.freeze(
  new Set([
    'img',
    'video',
    'audio',
    'canvas',
    'iframe',
    'embed',
    'object',
    'input',
    'textarea',
    'select',
    'button',
    'meter',
    'progress',
  ]),
);

/** HTML namespace used by the native non-container denylist. */
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** Represented-axis overflow values supported by the guaranteed profile. */
const SUPPORTED_OVERFLOW_VALUES: ReadonlySet<string> = Object.freeze(new Set(['auto', 'scroll', 'hidden']));

/**
 * Normalizes one computed CSS keyword for exact comparison.
 *
 * @param value - Raw computed value.
 * @returns Trimmed ASCII-lowercase keyword.
 */
function normalizeKeyword(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Returns the physical axis of the inline axis for one writing mode.
 *
 * @param writingMode - Computed writing mode.
 * @returns Physical inline axis.
 */
function getInlinePhysicalAxis(writingMode: string): TrackerPhysicalAxis {
  return normalizeKeyword(writingMode).startsWith('vertical') || normalizeKeyword(writingMode).startsWith('sideways')
    ? 'y'
    : 'x';
}

/**
 * Detects a reverse-flex or wrap-reverse origin on the represented axis.
 *
 * Only root-level computed flex metadata is inspected; complex ancestor
 * interactions remain outside the bounded detection contract.
 *
 * @param style - Computed root style.
 * @param display - Normalized computed display.
 * @param axis - Represented physical axis.
 * @returns Rejection reason or null.
 */
function detectReverseFlexOrigin(
  style: CSSStyleDeclaration,
  display: string,
  axis: TrackerPhysicalAxis,
): TrackerElementProfileReason | null {
  if (display !== 'flex' && display !== 'inline-flex') {
    return null;
  }

  const flexDirection = normalizeKeyword(style.flexDirection);
  const inlineAxis = getInlinePhysicalAxis(style.writingMode);
  const blockAxis: TrackerPhysicalAxis = inlineAxis === 'x' ? 'y' : 'x';
  const mainAxis = flexDirection.startsWith('column') ? blockAxis : inlineAxis;

  if (flexDirection === 'row-reverse' && inlineAxis === axis) {
    return 'reverse-flex-origin';
  }

  if (flexDirection === 'column-reverse' && blockAxis === axis) {
    return 'reverse-flex-origin';
  }

  const flexWrap = normalizeKeyword(style.flexWrap);
  const crossAxis: TrackerPhysicalAxis = mainAxis === 'x' ? 'y' : 'x';

  if (flexWrap === 'wrap-reverse' && crossAxis === axis) {
    return 'wrap-reverse-origin';
  }

  return null;
}

/**
 * Validates the guaranteed element scroll-root CSS profile for one axis.
 *
 * The checks implement the bounded Section 5.4/10.6 contract only: no general
 * CSS parser, no ancestor-wide scan, and no mutating scrollability probe.
 * Configurations that pass but do not behave as ordinary scroll containers
 * remain documented integrator responsibility.
 *
 * @param root - Authoritative element scroll root candidate.
 * @param axis - Represented physical axis.
 * @returns Ok, or the first detected rejection reason.
 */
function validateElementScrollProfile(root: HTMLElement, axis: TrackerPhysicalAxis): TrackerElementProfileResult {
  const ownerDocument = getOwnerDocument(root);
  const ownerWindow = getOwnerWindow(root);

  if (ownerDocument === null || ownerDocument.compatMode !== 'CSS1Compat') {
    return { ok: false, reason: 'quirks-document' };
  }

  if (!root.isConnected) {
    return { ok: false, reason: 'disconnected-root' };
  }

  if (root.namespaceURI === HTML_NAMESPACE && NATIVE_NON_CONTAINER_LOCAL_NAMES.has(root.localName)) {
    return { ok: false, reason: 'native-non-container' };
  }

  if (ownerWindow === null || typeof ownerWindow.getComputedStyle !== 'function') {
    return { ok: false, reason: 'unavailable-computed-style' };
  }

  if (typeof root.getClientRects !== 'function' || root.getClientRects().length === 0) {
    return { ok: false, reason: 'no-principal-box' };
  }

  const viewportExtent = axis === 'x' ? root.clientWidth : root.clientHeight;

  if (!Number.isFinite(viewportExtent) || viewportExtent <= 0) {
    return { ok: false, reason: 'zero-viewport-extent' };
  }

  const style = ownerWindow.getComputedStyle(root);
  const display = normalizeKeyword(style.display);

  if (!ALLOWED_DISPLAY_VALUES.has(display)) {
    return { ok: false, reason: 'unsupported-display' };
  }

  const overflow = normalizeKeyword(axis === 'x' ? style.overflowX : style.overflowY);

  if (!SUPPORTED_OVERFLOW_VALUES.has(overflow)) {
    return { ok: false, reason: 'unsupported-overflow' };
  }

  const scrollSnapType = normalizeKeyword(style.getPropertyValue('scroll-snap-type'));

  if (scrollSnapType !== '' && scrollSnapType !== 'none') {
    return { ok: false, reason: 'scroll-snap-active' };
  }

  const reverseFlexReason = detectReverseFlexOrigin(style, display, axis);

  if (reverseFlexReason !== null) {
    return { ok: false, reason: reverseFlexReason };
  }

  return { ok: true };
}

export { validateElementScrollProfile };
export type { TrackerElementProfileReason, TrackerElementProfileResult };
