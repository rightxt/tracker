import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { settleFrames } from './support/settle-frames.js';

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
 * Dispatches a complete primary-pointer activation sequence.
 *
 * @param {Element} target - Pointer event target.
 * @param {PointerEventInit} init - Additional pointer coordinates.
 */
function dispatchPrimaryPointerSequence(target, init = {}) {
  dispatchPointer(target, 'pointerdown', init);
  dispatchPointer(target, 'pointerup', init);
  target.dispatchEvent(new MouseEvent('click', { ...init, bubbles: true, button: 0, cancelable: true }));
}

/**
 * Creates a positioned host with a vertical element scroller.
 *
 * The scroller content is 1040 CSS px tall with three `.element-mode-target`
 * elements: one at the exact content start, one in the middle, and one ending
 * at the exact content end.
 *
 * @param {string} scrollerStyle - Extra inline styles for the scroller.
 * @returns {{ host: HTMLElement, scroller: HTMLElement }} Fixture roots.
 */
function createVerticalContainerFixture(scrollerStyle = '') {
  const wrapper = appendFixture(`
    <div id="p6-host" style="position: relative; height: 200px; width: 400px;">
      <div id="p6-scroller" style="height: 200px; overflow-y: auto; ${scrollerStyle}">
        <div class="element-mode-target" style="height: 40px;"></div>
        <div style="height: 400px;"></div>
        <div class="element-mode-target" style="height: 40px;"></div>
        <div style="height: 480px;"></div>
        <div class="element-mode-target" style="height: 80px;"></div>
      </div>
    </div>
  `);
  const host = wrapper.querySelector('#p6-host');
  const scroller = wrapper.querySelector('#p6-scroller');

  if (!(host instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
    throw new Error('Expected a complete vertical container fixture.');
  }

  return { host, scroller };
}

beforeEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

afterEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

describe('element scroll mode', () => {
  it('positions markers proportionally to real container content within 1px', () => {
    const { host, scroller } = createVerticalContainerFixture();
    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.element-mode-target' }],
    });

    tracker.mount({ scrollRoot: scroller, renderHost: host });

    const root = host.querySelector('.rxtt');

    if (!(root instanceof HTMLElement)) {
      throw new Error('Expected a mounted element-mode root.');
    }

    expect(root.getAttribute('data-rxtt-scroll-mode')).toBe('element');
    expect(root.getAttribute('data-rxtt-geometry')).toBe('available');
    expect(window.getComputedStyle(root).position).toBe('absolute');

    const targets = Array.from(scroller.querySelectorAll('.element-mode-target'));
    const markers = Array.from(host.querySelectorAll('.rxtt__marker'));

    expect(markers).toHaveLength(3);

    const trackRect = root.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const contentSize = scroller.scrollHeight;

    targets.forEach((target, index) => {
      const targetRect = target.getBoundingClientRect();
      const targetStart = targetRect.top - scrollerRect.top - scroller.clientTop + scroller.scrollTop;
      const expectedStart = (targetStart / contentSize) * trackRect.height;
      const expectedSize = (targetRect.height / contentSize) * trackRect.height;
      const markerRect = markers[index].getBoundingClientRect();

      expect(Math.abs(markerRect.top - trackRect.top - expectedStart)).toBeLessThanOrEqual(1);
      expect(Math.abs(markerRect.height - expectedSize)).toBeLessThanOrEqual(1);
    });

    const firstMarkerRect = markers[0].getBoundingClientRect();
    const lastMarkerRect = markers[2].getBoundingClientRect();

    expect(firstMarkerRect.top).toBeGreaterThanOrEqual(trackRect.top - 1);
    expect(lastMarkerRect.bottom).toBeLessThanOrEqual(trackRect.bottom + 1);

    tracker.destroy();
  });

  it('positions RTL horizontal markers and the viewport indicator physically', () => {
    const wrapper = appendFixture(`
      <div id="p6-host" style="position: relative; height: 160px; width: 300px;">
        <div
          id="p6-scroller"
          dir="rtl"
          style="height: 120px; width: 300px; overflow-x: auto; font-size: 0; white-space: nowrap;"
        >
          <div style="display: inline-block; width: 380px; height: 50px;"></div>
          <div class="element-mode-target" style="display: inline-block; width: 40px; height: 50px;"></div>
          <div style="display: inline-block; width: 580px; height: 50px;"></div>
        </div>
      </div>
    `);
    const host = wrapper.querySelector('#p6-host');
    const scroller = wrapper.querySelector('#p6-scroller');
    const target = wrapper.querySelector('.element-mode-target');

    if (!(host instanceof HTMLElement) || !(scroller instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error('Expected a complete RTL fixture.');
    }

    const tracker = new Tracker({
      options: {
        orientation: 'horizontal',
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.element-mode-target' }],
    });

    tracker.mount({ scrollRoot: scroller, renderHost: host });

    const root = host.querySelector('.rxtt');
    const marker = host.querySelector('.rxtt__marker');
    const viewport = host.querySelector('.rxtt__viewport');

    if (!(root instanceof HTMLElement) || !(marker instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      throw new Error('Expected mounted RTL tracker output.');
    }

    const trackRect = root.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const contentWidth = scroller.scrollWidth;
    // The fresh RTL scroller rests at its inline-start (physical right) edge,
    // so the physical scroll offset equals the maximum offset.
    const physicalScrollOffset = scroller.scrollWidth - scroller.clientWidth;
    const targetRect = target.getBoundingClientRect();
    const targetStart = targetRect.left - scrollerRect.left - scroller.clientLeft + physicalScrollOffset;
    const expectedMarkerLeft = (targetStart / contentWidth) * trackRect.width;
    const markerRect = marker.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();

    expect(physicalScrollOffset).toBeGreaterThan(0);
    expect(Math.abs(markerRect.left - trackRect.left - expectedMarkerLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(markerRect.width - (targetRect.width / contentWidth) * trackRect.width)).toBeLessThanOrEqual(1);
    // Normalized physical metrics place the viewport indicator at the track's
    // physical end; a raw RTL scrollLeft of 0 would wrongly place it at the start.
    expect(Math.abs(viewportRect.right - trackRect.right)).toBeLessThanOrEqual(1);
    expect(viewportRect.left - trackRect.left).toBeGreaterThan(trackRect.width / 2);

    tracker.destroy();
  });

  it('drags instantly to both physical edges under CSS smooth scrolling', () => {
    const { host, scroller } = createVerticalContainerFixture('scroll-behavior: smooth;');
    const tracker = new Tracker({
      options: {
        interaction: { drag: true },
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
    });

    tracker.mount({ scrollRoot: scroller, renderHost: host });

    const root = host.querySelector('.rxtt');

    if (!(root instanceof HTMLElement)) {
      throw new Error('Expected a mounted drag root.');
    }

    const rect = root.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const maxOffset = scroller.scrollHeight - scroller.clientHeight;

    expect(maxOffset).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBe(0);

    dispatchPointer(root, 'pointerdown', { clientX: x, clientY: rect.top + 2 });
    dispatchPointer(root, 'pointermove', { clientX: x, clientY: rect.bottom });
    // Internal drag uses `instant` execution: the offset must be applied
    // synchronously despite the container's CSS smooth scrolling.
    expect(Math.abs(scroller.scrollTop - maxOffset)).toBeLessThanOrEqual(1);
    dispatchPointer(root, 'pointerup', { clientX: x, clientY: rect.bottom });

    dispatchPointer(root, 'pointerdown', { clientX: x, clientY: rect.bottom - 2 });
    dispatchPointer(root, 'pointermove', { clientX: x, clientY: rect.top });
    expect(scroller.scrollTop).toBeLessThanOrEqual(1);
    dispatchPointer(root, 'pointerup', { clientX: x, clientY: rect.top });

    tracker.destroy();
  });

  it('rejects unsupported scroll roots at mount without leaving renderer output', () => {
    const wrapper = appendFixture(`
      <div id="p6-host" style="position: relative; height: 200px; width: 400px;">
        <div id="p6-snap" style="height: 200px; overflow-y: auto; scroll-snap-type: y mandatory;">
          <div style="height: 400px;"></div>
        </div>
        <div id="p6-reverse" style="height: 200px; display: flex; flex-direction: column-reverse; overflow-y: auto;">
          <div style="height: 400px;"></div>
        </div>
      </div>
    `);
    const host = wrapper.querySelector('#p6-host');
    const snapScroller = wrapper.querySelector('#p6-snap');
    const reverseScroller = wrapper.querySelector('#p6-reverse');

    if (
      !(host instanceof HTMLElement) ||
      !(snapScroller instanceof HTMLElement) ||
      !(reverseScroller instanceof HTMLElement)
    ) {
      throw new Error('Expected a complete profile-rejection fixture.');
    }

    const tracker = new Tracker({
      options: {
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
    });
    const unsupportedRootError = expect.objectContaining({
      code: 'ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT',
      name: 'TrackerConfigurationError',
    });

    expect(() => tracker.mount({ scrollRoot: snapScroller, renderHost: host })).toThrow(unsupportedRootError);
    expect(tracker.mounted).toBe(false);
    expect(host.querySelector('.rxtt')).toBeNull();

    expect(() => tracker.mount({ scrollRoot: reverseScroller, renderHost: host })).toThrow(unsupportedRootError);
    expect(tracker.mounted).toBe(false);
    expect(host.querySelector('.rxtt')).toBeNull();

    tracker.destroy();
  });

  it('suspends geometry on a live profile violation and recovers after restoration', () => {
    const { host, scroller } = createVerticalContainerFixture();
    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.element-mode-target' }],
    });

    tracker.mount({ scrollRoot: scroller, renderHost: host });

    const root = host.querySelector('.rxtt');
    const markersLayer = host.querySelector('.rxtt__markers');

    if (!(root instanceof HTMLElement) || !(markersLayer instanceof HTMLElement)) {
      throw new Error('Expected a mounted geometry-suspension root.');
    }

    expect(host.querySelectorAll('.rxtt__marker')).toHaveLength(3);

    scroller.style.overflowY = 'visible';
    tracker.render();

    expect(root.getAttribute('data-rxtt-geometry')).toBe('suspended');
    expect(root.getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelectorAll('.rxtt__marker')).toHaveLength(0);
    expect(window.getComputedStyle(markersLayer).display).toBe('none');
    expect(tracker.getSnapshot().geometryAvailable).toBe(false);
    expect(tracker.getStats().warnings.byCode.WARN_TRACKER_GEOMETRY_SUSPENDED).toBe(1);

    scroller.style.overflowY = 'auto';
    tracker.render();

    expect(root.getAttribute('data-rxtt-geometry')).toBe('available');
    expect(root.hasAttribute('aria-disabled')).toBe(false);
    expect(host.querySelectorAll('.rxtt__marker')).toHaveLength(3);
    expect(window.getComputedStyle(markersLayer).display).not.toBe('none');
    expect(tracker.getSnapshot().geometryAvailable).toBe(true);
    expect(tracker.getStats().warnings.byCode.WARN_TRACKER_GEOMETRY_SUSPENDED).toBe(1);

    tracker.destroy();
  });

  it('confines activation to the authoritative root and focuses without any scroll jump', async () => {
    const wrapper = appendFixture(`
      <div style="height: 2000px;">
        <div id="p6-host" style="position: relative; height: 200px; width: 400px;">
          <div id="p6-scroller" style="height: 200px; overflow-y: auto;">
            <div style="height: 240px;"></div>
            <div class="outside-scroll-target" style="height: 40px;"></div>
            <div style="height: 320px;"></div>
            <div class="focus-target" tabindex="-1" style="height: 40px;"></div>
            <div style="height: 360px;"></div>
          </div>
        </div>
      </div>
      <div id="outside-scroll-destination" style="height: 40px;"></div>
    `);
    const host = wrapper.querySelector('#p6-host');
    const scroller = wrapper.querySelector('#p6-scroller');
    const focusTarget = wrapper.querySelector('.focus-target');

    if (!(host instanceof HTMLElement) || !(scroller instanceof HTMLElement) || !(focusTarget instanceof HTMLElement)) {
      throw new Error('Expected a complete containment fixture.');
    }

    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [
        { selector: '.outside-scroll-target', scroll: { target: '#outside-scroll-destination' } },
        { selector: '.focus-target', scroll: { enabled: false }, focus: { enabled: true } },
      ],
    });

    tracker.mount({ scrollRoot: scroller, renderHost: host });

    const markersBySelector = new Map(
      Array.from(host.querySelectorAll('.rxtt__marker'), (markerElement) => {
        const key = markerElement.getAttribute('data-rxtt-key');
        const item = tracker.getSnapshot().items.find((candidate) => candidate.key === key);

        return [item?.selector, markerElement];
      }),
    );
    const scrollOutMarker = markersBySelector.get('.outside-scroll-target');
    const focusMarker = markersBySelector.get('.focus-target');

    if (!(scrollOutMarker instanceof HTMLElement) || !(focusMarker instanceof HTMLElement)) {
      throw new Error('Expected both containment markers.');
    }

    expect(scroller.scrollTop).toBe(0);
    expect(window.scrollY).toBe(0);

    dispatchPrimaryPointerSequence(scrollOutMarker);
    await settleFrames(window, 2);

    expect(tracker.getStats().warnings.byCode.WARN_TRACKER_SCROLL_TARGET_OUTSIDE_ROOT).toBe(1);
    expect(scroller.scrollTop).toBe(0);
    expect(window.scrollY).toBe(0);

    dispatchPrimaryPointerSequence(focusMarker, { pointerId: 22 });
    await settleFrames(window, 2);

    expect(document.activeElement).toBe(focusTarget);
    // preventScroll focus must not reveal the target inside the authoritative
    // root and must not move the outer window.
    expect(scroller.scrollTop).toBe(0);
    expect(window.scrollY).toBe(0);

    tracker.destroy();
  });
});
