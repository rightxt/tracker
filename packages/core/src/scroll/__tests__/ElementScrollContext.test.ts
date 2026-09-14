// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ElementScrollContext } from '../ElementScrollContext.js';

/** DOM metric names overridden by element-context tests. */
type OverriddenMetric =
  | 'clientHeight'
  | 'clientLeft'
  | 'clientTop'
  | 'clientWidth'
  | 'scrollHeight'
  | 'scrollLeft'
  | 'scrollTop'
  | 'scrollWidth';

/**
 * Overrides one configurable DOM metric.
 *
 * @param target - DOM metric carrier.
 * @param property - Metric name.
 * @param value - Metric value.
 */
function overrideMetric(target: Element, property: OverriddenMetric, value: number): void {
  Object.defineProperty(target, property, {
    configurable: true,
    value,
    writable: true,
  });
}

/**
 * Creates a DOMRect-shaped object for `getBoundingClientRect` stubs.
 *
 * @param overrides - Rect fields to set.
 * @returns Complete DOMRect-shaped object.
 */
function createRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    ...overrides,
  } as DOMRect;
}

/**
 * Creates a connected element-mode scroll root with deterministic layout metrics.
 *
 * @returns Connected root stubbed with zero content overflow and a mocked `scrollTo`.
 */
function createScrollRoot(): HTMLElement {
  const root = document.createElement('div');

  document.body.appendChild(root);
  overrideMetric(root, 'clientWidth', 100);
  overrideMetric(root, 'clientHeight', 100);
  overrideMetric(root, 'scrollWidth', 100);
  overrideMetric(root, 'scrollHeight', 100);
  overrideMetric(root, 'scrollLeft', 0);
  overrideMetric(root, 'scrollTop', 0);
  overrideMetric(root, 'clientLeft', 0);
  overrideMetric(root, 'clientTop', 0);
  root.getBoundingClientRect = () => createRect();
  root.scrollTo = vi.fn();

  return root;
}

/** Restores test-owned DOM and mocks after each scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('ElementScrollContext', () => {
  it('throws for a root without an active owner document and window', () => {
    const detachedDocument = document.implementation.createHTMLDocument('detached');
    const detachedRoot = detachedDocument.createElement('div');

    expect(() => new ElementScrollContext(detachedRoot)).toThrow(TypeError);
  });

  it('normalizes element metrics and same-subtree coordinates on both physical axes', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const child = document.createElement('div');

    overrideMetric(root, 'clientWidth', 100);
    overrideMetric(root, 'clientHeight', 80);
    overrideMetric(root, 'scrollWidth', 300);
    overrideMetric(root, 'scrollHeight', 260);
    overrideMetric(root, 'scrollLeft', 40);
    overrideMetric(root, 'scrollTop', 30);
    overrideMetric(root, 'clientLeft', 2);
    overrideMetric(root, 'clientTop', 3);
    root.getBoundingClientRect = () => createRect({ left: 10, top: 5, width: 100, height: 80 });
    child.getBoundingClientRect = () => createRect({ left: 130, top: 95, width: 50, height: 40 });
    root.appendChild(child);

    expect(context.getMetrics('horizontal')).toEqual({
      axis: 'x',
      contentSize: 300,
      viewportSize: 100,
      scrollOffset: 40,
      maxOffset: 200,
    });
    expect(context.getMetrics('vertical')).toEqual({
      axis: 'y',
      contentSize: 260,
      viewportSize: 80,
      scrollOffset: 30,
      maxOffset: 180,
    });
    expect(context.getElementCoordinates(child, 'horizontal')).toEqual({
      start: 158,
      end: 208,
      center: 183,
    });
    expect(context.getElementCoordinates(child, 'vertical')).toEqual({
      start: 117,
      end: 157,
      center: 137,
    });
  });

  it('preserves a zero visual extent when the client size is nonzero', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const child = document.createElement('div');

    overrideMetric(child, 'clientWidth', 50);
    overrideMetric(child, 'clientHeight', 120);
    child.getBoundingClientRect = () => createRect({ left: 20, top: 30, width: 0, height: 0 });
    root.appendChild(child);

    expect(context.getElementCoordinates(child, 'horizontal')).toEqual({
      start: 20,
      end: 20,
      center: 20,
    });
    expect(context.getElementCoordinates(child, 'vertical')).toEqual({
      start: 30,
      end: 30,
      center: 30,
    });
  });

  it('rejects disconnected, foreign-document, and outside-subtree targets', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const disconnected = document.createElement('div');
    const outside = document.createElement('div');
    const iframe = document.createElement('iframe');

    document.body.appendChild(outside);
    document.body.appendChild(iframe);

    const foreign = iframe.contentDocument!.createElement('div');

    iframe.contentDocument!.body.appendChild(foreign);

    for (const target of [disconnected, outside, foreign]) {
      expect(context.getElementCoordinates(target, 'vertical')).toBeNull();
      expect(context.scrollElement(target, 'vertical', { align: 'start', behavior: 'auto' })).toBe(false);
    }
  });

  it('writes physical offsets through the axis boundary with behavior normalization and clamping', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);

    overrideMetric(root, 'clientWidth', 100);
    overrideMetric(root, 'scrollWidth', 300);

    context.scrollToPhysicalOffset(-10, 'horizontal', 'instant');
    context.scrollToPhysicalOffset(150, 'horizontal', 'smooth');
    context.scrollToPhysicalOffset(500, 'horizontal', 'invalid' as never);

    expect(root.scrollTo).toHaveBeenNthCalledWith(1, { behavior: 'instant', left: 0 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(2, { behavior: 'smooth', left: 150 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(3, { behavior: 'auto', left: 200 });
  });

  it('falls back to writing the native offset directly when root.scrollTo is unavailable', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);

    overrideMetric(root, 'clientHeight', 100);
    overrideMetric(root, 'scrollHeight', 300);
    (root as unknown as Record<string, unknown>).scrollTo = undefined;

    context.scrollToPhysicalOffset(150, 'vertical', 'auto');

    expect(root.scrollTop).toBe(150);
  });

  it('aligns a subtree target to start, end, and center', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const target = document.createElement('div');

    overrideMetric(root, 'clientHeight', 200);
    overrideMetric(root, 'scrollHeight', 1000);
    root.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 200, height: 200 });
    target.getBoundingClientRect = () => createRect({ top: 350, height: 40 });
    root.appendChild(target);

    expect(context.scrollElement(target, 'vertical', { align: 'start', behavior: 'auto' })).toBe(true);
    expect(context.scrollElement(target, 'vertical', { align: 'end', behavior: 'auto' })).toBe(true);
    expect(context.scrollElement(target, 'vertical', { align: 'center', behavior: 'auto' })).toBe(true);

    expect(root.scrollTo).toHaveBeenNthCalledWith(1, { behavior: 'auto', top: 350 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(2, { behavior: 'auto', top: 190 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(3, { behavior: 'auto', top: 270 });
  });

  it('performs no scroll for "nearest" alignment when the target is fully visible or fully spans the viewport', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const insideTarget = document.createElement('div');
    const spanningTarget = document.createElement('div');

    overrideMetric(root, 'clientHeight', 200);
    overrideMetric(root, 'scrollHeight', 1000);
    overrideMetric(root, 'scrollTop', 300);
    root.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 200, height: 200 });
    insideTarget.getBoundingClientRect = () => createRect({ top: 50, height: 100 });
    spanningTarget.getBoundingClientRect = () => createRect({ top: -100, height: 400 });
    root.append(insideTarget, spanningTarget);

    expect(context.scrollElement(insideTarget, 'vertical', { align: 'nearest', behavior: 'auto' })).toBe(true);
    expect(context.scrollElement(spanningTarget, 'vertical', { align: 'nearest', behavior: 'auto' })).toBe(true);
    expect(root.scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls "nearest" alignment to the closer edge and clamps to the valid offset range', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const beforeTarget = document.createElement('div');
    const afterTarget = document.createElement('div');
    const clampLowTarget = document.createElement('div');
    const clampHighTarget = document.createElement('div');

    overrideMetric(root, 'clientHeight', 200);
    overrideMetric(root, 'scrollHeight', 1000);
    root.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 200, height: 200 });
    beforeTarget.getBoundingClientRect = () => createRect({ top: -250, height: 40 });
    afterTarget.getBoundingClientRect = () => createRect({ top: 250, height: 50 });
    clampLowTarget.getBoundingClientRect = () => createRect({ top: -510, height: 10 });
    clampHighTarget.getBoundingClientRect = () => createRect({ top: 1210, height: 10 });
    root.append(beforeTarget, afterTarget, clampLowTarget, clampHighTarget);

    overrideMetric(root, 'scrollTop', 300);
    context.scrollElement(beforeTarget, 'vertical', { align: 'nearest', behavior: 'auto' });
    context.scrollElement(afterTarget, 'vertical', { align: 'nearest', behavior: 'auto' });

    overrideMetric(root, 'scrollTop', 10);
    context.scrollElement(clampLowTarget, 'vertical', { align: 'nearest', behavior: 'auto' });

    overrideMetric(root, 'scrollTop', 790);
    context.scrollElement(clampHighTarget, 'vertical', { align: 'nearest', behavior: 'auto' });

    expect(root.scrollTo).toHaveBeenNthCalledWith(1, { behavior: 'auto', top: 50 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(2, { behavior: 'auto', top: 400 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(3, { behavior: 'auto', top: 0 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(4, { behavior: 'auto', top: 800 });
  });

  it('scales physical scroll padding to fit the viewport and folds it into alignment', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const target = document.createElement('div');
    const realComputedStyle = window.getComputedStyle.bind(window);
    let paddingTop = '20px';
    let paddingBottom = '30px';

    overrideMetric(root, 'clientHeight', 200);
    overrideMetric(root, 'scrollHeight', 1000);
    root.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 200, height: 200 });
    target.getBoundingClientRect = () => createRect({ top: 350, height: 40 });
    root.appendChild(target);

    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = realComputedStyle(element as Element);

      if (element !== root) {
        return style;
      }

      return new Proxy(style, {
        get(styleTarget, property, receiver) {
          if (property === 'getPropertyValue') {
            return (name: string) => {
              if (name === 'scroll-padding-top') {
                return paddingTop;
              }

              return name === 'scroll-padding-bottom' ? paddingBottom : styleTarget.getPropertyValue(name);
            };
          }

          return Reflect.get(styleTarget, property, receiver);
        },
      });
    });

    expect(context.scrollElement(target, 'vertical', { align: 'start', behavior: 'auto' })).toBe(true);
    expect(context.scrollElement(target, 'vertical', { align: 'end', behavior: 'auto' })).toBe(true);
    expect(context.scrollElement(target, 'vertical', { align: 'center', behavior: 'auto' })).toBe(true);

    expect(root.scrollTo).toHaveBeenNthCalledWith(1, { behavior: 'auto', top: 330 });
    // 220 / 800 does not round-trip through the physical/native ratio conversion bit-exactly.
    expect(root.scrollTo).toHaveBeenNthCalledWith(2, { behavior: 'auto', top: expect.closeTo(220, 9) });
    expect(root.scrollTo).toHaveBeenNthCalledWith(3, { behavior: 'auto', top: 275 });

    paddingTop = '150px';
    paddingBottom = '150px';

    expect(context.scrollElement(target, 'vertical', { align: 'start', behavior: 'auto' })).toBe(true);
    expect(root.scrollTo).toHaveBeenNthCalledWith(4, { behavior: 'auto', top: 250 });
  });

  it('reports and zero-falls-back an unresolvable scroll-padding value', () => {
    const root = createScrollRoot();
    const fallback = vi.fn();
    const context = new ElementScrollContext(root, { onScrollPaddingFallback: fallback });
    const target = document.createElement('div');
    const realComputedStyle = window.getComputedStyle.bind(window);

    overrideMetric(root, 'clientHeight', 200);
    overrideMetric(root, 'scrollHeight', 1000);
    root.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 200, height: 200 });
    target.getBoundingClientRect = () => createRect({ top: 350, height: 40 });
    root.appendChild(target);

    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = realComputedStyle(element as Element);

      if (element !== root) {
        return style;
      }

      return new Proxy(style, {
        get(styleTarget, property, receiver) {
          if (property === 'getPropertyValue') {
            return (name: string) => (name === 'scroll-padding-top' ? '1em' : styleTarget.getPropertyValue(name));
          }

          return Reflect.get(styleTarget, property, receiver);
        },
      });
    });

    expect(context.scrollElement(target, 'vertical', { align: 'start', behavior: 'auto' })).toBe(true);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith({ property: 'scroll-padding-top', value: '1em' });
    expect(root.scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 350 });
  });

  it('expands the alignment target by physical scroll margin and collapses negative margin to the midpoint', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const target = document.createElement('div');
    const realComputedStyle = window.getComputedStyle.bind(window);
    let marginTop = '15px';
    let marginBottom = '25px';

    overrideMetric(root, 'clientHeight', 200);
    overrideMetric(root, 'scrollHeight', 1000);
    root.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 200, height: 200 });
    target.getBoundingClientRect = () => createRect({ top: 350, height: 40 });
    root.appendChild(target);

    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = realComputedStyle(element as Element);

      if (element !== target) {
        return style;
      }

      return new Proxy(style, {
        get(styleTarget, property, receiver) {
          if (property === 'getPropertyValue') {
            return (name: string) => {
              if (name === 'scroll-margin-top') {
                return marginTop;
              }

              return name === 'scroll-margin-bottom' ? marginBottom : styleTarget.getPropertyValue(name);
            };
          }

          return Reflect.get(styleTarget, property, receiver);
        },
      });
    });

    expect(context.scrollElement(target, 'vertical', { align: 'start', behavior: 'auto' })).toBe(true);
    expect(context.scrollElement(target, 'vertical', { align: 'end', behavior: 'auto' })).toBe(true);
    expect(root.scrollTo).toHaveBeenNthCalledWith(1, { behavior: 'auto', top: 335 });
    expect(root.scrollTo).toHaveBeenNthCalledWith(2, { behavior: 'auto', top: 215 });

    marginTop = '-30px';
    marginBottom = '-30px';

    expect(context.scrollElement(target, 'vertical', { align: 'start', behavior: 'auto' })).toBe(true);
    expect(root.scrollTo).toHaveBeenNthCalledWith(3, { behavior: 'auto', top: 370 });
  });

  it('connects and disconnects the authoritative element scroll listener idempotently', () => {
    const root = createScrollRoot();
    const context = new ElementScrollContext(root);
    const listener = vi.fn();
    const removeEventListener = vi.spyOn(root, 'removeEventListener');
    const disconnect = context.connectScrollListener(listener);

    root.dispatchEvent(new Event('scroll'));
    disconnect();
    disconnect();
    root.dispatchEvent(new Event('scroll'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('scroll', listener);
  });
});
