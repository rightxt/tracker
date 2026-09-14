// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateElementScrollProfile } from '../elementScrollProfile.js';

/**
 * Stubs layout-dependent element metrics that jsdom does not compute.
 *
 * @param element - Target element.
 * @param extents - Client extents to define.
 */
function stubLayout(element: HTMLElement, extents: Record<string, number> = { clientHeight: 100, clientWidth: 100 }) {
  element.getClientRects = () => [{}] as unknown as DOMRectList;
  Object.entries(extents).forEach(([name, value]) => {
    Object.defineProperty(element, name, { configurable: true, value });
  });
}

/**
 * Creates a connected scroller candidate with a supported base profile.
 *
 * @param tagName - Element tag name.
 * @returns Connected candidate.
 */
function createCandidate(tagName = 'div'): HTMLElement {
  const element = document.createElement(tagName);

  element.style.display = 'block';
  element.style.overflowY = 'auto';
  element.style.overflowX = 'auto';
  document.body.appendChild(element);
  stubLayout(element);

  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('validateElementScrollProfile', () => {
  it('accepts a connected ordinary container with supported overflow', () => {
    const candidate = createCandidate();

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: true });
    expect(validateElementScrollProfile(candidate, 'x')).toEqual({ ok: true });
  });

  it('rejects a quirks-mode document before any layout inspection', () => {
    const quirksDocument = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    const candidate = quirksDocument.createElement('div');

    quirksDocument.body.appendChild(candidate);

    expect(quirksDocument.compatMode).toBe('BackCompat');
    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'quirks-document' });
  });

  it('rejects a disconnected root', () => {
    const candidate = document.createElement('div');

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'disconnected-root' });
  });

  it('rejects every fixed native non-container element without layout stubs', () => {
    const denylist = [
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
    ];

    denylist.forEach((tagName) => {
      const candidate = document.createElement(tagName);

      document.body.appendChild(candidate);

      expect(validateElementScrollProfile(candidate as HTMLElement, 'y')).toEqual({
        ok: false,
        reason: 'native-non-container',
      });
    });
  });

  it('rejects a root without a principal box', () => {
    const candidate = document.createElement('div');

    candidate.style.overflowY = 'auto';
    document.body.appendChild(candidate);

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'no-principal-box' });
  });

  it('rejects a zero represented-axis viewport extent', () => {
    const candidate = createCandidate();

    Object.defineProperty(candidate, 'clientHeight', { configurable: true, value: 0 });

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'zero-viewport-extent' });
    expect(validateElementScrollProfile(candidate, 'x')).toEqual({ ok: true });
  });

  it('rejects non-allowlisted display values and accepts the exact ordinary categories', () => {
    const candidate = createCandidate();

    ['inline', 'none', 'contents', 'table', 'list-item'].forEach((display) => {
      candidate.style.display = display;

      expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'unsupported-display' });
    });

    ['block', 'flow-root', 'flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block'].forEach((display) => {
      candidate.style.display = display;

      expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: true });
    });
  });

  it('rejects clip and effective visible represented-axis overflow', () => {
    const candidate = createCandidate();

    candidate.style.overflowY = 'visible';

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'unsupported-overflow' });

    candidate.style.overflowY = 'clip';

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'unsupported-overflow' });

    candidate.style.overflowY = 'hidden';

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: true });
  });

  it('rejects active scroll snapping', () => {
    const candidate = createCandidate();
    const realComputedStyle = window.getComputedStyle.bind(window);

    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = realComputedStyle(element as Element);

      return new Proxy(style, {
        get(target, property, receiver) {
          if (property === 'getPropertyValue') {
            return (name: string) => (name === 'scroll-snap-type' ? 'y mandatory' : target.getPropertyValue(name));
          }

          return Reflect.get(target, property, receiver);
        },
      });
    });

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'scroll-snap-active' });
  });

  it('rejects detectable reverse-flex and wrap-reverse origins on the represented axis only', () => {
    const candidate = createCandidate();

    candidate.style.display = 'flex';
    candidate.style.flexDirection = 'row-reverse';

    expect(validateElementScrollProfile(candidate, 'x')).toEqual({ ok: false, reason: 'reverse-flex-origin' });
    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: true });

    candidate.style.flexDirection = 'column-reverse';

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'reverse-flex-origin' });
    expect(validateElementScrollProfile(candidate, 'x')).toEqual({ ok: true });

    candidate.style.flexDirection = 'row';
    candidate.style.flexWrap = 'wrap-reverse';

    expect(validateElementScrollProfile(candidate, 'y')).toEqual({ ok: false, reason: 'wrap-reverse-origin' });
    expect(validateElementScrollProfile(candidate, 'x')).toEqual({ ok: true });
  });
});
