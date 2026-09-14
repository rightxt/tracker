import { getInternalDomRegistry } from './internalDomRegistry.js';
import { createIsolatedProbeStyle } from './probeIsolation.js';
import type { TrackerPhysicalAxis } from './physicalAxis.js';

/** Absolute CSS pixel length, e.g. "12px" or "-4.5px". */
const PIXEL_LENGTH_PATTERN = /^-?\d+(?:\.\d+)?px$/u;

/** Length expression resolvable only through a layout measurement. */
const MEASURABLE_EXPRESSION_PATTERN = /%|^(?:calc|min|max|clamp)\(/u;

/**
 * Measures one length-percentage expression against a known physical box size.
 *
 * A hidden realm-local probe pair resolves the expression through actual
 * layout: the container gets the reference size on the requested axis and the
 * child gets the expression as its extent. The probe is registered as internal
 * DOM before insertion, removed in `finally`, and retired through the pending
 * mutation-delivery window. The application scroll root is never mutated.
 *
 * @param value - Computed length-percentage expression.
 * @param axis - Physical axis supplying the percentage basis.
 * @param referenceSize - Physical reference box size in CSS pixels.
 * @param document - Realm document used for the probe.
 * @returns Resolved CSS pixel value, or null when measurement is unavailable.
 */
function measureLengthWithProbe(
  value: string,
  axis: TrackerPhysicalAxis,
  referenceSize: number,
  document: Document,
): number | null {
  const parent = document.body ?? document.documentElement;

  if (!parent || typeof document.createElement !== 'function') {
    return null;
  }

  const container = document.createElement('div');
  const child = document.createElement('div');
  const registry = getInternalDomRegistry(document);
  const extentProperty = axis === 'x' ? 'width' : 'height';

  container.setAttribute('data-rxtt-internal-probe', 'length');
  container.style.cssText = createIsolatedProbeStyle({
    'box-sizing': 'content-box',
    display: 'block',
    left: '-10000px',
    margin: '0',
    'max-height': 'none',
    'max-width': 'none',
    'min-height': '0',
    'min-width': '0',
    padding: '0',
    'pointer-events': 'none',
    position: 'absolute',
    top: '-10000px',
    transform: 'none',
    visibility: 'hidden',
    [extentProperty]: `${Math.max(0, referenceSize)}px`,
  });
  child.style.cssText = createIsolatedProbeStyle({
    'box-sizing': 'content-box',
    display: 'block',
    'max-height': 'none',
    'max-width': 'none',
    'min-height': '0',
    'min-width': '0',
  });
  // Applied after the reset, with the same `!important` priority, so it wins
  // even against a hostile `div { width: 999px !important }` author rule.
  child.style.setProperty(extentProperty, value, 'important');
  container.appendChild(child);
  registry.register(container, 'probe');

  try {
    parent.appendChild(container);

    const rect = child.getBoundingClientRect();
    const measured = axis === 'x' ? rect.width : rect.height;

    return Number.isFinite(measured) ? measured : null;
  } catch {
    return null;
  } finally {
    container.remove();
    registry.retire(container);
  }
}

/**
 * Resolves one computed scroll-padding value to CSS pixels.
 *
 * Library semantics: `auto` and an empty computed
 * value resolve to `0`; absolute pixel lengths parse directly; percentages and
 * measurable `calc()`/`min()`/`max()`/`clamp()` expressions resolve against
 * the physical reference size through a realm-local probe. Any other value is
 * unresolvable and returns null so the caller can diagnose the documented
 * `0 CSS px` fallback.
 *
 * @param value - Computed scroll-padding value.
 * @param axis - Physical axis supplying the percentage basis.
 * @param referenceSize - Physical scrollport size in CSS pixels.
 * @param document - Realm document used for probe measurement.
 * @returns Resolved CSS pixel value, or null when unresolvable.
 */
function resolveScrollPaddingLength(
  value: string | undefined | null,
  axis: TrackerPhysicalAxis,
  referenceSize: number,
  document: Document,
): number | null {
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (normalized === '' || normalized.toLowerCase() === 'auto') {
    return 0;
  }

  if (PIXEL_LENGTH_PATTERN.test(normalized)) {
    const parsed = Number.parseFloat(normalized);

    return Number.isFinite(parsed) ? parsed : null;
  }

  if (MEASURABLE_EXPRESSION_PATTERN.test(normalized)) {
    return measureLengthWithProbe(normalized, axis, referenceSize, document);
  }

  return null;
}

export { resolveScrollPaddingLength };
