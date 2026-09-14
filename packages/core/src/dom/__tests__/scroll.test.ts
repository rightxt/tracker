// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { focusElement, resolveElementTarget, resolveFocusTarget, resolveScrollTarget } from '../scroll.js';

describe('core DOM scroll helpers', () => {
  it('resolves self, descendant, document and function targets', () => {
    const base = document.createElement('section');
    const descendant = document.createElement('button');
    const external = document.createElement('div');

    descendant.className = 'descendant';
    external.className = 'external';
    base.appendChild(descendant);
    document.body.append(base, external);

    expect(resolveElementTarget(base, 'self')).toBe(base);
    expect(resolveElementTarget(base, '.descendant')).toBe(descendant);
    expect(resolveElementTarget(base, '.external')).toBe(external);
    expect(resolveElementTarget(base, () => descendant)).toBe(descendant);
    expect(resolveElementTarget(base, () => null)).toBeNull();

    base.remove();
    external.remove();
  });

  it('reports selector and resolver errors through diagnostics', () => {
    const base = document.createElement('section');
    const diagnostics = {
      error: vi.fn(),
    };

    expect(resolveElementTarget(base, '[', diagnostics)).toBeNull();
    expect(
      resolveElementTarget(
        base,
        () => {
          throw new Error('failed');
        },
        diagnostics,
      ),
    ).toBeNull();

    expect(diagnostics.error).toHaveBeenCalledTimes(2);
    expect(diagnostics.error.mock.calls[0]?.[0]).toBe('target-selector-error');
    expect(diagnostics.error.mock.calls[1]?.[0]).toBe('target-resolver-error');
  });

  it('narrows resolved focus targets to HTMLElements', () => {
    const base = document.createElement('section');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    base.appendChild(svg);

    expect(resolveFocusTarget(base, 'self')).toBe(base);
    expect(resolveFocusTarget(base, 'svg')).toBeNull();
    expect(resolveScrollTarget(base, 'svg')).toBe(svg);
  });

  it('focuses elements with preventScroll fallback', () => {
    const element = document.createElement('button');
    const focus = vi.fn((options?: FocusOptions) => {
      if (options?.preventScroll) {
        throw new Error('unsupported');
      }
    });

    element.focus = focus;

    focusElement(element);

    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus.mock.calls[0]?.[0]).toEqual({
      preventScroll: true,
    });
    expect(focus.mock.calls[1]?.[0]).toBeUndefined();
  });

  it('reports a failing plain focus fallback through diagnostics instead of throwing', () => {
    const element = document.createElement('button');
    const diagnostics = { error: vi.fn() };

    element.focus = vi.fn((options?: FocusOptions) => {
      if (options?.preventScroll) {
        throw new Error('preventScroll unsupported');
      }
      throw new Error('plain focus failed');
    });

    expect(() => focusElement(element, null, { diagnostics })).not.toThrow();
    expect(diagnostics.error).toHaveBeenCalledTimes(2);
    expect(diagnostics.error.mock.calls[0]?.[0]).toBe('focus-prevent-scroll-error');
    expect(diagnostics.error.mock.calls[1]?.[0]).toBe('focus-fallback-error');
  });

  it('uses an iframe source document for selector fallback', () => {
    const iframe = document.createElement('iframe');

    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument!;
    const base = frameDocument.createElement('section');
    const external = frameDocument.createElement('div');
    const parentTarget = document.createElement('div');
    const diagnostics = { warn: vi.fn() };

    external.className = 'external';
    frameDocument.body.append(base, external);
    document.body.appendChild(parentTarget);

    expect(resolveElementTarget(base, '.external')).toBe(external);
    expect(resolveScrollTarget(base, () => parentTarget, diagnostics, frameDocument)).toBeNull();
    expect(diagnostics.warn).toHaveBeenCalledWith('unsupported-cross-document-target', expect.any(String));

    iframe.remove();
    parentTarget.remove();
  });

  it('prefers a sibling target in the containing ShadowRoot over a document match', () => {
    const host = document.createElement('div');
    const documentTarget = document.createElement('div');

    documentTarget.className = 'shared-target';
    document.body.append(host, documentTarget);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const base = document.createElement('section');
    const shadowTarget = document.createElement('div');

    shadowTarget.className = 'shared-target';
    shadowRoot.append(base, shadowTarget);

    expect(resolveElementTarget(base, '.shared-target', null, document)).toBe(shadowTarget);

    host.remove();
    documentTarget.remove();
  });
});
