import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import {
  clearNativeAxisBehaviorCache,
  getElementMaxOffset,
  readElementNativeOffset,
  resolveAxisOffsetConverter,
} from '../../packages/core/src/dom/physicalAxis.ts';
import '../../packages/core/src/styles/rxt-tracker.css';

/**
 * Representative vertical writing-mode/direction pairings.
 *
 * `vertical-rl`+`rtl` reverses both the block axis (inherent to `vertical-rl`)
 * and the inline axis (`direction: rtl` under a vertical writing mode reverses
 * the inline axis instead of the horizontal axis it reverses under
 * `horizontal-tb`), so a fresh scroller rests at the physical maximum on both
 * axes. `vertical-lr`+`ltr` reverses neither axis, so a fresh scroller rests
 * at the physical minimum on both axes. Together the two cases exercise every
 * combination of axis-reversal polarity a vertical writing mode can produce.
 */
const WRITING_MODE_CASES = [
  { writingMode: 'vertical-rl', direction: 'rtl', label: 'vertical-rl/rtl' },
  { writingMode: 'vertical-lr', direction: 'ltr', label: 'vertical-lr/ltr' },
];

/** Both Tracker orientations, independent of container writing mode. */
const TRACKER_ORIENTATIONS = ['vertical', 'horizontal'];

/**
 * Appends a fixture subtree built from trusted inline markup.
 *
 * @param {string} markup - Trusted fixture markup.
 * @returns {HTMLElement} Connected fixture wrapper.
 */
function appendFixture(markup) {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = markup;
  document.body.appendChild(wrapper);

  return wrapper;
}

/**
 * Dispatches one primary-pointer event.
 *
 * @param {Element} target - Pointer event target.
 * @param {string} type - Pointer event type.
 * @param {PointerEventInit} init - Additional pointer coordinates and state.
 */
function dispatchPointer(target, type, init = {}) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      cancelable: true,
      isPrimary: true,
      pointerId: 21,
      ...init,
    }),
  );
}

/**
 * Creates a positioned host with a vertical-writing-mode element scroller.
 *
 * Three `.writing-mode-target` boxes use explicit physical `width`/`height` so
 * a writing-mode/direction change reflows their stacking without changing the
 * scroller's own physical content or viewport extents on either axis.
 * `vertical-rl`/`vertical-lr` stack block-level children along the physical
 * horizontal axis, so the three boxes naturally overflow horizontally; each
 * box's own fixed height overflows the scroller vertically as well, giving
 * both Tracker orientations real content to measure from one fixture.
 *
 * @param {string} writingMode - CSS `writing-mode` value.
 * @param {string} direction - CSS `direction` value.
 * @returns {{ host: HTMLElement, scroller: HTMLElement }} Fixture roots.
 */
function createWritingModeContainerFixture(writingMode, direction) {
  const wrapper = appendFixture(`
    <div class="p7wm-host" style="position: relative; height: 220px; width: 260px;">
      <div
        class="p7wm-scroller"
        style="height: 180px; width: 220px; overflow: auto; writing-mode: ${writingMode}; direction: ${direction};"
      >
        <div class="writing-mode-target" style="width: 120px; height: 260px;"></div>
        <div class="writing-mode-target" style="width: 80px; height: 300px;"></div>
        <div class="writing-mode-target" style="width: 160px; height: 220px;"></div>
      </div>
    </div>
  `);
  const host = wrapper.querySelector('.p7wm-host');
  const scroller = wrapper.querySelector('.p7wm-scroller');

  if (!(host instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
    throw new Error('Expected a complete writing-mode container fixture.');
  }

  return { host, scroller };
}

/**
 * Reads the current physical scroll geometry for one axis of an element root,
 * mirroring the conversion `ElementScrollContext` performs internally.
 *
 * @param {HTMLElement} scroller - Authoritative element scroll root.
 * @param {'x' | 'y'} axis - Physical axis represented by the Tracker orientation.
 * @returns {{ maxOffset: number, contentSize: number, scrollOffset: number }} Physical axis geometry.
 */
function readAxisGeometry(scroller, axis) {
  const viewportSize = axis === 'x' ? scroller.clientWidth : scroller.clientHeight;
  const contentSize = Math.max(viewportSize, axis === 'x' ? scroller.scrollWidth : scroller.scrollHeight);
  const maxOffset = Math.max(0, contentSize - viewportSize);
  const converter = resolveAxisOffsetConverter(scroller, axis, maxOffset);
  const scrollOffset = converter.toPhysicalOffset(readElementNativeOffset(scroller, axis), maxOffset);

  return { maxOffset, contentSize, scrollOffset };
}

/**
 * Computes each target's expected track-position geometry and pairs it with
 * its rendered marker in ClusterEngine's ascending track-position order
 * (ClusterEngine.ts sorts render records by track position, with rule-match
 * order breaking exact ties, regardless of clustering being enabled) — this
 * can diverge from the targets' own DOM order under a reversed inline axis
 * (e.g. `vertical-rl`+`rtl`), where a target that is later in the DOM can
 * occupy an earlier physical/track position than an earlier one.
 *
 * @param {HTMLElement} root - Mounted `.rxtt` root.
 * @param {HTMLElement} scroller - Authoritative element scroll root.
 * @param {'x' | 'y'} axis - Physical axis represented by the Tracker orientation.
 * @param {HTMLElement[]} targets - Source target elements, in DOM order.
 * @param {HTMLElement[]} markers - Rendered marker elements, in ascending track-position order.
 * @returns {{ target: HTMLElement, marker: HTMLElement, expectedMarkerStart: number, expectedMarkerSize: number }[]} Paired entries, in ascending track-position order.
 */
function pairTargetsWithMarkers(root, scroller, axis, targets, markers) {
  const { contentSize, maxOffset, scrollOffset } = readAxisGeometry(scroller, axis);

  expect(maxOffset).toBeGreaterThan(0);

  const trackRect = root.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const clientBorderStart = axis === 'x' ? scroller.clientLeft : scroller.clientTop;
  const rootStart = axis === 'x' ? scrollerRect.left : scrollerRect.top;
  const trackSize = axis === 'x' ? trackRect.width : trackRect.height;

  const entries = targets.map((target) => {
    const targetRect = target.getBoundingClientRect();
    const rectStart = axis === 'x' ? targetRect.left : targetRect.top;
    const rectSize = axis === 'x' ? targetRect.width : targetRect.height;
    const expectedStart = rectStart - rootStart - clientBorderStart + scrollOffset;

    return {
      expectedMarkerSize: (rectSize / contentSize) * trackSize,
      expectedMarkerStart: (expectedStart / contentSize) * trackSize,
      expectedStart,
      target,
    };
  });

  return entries
    .slice()
    .sort((left, right) => left.expectedStart - right.expectedStart)
    .map((entry, index) => ({ ...entry, marker: markers[index] }));
}

/**
 * Asserts that every target's rendered marker matches its physical position
 * and size within the container's content, independent of writing-mode or
 * direction polarity (Section 23.5: rect/offset error tolerance of 1 CSS px).
 *
 * @param {HTMLElement} root - Mounted `.rxtt` root.
 * @param {HTMLElement} scroller - Authoritative element scroll root.
 * @param {'x' | 'y'} axis - Physical axis represented by the Tracker orientation.
 * @param {HTMLElement[]} targets - Source target elements, in DOM order.
 * @param {HTMLElement[]} markers - Rendered marker elements, in ascending track-position order.
 */
function assertMarkerGeometry(root, scroller, axis, targets, markers) {
  const trackRect = root.getBoundingClientRect();
  const trackStart = axis === 'x' ? trackRect.left : trackRect.top;

  pairTargetsWithMarkers(root, scroller, axis, targets, markers).forEach(
    ({ expectedMarkerStart, expectedMarkerSize, marker }) => {
      const markerRect = marker.getBoundingClientRect();
      const markerStart = axis === 'x' ? markerRect.left : markerRect.top;
      const markerSize = axis === 'x' ? markerRect.width : markerRect.height;

      expect(Math.abs(markerStart - trackStart - expectedMarkerStart)).toBeLessThanOrEqual(1);
      expect(Math.abs(markerSize - expectedMarkerSize)).toBeLessThanOrEqual(1);
    },
  );
}

/**
 * Drags the track from one physical point toward another and returns the
 * native scroll offset reached, sampled right after the pointer arrives (drag
 * execution is instant, matching the current drag contract).
 *
 * @param {HTMLElement} root - Mounted `.rxtt` root.
 * @param {HTMLElement} scroller - Authoritative element scroll root.
 * @param {'x' | 'y'} axis - Physical axis represented by the Tracker orientation.
 * @param {number} fromPoint - Starting client coordinate along the axis.
 * @param {number} toPoint - Destination client coordinate along the axis.
 * @param {number} crossPoint - Fixed client coordinate along the cross axis.
 * @returns {number} Native offset reached after the drag.
 */
function dragAlongTrack(root, scroller, axis, fromPoint, toPoint, crossPoint) {
  const downInit =
    axis === 'x' ? { clientX: fromPoint, clientY: crossPoint } : { clientX: crossPoint, clientY: fromPoint };
  const moveInit = axis === 'x' ? { clientX: toPoint, clientY: crossPoint } : { clientX: crossPoint, clientY: toPoint };

  dispatchPointer(root, 'pointerdown', downInit);
  dispatchPointer(root, 'pointermove', moveInit);

  const reached = readElementNativeOffset(scroller, axis);

  dispatchPointer(root, 'pointerup', moveInit);

  return reached;
}

beforeEach(() => {
  document.body.replaceChildren();
  clearNativeAxisBehaviorCache(document);
  window.scrollTo(0, 0);
});

afterEach(() => {
  document.body.replaceChildren();
  clearNativeAxisBehaviorCache(document);
  window.scrollTo(0, 0);
});

describe('writing modes', () => {
  // One runtime case per exact writing-mode/direction x orientation
  // combination. Each case mounts once and exercises both platform contracts
  // on the same Tracker and root: marker geometry first (before any drag
  // mutates the scroll offset), then reaching both physical drag edges.
  for (const { writingMode, direction, label } of WRITING_MODE_CASES) {
    for (const orientation of TRACKER_ORIENTATIONS) {
      it(`positions markers and reaches both physical drag edges for a ${label} ${orientation} Tracker`, () => {
        const { host, scroller } = createWritingModeContainerFixture(writingMode, direction);
        const tracker = new Tracker({
          options: {
            orientation,
            interaction: { drag: true },
            clustering: { enabled: false },
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          rules: [{ selector: '.writing-mode-target' }],
        });

        tracker.mount({ scrollRoot: scroller, renderHost: host });

        const root = host.querySelector('.rxtt');

        if (!(root instanceof HTMLElement)) {
          throw new Error('Expected a mounted writing-mode root.');
        }

        const axis = orientation === 'horizontal' ? 'x' : 'y';

        // Geometry phase - asserted before any drag mutates the scroll offset.
        expect(root.getAttribute('data-rxtt-scroll-mode')).toBe('element');
        expect(root.getAttribute('data-rxtt-geometry')).toBe('available');
        expect(root.getAttribute('data-rxtt-orientation')).toBe(orientation);

        const targets = Array.from(scroller.querySelectorAll('.writing-mode-target'));
        const markers = Array.from(host.querySelectorAll('.rxtt__marker'));

        expect(markers).toHaveLength(targets.length);
        assertMarkerGeometry(root, scroller, axis, targets, markers);

        // Drag phase - same Tracker and root; reach both physical edges.
        const maxOffset = getElementMaxOffset(scroller, axis);

        expect(maxOffset).toBeGreaterThan(0);

        // The true achievable native endpoints for this specific
        // writing-mode/direction/engine combination — not necessarily literal
        // 0 and max; see physicalAxis.ts for why native polarity varies.
        const { model } = resolveAxisOffsetConverter(scroller, axis, maxOffset);
        const rect = root.getBoundingClientRect();
        const crossPoint = axis === 'x' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        const nearStart = axis === 'x' ? rect.left + 2 : rect.top + 2;
        const farStart = axis === 'x' ? rect.right : rect.bottom;
        const nearEnd = axis === 'x' ? rect.right - 2 : rect.bottom - 2;
        const farEnd = axis === 'x' ? rect.left : rect.top;

        const nativeAtEnd = dragAlongTrack(root, scroller, axis, nearStart, farStart, crossPoint);

        expect(Math.abs(nativeAtEnd - model.nativeEnd)).toBeLessThanOrEqual(1);

        const nativeAtStart = dragAlongTrack(root, scroller, axis, nearEnd, farEnd, crossPoint);

        expect(Math.abs(nativeAtStart - model.nativeStart)).toBeLessThanOrEqual(1);

        tracker.destroy();
      });
    }
  }

  it('recalculates element geometry after an explicit render() following a writing-mode/direction change', () => {
    const { host, scroller } = createWritingModeContainerFixture('vertical-lr', 'ltr');
    const tracker = new Tracker({
      options: {
        orientation: 'vertical',
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.writing-mode-target' }],
    });

    tracker.mount({ scrollRoot: scroller, renderHost: host });

    const root = host.querySelector('.rxtt');

    if (!(root instanceof HTMLElement)) {
      throw new Error('Expected a mounted writing-mode invalidation root.');
    }

    const targets = Array.from(scroller.querySelectorAll('.writing-mode-target'));
    const initialMarkers = Array.from(host.querySelectorAll('.rxtt__marker'));

    expect(initialMarkers).toHaveLength(targets.length);
    assertMarkerGeometry(root, scroller, 'y', targets, initialMarkers);

    // Tracks one specific target's marker across the switch rather than a
    // fixed array index: ClusterEngine re-sorts render records by track
    // position on every render, so the target occupying markers[0] can
    // differ before and after a writing-mode/direction change.
    const trackedTarget = targets[0];
    const beforeMarker = pairTargetsWithMarkers(root, scroller, 'y', targets, initialMarkers).find(
      (entry) => entry.target === trackedTarget,
    ).marker;
    const beforeMarkerTop = beforeMarker.getBoundingClientRect().top;

    // Switches to the fully reversed combination without ever touching
    // scrollTop, so the still-persisted native offset is reinterpreted
    // through the new writing-mode/direction only once render() runs.
    scroller.style.writingMode = 'vertical-rl';
    scroller.style.direction = 'rtl';
    tracker.render();

    expect(root.getAttribute('data-rxtt-geometry')).toBe('available');

    const updatedMarkers = Array.from(host.querySelectorAll('.rxtt__marker'));

    expect(updatedMarkers).toHaveLength(targets.length);
    assertMarkerGeometry(root, scroller, 'y', targets, updatedMarkers);

    const afterMarker = pairTargetsWithMarkers(root, scroller, 'y', targets, updatedMarkers).find(
      (entry) => entry.target === trackedTarget,
    ).marker;
    const afterMarkerTop = afterMarker.getBoundingClientRect().top;

    // A stale (non-recalculated) geometry would leave the tracked target's
    // marker close to its pre-switch position; the reversed axis
    // interpretation must move it.
    expect(Math.abs(afterMarkerTop - beforeMarkerTop)).toBeGreaterThan(1);

    tracker.destroy();
  });
});
