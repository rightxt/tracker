import { afterEach, describe, expect, it, vi } from 'vitest';

import { WindowScrollContext } from '../../packages/core/src/scroll/WindowScrollContext.ts';
import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';

/**
 * Creates a same-origin iframe document without a doctype.
 *
 * @param {string} markup - Quirks-mode markup.
 * @returns {HTMLIFrameElement} Initialized frame.
 */
function createQuirksFrame(markup) {
  const iframe = document.createElement('iframe');

  iframe.style.width = '400px';
  iframe.style.height = '300px';
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;

  if (frameDocument === null) {
    throw new Error('Expected a writable quirks-mode frame document.');
  }

  frameDocument.open();
  frameDocument.write(markup);
  frameDocument.close();

  return iframe;
}

/**
 * Waits for two animation frames in a specific Window.
 *
 * @param {Window} runtimeWindow - Window owning the animation frames.
 * @returns {Promise<void>}
 */
async function settleScroll(runtimeWindow) {
  await new Promise((resolve) => {
    runtimeWindow.requestAnimationFrame(resolve);
  });
  await new Promise((resolve) => {
    runtimeWindow.requestAnimationFrame(resolve);
  });
}

/**
 * Dispatches a complete primary-pointer session in the target realm.
 *
 * @param {Element} target - Pointer target.
 */
function dispatchPrimaryPointerSequence(target) {
  const runtimeWindow = target.ownerDocument.defaultView;

  if (runtimeWindow === null) {
    throw new Error('Expected a Window for the pointer target.');
  }

  const shared = {
    bubbles: true,
    button: 0,
    cancelable: true,
    isPrimary: true,
    pointerId: 31,
  };

  target.dispatchEvent(new runtimeWindow.PointerEvent('pointerdown', { ...shared, buttons: 1 }));
  target.dispatchEvent(new runtimeWindow.PointerEvent('pointerup', { ...shared, buttons: 0 }));
  target.dispatchEvent(new runtimeWindow.MouseEvent('click', shared));
}

/** Removes all browser fixtures after each Window scroll-context scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('WindowScrollContext', () => {
  it('normalizes live page metrics, coordinates, and direct physical offsets', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0; min-height: 1800px; min-width: 1200px; position: relative;">
          <div id="target" style="height: 120px; left: 520px; position: absolute; top: 740px; width: 80px;"></div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    const target = frameDocument?.getElementById('target');

    if (frameWindow === null || frameDocument === null || target === null) {
      throw new Error('Expected a complete metrics frame.');
    }

    const context = new WindowScrollContext(frameWindow);

    frameWindow.scrollTo({ behavior: 'instant', left: 120, top: 220 });
    await settleScroll(frameWindow);

    const horizontal = context.getMetrics('horizontal');
    const vertical = context.getMetrics('vertical');
    const horizontalCoordinates = context.getElementCoordinates(target, 'horizontal');
    const verticalCoordinates = context.getElementCoordinates(target, 'vertical');

    expect(horizontal.contentSize).toBeGreaterThan(horizontal.viewportSize);
    expect(vertical.contentSize).toBeGreaterThan(vertical.viewportSize);
    expect(Math.abs(horizontal.scrollOffset - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(vertical.scrollOffset - 220)).toBeLessThanOrEqual(1);
    expect(Math.abs(horizontalCoordinates.start - 520)).toBeLessThanOrEqual(1);
    expect(Math.abs(verticalCoordinates.start - 740)).toBeLessThanOrEqual(1);

    context.scrollToPhysicalOffset(horizontal.maxOffset, 'horizontal', 'instant');
    context.scrollToPhysicalOffset(vertical.maxOffset, 'vertical', 'instant');
    await settleScroll(frameWindow);

    expect(Math.abs(context.getMetrics('horizontal').scrollOffset - horizontal.maxOffset)).toBeLessThanOrEqual(1);
    expect(Math.abs(context.getMetrics('vertical').scrollOffset - vertical.maxOffset)).toBeLessThanOrEqual(1);

    iframe.remove();
  });

  it('maps represented physical alignment through a live vertical RTL profile', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html style="direction: rtl; display: block; text-orientation: mixed; writing-mode: vertical-rl;">
        <body style="contain: none; container-type: normal; content-visibility: visible; display: block;">
          <div id="target"></div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const target = iframe.contentDocument?.getElementById('target');

    if (frameWindow === null || target === null) {
      throw new Error('Expected a complete alignment frame.');
    }

    const scrollIntoView = vi.fn();
    const context = new WindowScrollContext(frameWindow, { usePhysicalAlignment: true });

    target.scrollIntoView = scrollIntoView;
    context.scrollElement(target, 'horizontal', { behavior: 'auto', align: 'start' });
    context.scrollElement(target, 'vertical', { behavior: 'smooth', align: 'start' });

    expect(scrollIntoView).toHaveBeenNthCalledWith(1, {
      behavior: 'auto',
      block: 'end',
      container: 'nearest',
      inline: 'nearest',
    });
    expect(scrollIntoView).toHaveBeenNthCalledWith(2, {
      behavior: 'smooth',
      block: 'nearest',
      container: 'nearest',
      inline: 'end',
    });

    iframe.remove();
  });

  it('executes the alignment fallback and records one deduplicated warning on an unresolved profile', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="display: inline;">
          <div class="iframe-window-target">target</div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    const target = frameDocument?.querySelector('.iframe-window-target');

    if (frameWindow === null || frameDocument?.body === undefined || frameDocument.body === null || target === null) {
      throw new Error('Expected a complete alignment-fallback frame.');
    }

    const scrollIntoView = vi.fn();
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
        {
          selector: '.iframe-window-target',
          scroll: { align: 'end', behavior: 'auto', enabled: true, target: 'self' },
        },
      ],
    });

    target.scrollIntoView = scrollIntoView;
    tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

    const marker = frameDocument.querySelector('.rxtt__marker');
    const warningsBefore = tracker.getStats().warnings.total;

    if (marker === null) {
      throw new Error('Expected a marker.');
    }

    dispatchPrimaryPointerSequence(marker);
    dispatchPrimaryPointerSequence(marker);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'end',
      container: 'nearest',
      inline: 'nearest',
    });
    expect(tracker.getStats().warnings.total).toBe(warningsBefore + 1);
    expect(tracker.getStats().warnings.byCode.WARN_TRACKER_WINDOW_ALIGNMENT_FALLBACK).toBe(1);

    tracker.destroy();
    iframe.remove();
  });

  it('keeps quirks-mode and page snapping platform-controlled', async () => {
    const iframe = createQuirksFrame(`
      <html style="scroll-snap-type: y mandatory;">
        <body style="height: 1800px; margin: 0;">
          <div style="height: 300px; scroll-snap-align: start;"></div>
          <div style="height: 300px; scroll-snap-align: start;"></div>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (frameWindow === null || frameDocument === null) {
      throw new Error('Expected a complete quirks-mode frame.');
    }

    const context = new WindowScrollContext(frameWindow);

    expect(frameDocument.compatMode).toBe('BackCompat');
    expect(() => context.scrollToPhysicalOffset(275, 'vertical', 'instant')).not.toThrow();
    await settleScroll(frameWindow);

    const metrics = context.getMetrics('vertical');

    expect(Number.isFinite(metrics.scrollOffset)).toBe(true);
    expect(metrics.scrollOffset).toBeGreaterThanOrEqual(0);
    expect(metrics.scrollOffset).toBeLessThanOrEqual(metrics.maxOffset);

    iframe.remove();
  });

  it('does not reuse a captured context across iframe navigation', async () => {
    const iframe = await loadInlineFrame('<!doctype html><html><body style="height: 900px;"></body></html>');
    const frameWindow = iframe.contentWindow;

    if (frameWindow === null) {
      throw new Error('Expected an initial navigation Window.');
    }

    const context = new WindowScrollContext(frameWindow);
    const navigated = new Promise((resolve) => {
      iframe.addEventListener('load', resolve, { once: true });
    });

    iframe.srcdoc = '<!doctype html><html><body><div id="new-target"></div></body></html>';
    await navigated;

    const newTarget = iframe.contentDocument?.getElementById('new-target');

    if (newTarget === null || newTarget === undefined) {
      throw new Error('Expected the navigated target.');
    }

    expect(context.getMetrics('vertical')).toEqual({
      axis: 'y',
      contentSize: 0,
      viewportSize: 0,
      scrollOffset: 0,
      maxOffset: 0,
    });
    expect(context.scrollElement(newTarget, 'vertical', { behavior: 'auto', align: 'start' })).toBe(false);

    iframe.remove();
  });
});
