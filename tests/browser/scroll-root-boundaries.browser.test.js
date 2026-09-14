import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import { validateElementScrollProfile } from '../../packages/core/src/scroll/elementScrollProfile.ts';
// The `?raw` import resolves to a distinct Vite string module (used to seed the
// iframe fixture's own stylesheet below); the plain import applies the CSS as a
// side effect to this top-level test document, so both are genuinely needed.
// eslint-disable-next-line import/no-duplicates
import trackerCss from '../../packages/core/src/styles/rxt-tracker.css?raw';
// eslint-disable-next-line import/no-duplicates
import '../../packages/core/src/styles/rxt-tracker.css';

/** Guaranteed ordinary container display categories (Section 5.4). */
const ALLOWED_DISPLAY_VALUES = ['block', 'flow-root', 'flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block'];

/** Representative principal-box display values outside the guaranteed profile. */
const REJECTED_DISPLAY_VALUES = ['table', 'inline-table', 'list-item'];

/** Represented-axis overflow values supported by the guaranteed profile. */
const SUPPORTED_OVERFLOW_VALUES = ['auto', 'scroll', 'hidden'];

/** Represented-axis overflow values outside the guaranteed profile. */
const REJECTED_OVERFLOW_VALUES = ['visible', 'clip'];

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
 * Loads a same-origin inline frame with the tracker stylesheet applied.
 *
 * The `srcdoc` document is a fully separate document with its own `<head>`,
 * so it never inherits the top-level test document's imported CSS; the
 * tracker stylesheet is inlined here so a frame-hosted root gets real layout.
 *
 * @param {string} bodyMarkup - Trusted frame body markup.
 * @returns {Promise<HTMLIFrameElement>} Loaded frame.
 */
function loadInlineFrame(bodyMarkup) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');

    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.addEventListener('error', () => reject(new Error('Failed to load the scroll-boundary frame.')), {
      once: true,
    });
    iframe.srcdoc = `<!doctype html><html><head><style>${trackerCss}</style></head><body>${bodyMarkup}</body></html>`;
    document.body.appendChild(iframe);
  });
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
      pointerId: 41,
      ...init,
    }),
  );
}

/**
 * Creates an isolated, connected element for a CSS scroll-root
 * profile check against real computed styles.
 *
 * @param {string} localName - Element local name.
 * @param {string} style - Inline style declaration.
 * @returns {HTMLElement} Connected profile element.
 */
function createProfileElement(localName, style) {
  const element = document.createElement(localName);

  element.style.cssText = style;
  document.body.appendChild(element);

  return element;
}

beforeEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

afterEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

describe('scroll-root boundaries', () => {
  describe('transform boundary', () => {
    it('mounts an element container under a transformed ancestor and scrolls only the authoritative root', () => {
      const wrapper = appendFixture(`
        <div style="transform: scale(1.5); transform-origin: top left;">
          <div class="p7b-transform-host" style="position: relative; height: 200px; width: 400px;">
            <div class="p7b-transform-scroller" style="height: 200px; overflow-y: auto;">
              <div style="height: 1200px;"></div>
            </div>
          </div>
        </div>
      `);
      const host = wrapper.querySelector('.p7b-transform-host');
      const scroller = wrapper.querySelector('.p7b-transform-scroller');

      if (!(host instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
        throw new Error('Expected a complete transform-boundary fixture.');
      }

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
        throw new Error('Expected a mounted transform-boundary root.');
      }

      expect(host.querySelector('.rxtt__viewport')).not.toBeNull();
      expect(scroller.scrollTop).toBe(0);

      // getBoundingClientRect() already reports the transformed visual box, so
      // pointer coordinates derived from it land on the actually rendered
      // track regardless of the ancestor scale; only the scroll outcome is
      // asserted, never a precise pixel mapping (a documented
      // integrator-responsibility boundary, not supported geometry).
      const rect = root.getBoundingClientRect();
      const x = rect.left + rect.width / 2;

      dispatchPointer(root, 'pointerdown', { clientX: x, clientY: rect.top + 2 });
      dispatchPointer(root, 'pointermove', { clientX: x, clientY: rect.bottom - 2 });

      expect(scroller.scrollTop).toBeGreaterThan(0);

      dispatchPointer(root, 'pointerup', { clientX: x, clientY: rect.bottom - 2 });

      expect(window.scrollY).toBe(0);

      tracker.destroy();
    });

    it('remains functional as a Window-mode fixed root under a transformed ancestor', () => {
      const wrapper = appendFixture(`
        <div style="transform: translate(1px, 1px);">
          <div class="p7b-fixed-host"></div>
        </div>
        <div class="p7b-window-target" style="height: 40px; margin-top: 2000px;"></div>
      `);
      const fixedHost = wrapper.querySelector('.p7b-fixed-host');

      if (!(fixedHost instanceof HTMLElement)) {
        throw new Error('Expected a complete fixed-root fixture.');
      }

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
        rules: [{ selector: '.p7b-window-target' }],
      });

      tracker.mount({ renderHost: fixedHost });

      const root = fixedHost.querySelector('.rxtt');

      if (!(root instanceof HTMLElement)) {
        throw new Error('Expected a mounted fixed-root Window tracker.');
      }

      // The transformed ancestor becomes the containing block for the
      // fixed-positioned root (Section 5.4 integrator-responsibility
      // boundary), so only functional behavior is asserted, never the root's
      // position relative to the true viewport.
      expect(fixedHost.querySelector('.rxtt__marker')).not.toBeNull();
      expect(window.scrollY).toBe(0);

      const rect = root.getBoundingClientRect();
      const x = rect.left + rect.width / 2;

      dispatchPointer(root, 'pointerdown', { clientX: x, clientY: rect.top + 2 });
      dispatchPointer(root, 'pointermove', { clientX: x, clientY: rect.bottom - 2 });
      dispatchPointer(root, 'pointerup', { clientX: x, clientY: rect.bottom - 2 });

      expect(window.scrollY).toBeGreaterThan(0);

      tracker.destroy();
    });
  });

  describe('iframe container mode and realm teardown', () => {
    it('mounts an element-mode container inside a same-origin iframe and scrolls only the frame-local root', async () => {
      const iframe = await loadInlineFrame(`
        <div class="frame-host" style="position: relative; height: 200px; width: 400px;">
          <div class="frame-scroller" style="height: 200px; overflow-y: auto;">
            <div style="height: 1200px;"></div>
          </div>
        </div>
      `);
      const frameDocument = iframe.contentDocument;
      const frameWindow = iframe.contentWindow;
      const host = frameDocument?.querySelector('.frame-host');
      const scroller = frameDocument?.querySelector('.frame-scroller');

      // The frame is a distinct realm with its own HTMLElement constructor,
      // so frame-sourced nodes must be checked against frameWindow.HTMLElement
      // rather than the top-level HTMLElement (cross-realm instanceof is always false).
      if (
        !frameWindow ||
        !(host instanceof frameWindow.HTMLElement) ||
        !(scroller instanceof frameWindow.HTMLElement)
      ) {
        throw new Error('Expected a complete iframe container fixture.');
      }

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

      if (!(root instanceof frameWindow.HTMLElement)) {
        throw new Error('Expected a mounted iframe container root.');
      }

      expect(root.ownerDocument).toBe(frameDocument);
      expect(document.querySelector('.rxtt')).toBeNull();

      const rect = root.getBoundingClientRect();
      const x = rect.left + rect.width / 2;

      dispatchPointer(root, 'pointerdown', { clientX: x, clientY: rect.top + 2 });
      dispatchPointer(root, 'pointermove', { clientX: x, clientY: rect.bottom - 2 });

      expect(scroller.scrollTop).toBeGreaterThan(0);

      dispatchPointer(root, 'pointerup', { clientX: x, clientY: rect.bottom - 2 });

      expect(window.scrollY).toBe(0);

      // Realm teardown: the iframe's browsing context is destroyed outright
      // while the tracker is still mounted; cleanup must tolerate a dead realm.
      iframe.remove();

      expect(() => tracker.destroy()).not.toThrow();
    });
  });

  describe('CSS scroll-root profile sweep', () => {
    it('classifies the supported display and overflow profile through real computed styles', () => {
      // Every current display and overflow value, checked against real computed
      // styles on a freshly connected element that is removed before the next
      // row so no computed-style state leaks between values. Order-independent.
      // The Core package owner (elementScrollProfile.test.ts) exhaustively owns
      // the fixed native non-container local-name denylist; the public mount
      // rejection for those elements is covered separately below.
      const profileCases = [
        ...ALLOWED_DISPLAY_VALUES.map((display) => ({
          label: `display: ${display}`,
          style: `display: ${display}; width: 100px; height: 100px; overflow: auto;`,
          expected: { ok: true },
        })),
        ...REJECTED_DISPLAY_VALUES.map((display) => ({
          label: `display: ${display}`,
          style: `display: ${display}; width: 100px; height: 100px; overflow: auto;`,
          expected: { ok: false, reason: 'unsupported-display' },
        })),
        ...SUPPORTED_OVERFLOW_VALUES.map((overflow) => ({
          label: `overflow-y: ${overflow}`,
          style: `display: block; width: 100px; height: 100px; overflow-x: auto; overflow-y: ${overflow};`,
          expected: { ok: true },
        })),
        ...REJECTED_OVERFLOW_VALUES.map((overflow) => ({
          // overflow-x stays visible (not auto/scroll/hidden): per the CSS
          // Overflow Module computed-value rule, pairing a scrolling overflow-x
          // with a visible/clip overflow-y would coerce the latter to
          // auto/hidden, masking the case this row exists to cover.
          label: `overflow-y: ${overflow}`,
          style: `display: block; width: 100px; height: 100px; overflow-x: visible; overflow-y: ${overflow};`,
          expected: { ok: false, reason: 'unsupported-overflow' },
        })),
      ];

      for (const { label, style, expected } of profileCases) {
        const element = createProfileElement('div', style);

        expect(validateElementScrollProfile(element, 'y'), label).toEqual(expected);

        element.remove();
      }
    });

    it('rejects mounting a native non-container element as the scroll root', () => {
      const wrapper = appendFixture(`
        <div class="p7b-profile-host" style="position: relative; height: 100px; width: 100px;">
          <button class="p7b-profile-button" style="display: block; width: 100px; height: 100px; overflow: auto;"></button>
        </div>
      `);
      const host = wrapper.querySelector('.p7b-profile-host');
      const button = wrapper.querySelector('.p7b-profile-button');

      if (!(host instanceof HTMLElement) || !(button instanceof HTMLElement)) {
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

      expect(() => tracker.mount({ scrollRoot: button, renderHost: host })).toThrow(
        expect.objectContaining({ code: 'ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT', name: 'TrackerConfigurationError' }),
      );
      expect(tracker.mounted).toBe(false);
    });
  });
});
