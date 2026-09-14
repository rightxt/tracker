import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearNativeAxisBehaviorCache,
  getElementMaxOffset,
  readElementNativeOffset,
  resolveAxisOffsetConverter,
  writeElementNativeOffset,
} from '../../packages/core/src/dom/physicalAxis.ts';
import { resolveScrollPaddingLength } from '../../packages/core/src/dom/cssLength.ts';

/**
 * Injects an author stylesheet aggressive enough to corrupt an unisolated
 * probe while still leaving a real page renderable — the way an actual
 * hostile design-system reset would. A blanket `* { display: none }` was
 * deliberately avoided: it would also hide `<html>`/`<body>`, collapsing the
 * entire render tree (nothing under a `display: none` ancestor can be
 * resurrected by a descendant's own styling), which is not a scenario any
 * live page exhibits.
 *
 * `* { box-sizing / min-width / min-height }` mirrors a common site-wide
 * reset. The bare `div` rule turns every unclassed `div` — exactly what the
 * library's internal probe elements are — into a flex container with a
 * forced size, which is the kind of tag-only reset a component-library base
 * layer might ship.
 *
 * @returns {HTMLStyleElement} The injected style element, removable by the caller.
 */
function installHostileStylesheet() {
  const style = document.createElement('style');

  style.textContent = `
    * {
      box-sizing: border-box !important;
      min-width: 200px !important;
      min-height: 200px !important;
    }
    div {
      display: flex !important;
      flex-direction: column !important;
      width: 999px !important;
      height: 999px !important;
    }
  `;
  document.head.appendChild(style);

  return style;
}

/**
 * Creates an oversized `vertical-rl`/`rtl` element scroll fixture for the
 * physical Y axis — the writing-mode/direction/axis combination most likely
 * to expose an isolation gap, since the internal axis-behavior probe it
 * triggers must itself resolve `writing-mode: vertical-rl` and `direction:
 * rtl` independently of the hostile sheet.
 *
 * @returns {{ content: HTMLElement, root: HTMLElement }} Scroll fixture.
 */
function createVerticalRlRtlScrollFixture() {
  const root = document.createElement('div');
  const content = document.createElement('div');

  root.style.cssText = [
    'border: 0',
    'direction: rtl',
    'overflow: scroll',
    'padding: 0',
    'position: fixed',
    'visibility: hidden',
    'writing-mode: vertical-rl',
  ].join(';');
  // The hostile sheet's `div { display: flex !important; width: 999px !important;
  // height: 999px !important }` rule also matches these fixture divs. An
  // inline `!important` declaration outranks a stylesheet `!important` rule
  // of the same origin, so the fixture's own layout survives unchanged.
  root.style.setProperty('display', 'block', 'important');
  root.style.setProperty('height', '80px', 'important');
  root.style.setProperty('width', '80px', 'important');
  content.style.cssText = 'min-height: 320px; min-width: 320px; position: relative;';
  content.style.setProperty('display', 'block', 'important');
  content.style.setProperty('height', '320px', 'important');
  content.style.setProperty('width', '320px', 'important');
  root.appendChild(content);
  document.body.appendChild(root);

  return { content, root };
}

/**
 * Returns observed physical top displacement of scrolled content.
 *
 * @param {HTMLElement} root - Scroll root.
 * @param {HTMLElement} content - Oversized content.
 * @returns {number} Observed physical offset.
 */
function readPhysicalYDisplacement(root, content) {
  const rootRect = root.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();

  return rootRect.top + root.clientTop - contentRect.top;
}

let hostileStyle;

beforeEach(() => {
  hostileStyle = installHostileStylesheet();
});

afterEach(() => {
  hostileStyle.remove();
  document.body.replaceChildren();
  clearNativeAxisBehaviorCache(document);
});

describe('internal probe isolation under hostile author CSS', () => {
  it('still measures a correct native axis-behavior model with a hostile flex/box-sizing/min-width sheet active', () => {
    clearNativeAxisBehaviorCache(document);

    const converter = resolveAxisOffsetConverter(document.documentElement, 'x', 100);

    expect(converter.model).toMatchObject({
      flowDirection: 'positive',
      nativeMinimum: 0,
      nativeMaximum: 100,
    });
  });

  it('still resolves a percentage scroll-padding length with the same hostile sheet active', () => {
    const resolved = resolveScrollPaddingLength('50%', 'x', 240, document);

    expect(resolved).not.toBeNull();
    expect(Math.abs((resolved ?? Number.NaN) - 120)).toBeLessThanOrEqual(1);
  });

  it('round-trips the vertical-rl/rtl physical Y axis with the same hostile sheet active', () => {
    clearNativeAxisBehaviorCache(document);

    const { content, root } = createVerticalRlRtlScrollFixture();
    const maxOffset = getElementMaxOffset(root, 'y');
    const converter = resolveAxisOffsetConverter(root, 'y', maxOffset);

    expect(maxOffset).toBeGreaterThan(0);

    for (const physicalOffset of [0, maxOffset / 2, maxOffset]) {
      const nativeOffset = converter.toNativeOffset(physicalOffset, maxOffset);

      writeElementNativeOffset(root, 'y', nativeOffset);

      const observedNativeOffset = readElementNativeOffset(root, 'y');
      const convertedOffset = converter.toPhysicalOffset(observedNativeOffset, maxOffset);
      const displacedOffset = readPhysicalYDisplacement(root, content);

      expect(Math.abs(convertedOffset - physicalOffset)).toBeLessThanOrEqual(1);
      expect(Math.abs(displacedOffset - physicalOffset)).toBeLessThanOrEqual(1);
    }
  });

  it('resolves a calc() scroll-padding length identically with and without the hostile sheet', () => {
    hostileStyle.remove();

    const cleanResolved = resolveScrollPaddingLength('calc(25% + 10px)', 'y', 200, document);

    hostileStyle = installHostileStylesheet();

    const hostileResolved = resolveScrollPaddingLength('calc(25% + 10px)', 'y', 200, document);

    expect(cleanResolved).not.toBeNull();
    expect(hostileResolved).not.toBeNull();
    expect(Math.abs((hostileResolved ?? Number.NaN) - (cleanResolved ?? Number.NaN))).toBeLessThanOrEqual(1);
  });
});
