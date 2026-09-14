// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WindowScrollContext } from '../WindowScrollContext.js';

/** DOM metric names overridden by Window-context tests. */
const OVERRIDDEN_METRICS = [
  'clientHeight',
  'clientLeft',
  'clientTop',
  'clientWidth',
  'offsetHeight',
  'offsetWidth',
  'scrollHeight',
  'scrollLeft',
  'scrollTop',
  'scrollWidth',
] as const;

/**
 * Overrides one configurable DOM metric.
 *
 * @param target - DOM metric carrier.
 * @param property - Metric name.
 * @param value - Metric value.
 */
function overrideMetric(target: Element, property: (typeof OVERRIDDEN_METRICS)[number], value: number): void {
  Object.defineProperty(target, property, {
    configurable: true,
    value,
    writable: true,
  });
}

/** Configures deterministic page extents and offsets on both axes. */
function configurePageMetrics(): void {
  overrideMetric(document.documentElement, 'clientWidth', 200);
  overrideMetric(document.documentElement, 'clientHeight', 100);
  overrideMetric(document.documentElement, 'scrollWidth', 800);
  overrideMetric(document.documentElement, 'scrollHeight', 600);
  overrideMetric(document.documentElement, 'scrollLeft', 120);
  overrideMetric(document.documentElement, 'scrollTop', 300);
  overrideMetric(document.body, 'scrollWidth', 800);
  overrideMetric(document.body, 'scrollHeight', 600);
}

/** Restores test-owned DOM and metric overrides. */
afterEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');

  for (const target of [document.documentElement, document.body]) {
    for (const property of OVERRIDDEN_METRICS) {
      Reflect.deleteProperty(target, property);
    }
  }

  vi.restoreAllMocks();
});

describe('WindowScrollContext', () => {
  it('normalizes page metrics and same-document coordinates on both physical axes', () => {
    const context = new WindowScrollContext(window);
    const element = document.createElement('div');

    configurePageMetrics();
    overrideMetric(document.documentElement, 'clientLeft', 2);
    overrideMetric(document.documentElement, 'clientTop', 3);
    element.getBoundingClientRect = () =>
      ({
        bottom: 80,
        height: 50,
        left: 20,
        right: 60,
        toJSON: () => ({}),
        top: 30,
        width: 40,
        x: 20,
        y: 30,
      }) as DOMRect;
    document.body.appendChild(element);

    expect(context.getMetrics('horizontal')).toEqual({
      axis: 'x',
      contentSize: 800,
      viewportSize: 200,
      scrollOffset: 120,
      maxOffset: 600,
    });
    expect(context.getMetrics('vertical')).toEqual({
      axis: 'y',
      contentSize: 600,
      viewportSize: 100,
      scrollOffset: 300,
      maxOffset: 500,
    });
    expect(context.getElementCoordinates(element, 'horizontal')).toEqual({
      start: 138,
      end: 178,
      center: 158,
    });
    expect(context.getElementCoordinates(element, 'vertical')).toEqual({
      start: 327,
      end: 377,
      center: 352,
    });
  });

  it('preserves a zero visual extent when the client size is nonzero', () => {
    const context = new WindowScrollContext(window);
    const element = document.createElement('div');

    configurePageMetrics();
    overrideMetric(element, 'clientWidth', 40);
    overrideMetric(element, 'clientHeight', 50);
    element.getBoundingClientRect = () =>
      ({
        bottom: 30,
        height: 0,
        left: 20,
        right: 20,
        toJSON: () => ({}),
        top: 30,
        width: 0,
        x: 20,
        y: 30,
      }) as DOMRect;
    document.body.appendChild(element);

    expect(context.getElementCoordinates(element, 'horizontal')).toEqual({
      start: 140,
      end: 140,
      center: 140,
    });
    expect(context.getElementCoordinates(element, 'vertical')).toEqual({
      start: 330,
      end: 330,
      center: 330,
    });
  });

  it('does not subtract body borders from document coordinates', () => {
    const context = new WindowScrollContext(window);
    const element = document.createElement('div');

    configurePageMetrics();
    overrideMetric(document.documentElement, 'clientLeft', 0);
    overrideMetric(document.documentElement, 'clientTop', 0);
    overrideMetric(document.body, 'clientLeft', 10);
    overrideMetric(document.body, 'clientTop', 12);
    element.getBoundingClientRect = () =>
      ({
        bottom: 62,
        height: 50,
        left: 10,
        right: 50,
        toJSON: () => ({}),
        top: 12,
        width: 40,
        x: 10,
        y: 12,
      }) as DOMRect;
    document.body.appendChild(element);

    expect(context.getElementCoordinates(element, 'horizontal')).toEqual({
      start: 130,
      end: 170,
      center: 150,
    });
    expect(context.getElementCoordinates(element, 'vertical')).toEqual({
      start: 312,
      end: 362,
      center: 337,
    });
  });

  it('writes physical offsets through the axis boundary with internal instant behavior', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const context = new WindowScrollContext(window);

    configurePageMetrics();
    context.scrollToPhysicalOffset(-10, 'horizontal', 'instant');
    context.scrollToPhysicalOffset(20, 'vertical', 'smooth');
    context.scrollToPhysicalOffset(-10, 'vertical', 'invalid' as never);

    expect(scrollTo).toHaveBeenNthCalledWith(1, { behavior: 'instant', left: 0 });
    expect(scrollTo).toHaveBeenNthCalledWith(2, { behavior: 'smooth', top: 20 });
    expect(scrollTo).toHaveBeenNthCalledWith(3, { behavior: 'auto', top: 0 });
  });

  it('uses and reports native fallback when the physical profile is unresolved', () => {
    const fallback = vi.fn();
    const context = new WindowScrollContext(window, { onAlignmentFallback: fallback });
    const element = document.createElement('div');
    const scrollIntoView = vi.fn();

    document.documentElement.style.display = 'contents';
    document.body.style.display = 'none';
    element.scrollIntoView = scrollIntoView;
    document.body.appendChild(element);

    expect(
      context.scrollElement(element, 'horizontal', {
        behavior: 'invalid' as never,
        align: 'invalid' as never,
      }),
    ).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start', inline: 'nearest' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('maps exact physical alignment through the final public behavior', () => {
    const context = new WindowScrollContext(window);
    const element = document.createElement('div');
    const scrollIntoView = vi.fn();

    document.documentElement.style.display = 'block';
    document.documentElement.style.writingMode = 'vertical-rl';
    document.documentElement.style.direction = 'ltr';
    document.documentElement.style.textOrientation = 'mixed';
    document.body.style.display = 'none';
    element.scrollIntoView = scrollIntoView;
    document.body.appendChild(element);

    context.scrollElement(element, 'horizontal', {
      behavior: 'auto',
      align: 'start',
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end', inline: 'nearest' });
  });

  it('contains native activation scrolling within a framed Window', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow!;
    const frameDocument = iframe.contentDocument!;
    const context = new WindowScrollContext(frameWindow);
    const element = frameDocument.createElement('div');
    const scrollIntoView = vi.fn();

    element.scrollIntoView = scrollIntoView;
    frameDocument.body.appendChild(element);

    expect(context.scrollElement(element, 'vertical', { behavior: 'auto', align: 'center' })).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      container: 'nearest',
      inline: 'nearest',
    });
  });

  it('retains only one fallback-consumption key and resets it after exact recovery', () => {
    const fallback = vi.fn();
    const context = new WindowScrollContext(window, {
      onAlignmentFallback: fallback,
    });
    const element = document.createElement('div');

    document.body.style.display = 'none';
    document.documentElement.style.display = 'contents';
    element.scrollIntoView = vi.fn();
    document.body.appendChild(element);

    context.scrollElement(element, 'vertical', { behavior: 'auto', align: 'start' });
    context.scrollElement(element, 'vertical', { behavior: 'auto', align: 'start' });

    expect(fallback).toHaveBeenCalledTimes(1);

    document.documentElement.style.display = 'block';
    context.getMetrics('vertical');
    document.documentElement.style.display = 'contents';
    context.getMetrics('vertical');
    context.scrollElement(element, 'vertical', { behavior: 'auto', align: 'start' });

    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('rejects disconnected and foreign-document activation targets', () => {
    const context = new WindowScrollContext(window);
    const detached = document.createElement('div');
    const iframe = document.createElement('iframe');

    detached.scrollIntoView = vi.fn();
    document.body.appendChild(iframe);

    const foreign = iframe.contentDocument!.createElement('div');

    foreign.scrollIntoView = vi.fn();
    iframe.contentDocument!.body.appendChild(foreign);

    expect(context.scrollElement(detached, 'vertical', { behavior: 'auto', align: 'start' })).toBe(false);
    expect(context.scrollElement(foreign, 'vertical', { behavior: 'auto', align: 'start' })).toBe(false);
    expect(detached.scrollIntoView).not.toHaveBeenCalled();
    expect(foreign.scrollIntoView).not.toHaveBeenCalled();
  });

  it('connects and disconnects the authoritative Window listener idempotently', () => {
    const context = new WindowScrollContext(window);
    const listener = vi.fn();
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const disconnect = context.connectScrollListener(listener);

    window.dispatchEvent(new Event('scroll'));
    disconnect();
    disconnect();
    window.dispatchEvent(new Event('scroll'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('scroll', listener);
  });
});
