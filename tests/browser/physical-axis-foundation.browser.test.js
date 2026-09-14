import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import {
  clearNativeAxisBehaviorCache,
  getElementMaxOffset,
  readElementNativeOffset,
  resolveAxisOffsetConverter,
  writeElementNativeOffset,
} from '../../packages/core/src/dom/physicalAxis.ts';
import { getInternalDomRegistry } from '../../packages/core/src/dom/internalDomRegistry.ts';
import { resolveWindowPrincipalFlow } from '../../packages/core/src/dom/windowPrincipalFlow.ts';
import '../../packages/core/src/styles/rxt-tracker.css';

/** Writing modes exercised by the physical-axis converter. */
const WRITING_MODES = ['horizontal-tb', 'vertical-rl', 'vertical-lr'];

/** Directions exercised by the physical-axis converter. */
const DIRECTIONS = ['ltr', 'rtl'];

/** Both physical axes exercised independently. */
const PHYSICAL_AXES = ['x', 'y'];

/** Physical placement fixtures used by the Tracker UI-isolation check. */
const UI_PLACEMENTS = [
  { orientation: 'vertical', placement: 'left' },
  { orientation: 'vertical', placement: 'right' },
  { orientation: 'horizontal', placement: 'top' },
  { orientation: 'horizontal', placement: 'bottom' },
];

/**
 * Waits for one animation-frame checkpoint.
 *
 * @returns {Promise<void>}
 */
function waitForAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * Loads a same-origin inline frame.
 *
 * @param {string} markup - Complete frame markup.
 * @returns {Promise<HTMLIFrameElement>} Loaded frame.
 */
function loadInlineFrame(markup) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');

    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.addEventListener('error', () => reject(new Error('Failed to load the axis spike frame.')), { once: true });
    iframe.srcdoc = markup;
    document.body.appendChild(iframe);
  });
}

/**
 * Returns observed physical content displacement for one element scroller.
 *
 * @param {HTMLElement} root - Scroll root.
 * @param {HTMLElement} content - Oversized content.
 * @param {'x' | 'y'} axis - Physical axis.
 * @returns {number} Observed physical offset.
 */
function readElementPhysicalDisplacement(root, content, axis) {
  const rootRect = root.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();

  return axis === 'x'
    ? rootRect.left + root.clientLeft - contentRect.left
    : rootRect.top + root.clientTop - contentRect.top;
}

/**
 * Creates an oversized element scroll fixture.
 *
 * @param {string} writingMode - CSS writing mode.
 * @param {string} direction - CSS direction.
 * @returns {{ content: HTMLElement, root: HTMLElement }} Scroll fixture.
 */
function createElementScrollFixture(writingMode, direction) {
  const root = document.createElement('div');
  const content = document.createElement('div');

  root.style.cssText = [
    'border: 0',
    `direction: ${direction}`,
    'height: 80px',
    'overflow: scroll',
    'padding: 0',
    'position: fixed',
    'visibility: hidden',
    'width: 80px',
    `writing-mode: ${writingMode}`,
  ].join(';');
  content.style.cssText = 'height: 320px; min-height: 320px; min-width: 320px; position: relative; width: 320px;';
  root.appendChild(content);
  document.body.appendChild(root);

  return { content, root };
}

/**
 * Returns the absolute distance between two rectangle edges.
 *
 * @param {number} actual - Observed edge.
 * @param {number} expected - Expected edge.
 * @returns {number} Absolute difference.
 */
function edgeDifference(actual, expected) {
  return Math.abs(actual - expected);
}

/** Removes every test-owned node after a browser fixture. */
afterEach(() => {
  document.body.replaceChildren();
  clearNativeAxisBehaviorCache(document);
  window.scrollTo(0, 0);
});

describe('physical-axis and internal-DOM behavior', () => {
  // One runtime case per writing-mode/direction profile. Each case owns BOTH
  // platform targets for that profile: the element scroll root (physical x and
  // y, start/mid/end offsets) and the same-origin Window carrier (physical x
  // and y endpoints). The independent runtime dimension is exactly the six
  // WRITING_MODES x DIRECTIONS profiles - the axis and the platform target are
  // inner loops, not separate registrations.
  for (const writingMode of WRITING_MODES) {
    for (const direction of DIRECTIONS) {
      it(`round-trips both physical axes and matches Window endpoints for ${writingMode}/${direction}`, async () => {
        // Element portion - fresh oversized element scroller for this profile.
        clearNativeAxisBehaviorCache(document);

        const { content, root } = createElementScrollFixture(writingMode, direction);

        for (const axis of PHYSICAL_AXES) {
          const maxOffset = getElementMaxOffset(root, axis);
          const converter = resolveAxisOffsetConverter(root, axis, maxOffset);

          expect(maxOffset, `element ${axis} max offset for ${writingMode}/${direction}`).toBeGreaterThan(0);

          for (const physicalOffset of [0, maxOffset / 2, maxOffset]) {
            const nativeOffset = converter.toNativeOffset(physicalOffset, maxOffset);

            writeElementNativeOffset(root, axis, nativeOffset);

            const observedNativeOffset = readElementNativeOffset(root, axis);
            const convertedOffset = converter.toPhysicalOffset(observedNativeOffset, maxOffset);
            const displacedOffset = readElementPhysicalDisplacement(root, content, axis);

            expect(Math.abs(convertedOffset - physicalOffset)).toBeLessThanOrEqual(1);
            expect(Math.abs(displacedOffset - physicalOffset)).toBeLessThanOrEqual(1);
          }
        }

        // Window portion - same-origin iframe carrier for the SAME profile.
        const iframe = await loadInlineFrame(`
          <!doctype html>
          <html style="direction: ${direction}; writing-mode: ${writingMode}; margin: 0; padding: 0;">
            <body style="height: 1600px; margin: 0; padding: 0; position: absolute; width: 1600px;">
              <div id="physical-origin" style="height: 1px; left: 0; position: absolute; top: 0; width: 1px;"></div>
            </body>
          </html>
        `);
        const frameDocument = iframe.contentDocument;
        const frameWindow = iframe.contentWindow;

        if (!frameDocument || !frameWindow || !frameDocument.scrollingElement) {
          throw new Error('Expected a complete same-origin Window spike fixture.');
        }

        const styleRoot = frameDocument.documentElement;
        const carrier = frameDocument.scrollingElement;
        const origin = frameDocument.getElementById('physical-origin');

        if (!origin) {
          throw new Error('Expected the physical origin marker.');
        }

        for (const axis of PHYSICAL_AXES) {
          clearNativeAxisBehaviorCache(frameDocument);

          const maxOffset = getElementMaxOffset(carrier, axis);
          const converter = resolveAxisOffsetConverter(styleRoot, axis, maxOffset);

          expect(maxOffset, `Window ${axis} max offset for ${writingMode}/${direction}`).toBeGreaterThan(0);

          for (const physicalOffset of [0, maxOffset]) {
            writeElementNativeOffset(carrier, axis, converter.toNativeOffset(physicalOffset, maxOffset));

            const observedNativeOffset = readElementNativeOffset(carrier, axis);
            const convertedOffset = converter.toPhysicalOffset(observedNativeOffset, maxOffset);
            const originRect = origin.getBoundingClientRect();
            const displacedOffset = axis === 'x' ? -originRect.left : -originRect.top;

            expect(Math.abs(convertedOffset - physicalOffset)).toBeLessThanOrEqual(1);
            expect(Math.abs(displacedOffset - physicalOffset)).toBeLessThanOrEqual(1);
          }
        }

        clearNativeAxisBehaviorCache(frameDocument);
        iframe.remove();
      });
    }
  }

  it('keeps registered axis probes out of source queries and mutation invalidation', async () => {
    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        diagnostics: { warnings: false },
        updates: { mutation: { debounce: 0 }, resize: { enabled: false } },
      },
      rules: [{ selector: '[data-rxtt-internal-probe]' }],
    });

    tracker.mount();
    clearNativeAxisBehaviorCache(document);
    resolveAxisOffsetConverter(document.documentElement, 'x', 100);

    await Promise.resolve();
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(document.querySelector('[data-rxtt-internal-probe]')).toBeNull();
    expect(tracker.getSnapshot().items).toHaveLength(0);
    expect(tracker.getStats().observers.mutation).toBe(0);
    expect(getInternalDomRegistry(document).activeCount).toBe(1);

    tracker.destroy();

    expect(getInternalDomRegistry(document).activeCount).toBe(0);
  });

  it('resolves CSS-only body flow and containment from live computed styles', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html style="direction: ltr; writing-mode: horizontal-tb;">
        <body style="direction: rtl;"></body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;

    if (!frameDocument) {
      throw new Error('Expected a complete principal-flow frame.');
    }

    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({
      exact: true,
      source: 'body',
      writingMode: 'horizontal-tb',
      direction: 'rtl',
      reason: null,
    });

    frameDocument.documentElement.style.contain = 'layout';

    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({
      exact: true,
      source: 'root',
      direction: 'ltr',
      reason: null,
    });

    iframe.remove();
  });

  it('resolves no-body, hidden-body, and multi-body live profiles deterministically', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html style="direction: rtl; writing-mode: horizontal-tb;">
        <body style="display: none;"></body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;

    if (!frameDocument || !frameDocument.body) {
      throw new Error('Expected a complete body-selection frame.');
    }

    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({ exact: true, source: 'root', direction: 'rtl' });

    frameDocument.body.remove();
    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({ exact: true, source: 'root', direction: 'rtl' });

    frameDocument.documentElement.append(frameDocument.createElement('body'), frameDocument.createElement('body'));
    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({
      exact: false,
      source: null,
      reason: 'ambiguous-body-source',
    });

    iframe.remove();
  });

  it('keeps unclassified body display on the bounded fallback descriptor', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="display: contents;"></body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;

    if (!frameDocument) {
      throw new Error('Expected a complete display-profile frame.');
    }

    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({
      exact: false,
      source: null,
      reason: 'unclassified-display-profile',
    });

    iframe.remove();
  });

  it('observes root display blockification for a specified contents value', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html style="display: contents;">
        <body></body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;

    if (!frameDocument || !frameWindow) {
      throw new Error('Expected a complete root-blockification frame.');
    }

    expect(frameWindow.getComputedStyle(frameDocument.documentElement).display).toBe('block');
    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({ exact: true, source: 'body', reason: null });

    iframe.remove();
  });

  it('bounds vertical text-orientation handling in live profiles', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html style="text-orientation: sideways; writing-mode: vertical-rl;">
        <body style="text-orientation: mixed; writing-mode: vertical-rl;"></body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;

    if (!frameDocument || !frameDocument.body) {
      throw new Error('Expected a complete vertical-flow frame.');
    }

    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({
      exact: true,
      source: 'body',
      writingMode: 'vertical-rl',
      reason: null,
    });

    frameDocument.body.style.textOrientation = 'upright';
    expect(resolveWindowPrincipalFlow(frameDocument)).toMatchObject({
      exact: false,
      source: 'body',
      reason: 'ambiguous-vertical-text-orientation',
    });

    iframe.remove();
  });

  // One runtime case covering every physical UI placement. Each of the four
  // orientation/placement rows gets a fresh target and a fresh Tracker so the
  // rows stay isolated; the independent dimension here is the single contract
  // "service geometry stays physical under inherited RTL vertical flow", not
  // four separate registrations.
  it('keeps every physical UI placement in horizontal-tb/ltr service geometry under inherited RTL vertical flow', () => {
    for (const { orientation, placement } of UI_PLACEMENTS) {
      const target = document.createElement('div');

      target.style.cssText = 'direction: rtl; writing-mode: vertical-rl;';
      target.style.setProperty('--rxtt-track-thickness', '12px');
      target.style.setProperty('--rxtt-track-offset', '7px');
      target.style.setProperty('--rxtt-track-start', '13px');
      target.style.setProperty('--rxtt-track-end', '17px');
      document.body.appendChild(target);

      const tracker = new Tracker({
        options: {
          diagnostics: { warnings: false },
          orientation,
          placement,
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
          },
        },
      });

      tracker.mount({ renderHost: target, sourceRoot: target });

      const root = tracker.root;
      const viewport = root?.querySelector('.rxtt__viewport');

      if (!(root instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
        throw new Error(`Expected the complete Tracker UI root for ${orientation}/${placement}.`);
      }

      viewport.hidden = false;
      viewport.style.setProperty('--rxtt-viewport-start', '25%');
      viewport.style.setProperty('--rxtt-viewport-size', '20%');

      const rootStyle = getComputedStyle(root);
      const rootRect = root.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();

      expect(rootStyle.direction, `${orientation}/${placement} service direction`).toBe('ltr');
      expect(rootStyle.writingMode, `${orientation}/${placement} service writing mode`).toBe('horizontal-tb');
      expect(
        edgeDifference(rootRect.width, orientation === 'vertical' ? 12 : window.innerWidth - 30),
        `${orientation}/${placement} service width`,
      ).toBeLessThanOrEqual(1);
      expect(
        edgeDifference(rootRect.height, orientation === 'horizontal' ? 12 : window.innerHeight - 30),
        `${orientation}/${placement} service height`,
      ).toBeLessThanOrEqual(1);

      if (placement === 'left') {
        expect(edgeDifference(rootRect.left, 7)).toBeLessThanOrEqual(1);
      } else if (placement === 'right') {
        expect(edgeDifference(window.innerWidth - rootRect.right, 7)).toBeLessThanOrEqual(1);
      } else if (placement === 'top') {
        expect(edgeDifference(rootRect.top, 7)).toBeLessThanOrEqual(1);
      } else {
        expect(edgeDifference(window.innerHeight - rootRect.bottom, 7)).toBeLessThanOrEqual(1);
      }

      if (orientation === 'vertical') {
        expect(edgeDifference(viewportRect.top - rootRect.top, rootRect.height * 0.25)).toBeLessThanOrEqual(1);
        expect(edgeDifference(viewportRect.height, rootRect.height * 0.2)).toBeLessThanOrEqual(1);
      } else {
        expect(edgeDifference(viewportRect.left - rootRect.left, rootRect.width * 0.25)).toBeLessThanOrEqual(1);
        expect(edgeDifference(viewportRect.width, rootRect.width * 0.2)).toBeLessThanOrEqual(1);
      }

      tracker.destroy();
      target.remove();
    }
  });
});
