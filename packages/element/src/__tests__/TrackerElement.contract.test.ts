// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { validateRules } from '@rightxt/tracker-core';

import { CLASS_NAMES, TrackerElement } from './TrackerElement.testSupport.js';

describe('TrackerElement public configuration and event contract', () => {
  it('keeps host attributes application-owned instead of treating them as runtime configuration', () => {
    const element = new TrackerElement();

    element.replaceOptions({
      clustering: { enabled: false },
      orientation: 'horizontal',
      placement: 'bottom',
    });
    element.setAttribute('orientation', 'vertical');
    element.setAttribute('placement', 'left');
    element.setAttribute('clustering-enabled', 'true');
    element.setAttribute('data-test-id', 'app-owned');

    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.getOptions().placement).toBe('bottom');
    expect(element.getOptions().clustering.enabled).toBe(false);

    document.body.appendChild(element);

    element.setAttribute('orientation', 'vertical');
    element.setAttribute('placement', 'top');
    element.render();

    const rootEl = element.querySelector('.rxtt');

    expect(rootEl?.getAttribute('data-rxtt-orientation')).toBe('horizontal');
    expect(rootEl?.getAttribute('data-rxtt-placement')).toBe('bottom');
    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.getOptions().placement).toBe('bottom');
    expect(element.getAttribute('data-test-id')).toBe('app-owned');

    element.remove();
  });

  it('rejects structurally invalid and invalid Tracker options atomically at the Element boundary', () => {
    const element = new TrackerElement();

    element.replaceOptions({ orientation: 'horizontal', placement: 'bottom' });
    document.body.appendChild(element);

    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation')).toBe('horizontal');
    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-placement')).toBe('bottom');

    const assertCommittedStateUnchanged = (): void => {
      expect(element.getOptions().orientation).toBe('horizontal');
      expect(element.getOptions().placement).toBe('bottom');
      expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation')).toBe('horizontal');
      expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-placement')).toBe('bottom');
      expect(element.getStats()).not.toBeNull();
      expect(() => element.render()).not.toThrow();
    };

    expect(() => {
      element.replaceOptions(null as never);
    }).toThrow(TypeError);
    assertCommittedStateUnchanged();

    expect(() => {
      element.replaceOptions({ orientation: 'diagonal' } as never);
    }).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
    assertCommittedStateUnchanged();

    element.remove();
  });

  it('keeps rules on the dedicated Element rule channel', () => {
    const element = new TrackerElement();

    element.replaceRules([{ selector: '.first-target' }]);

    expect(element.getRules()).toEqual([{ selector: '.first-target' }]);

    expect(() => {
      element.replaceOptions({ rules: [{ selector: '.second-target' }] } as never);
    }).toThrow(TypeError);
    expect(() => {
      element.replaceRules(null as never);
    }).toThrow(TypeError);

    expect(element.getRules()).toEqual([{ selector: '.first-target' }]);
  });

  it('does not mask an own undefined option value before Core validation', () => {
    const element = new TrackerElement();

    // Commit a concrete unrelated option so the rejected patch can be checked for
    // full atomicity. `marker.title` is deliberately left at its resolved default:
    // an explicit `undefined` for a field with a committed override is a no-op
    // deep-patch skip, so the own explicit-undefined value only reaches Core
    // validation when no committed override shadows it.
    element.replaceOptions({ orientation: 'horizontal' });

    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.getOptions().marker.title).toBe(true);

    expect(() => element.patchOptions({ marker: { title: undefined as never } })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.getOptions().marker.title).toBe(true);
  });

  it('requires both own options and rules before replaceConfiguration can commit', () => {
    const element = new TrackerElement();

    element.replaceOptions({ orientation: 'horizontal', placement: 'bottom' });
    element.replaceRules([{ selector: '.first-target' }]);

    expect(() => element.replaceConfiguration({ rules: [] } as never)).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.getOptions().placement).toBe('bottom');
    expect(element.getRules()).toEqual([{ selector: '.first-target' }]);

    document.body.appendChild(element);

    expect(element.querySelector('.rxtt')).toBeInstanceOf(HTMLElement);
    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.getRules()).toEqual([{ selector: '.first-target' }]);

    element.remove();
  });

  it('returns detached immutable Core-normalized rule snapshots independent of connection state', () => {
    const element = new TrackerElement();
    const labelCallback = (): string => 'Label';
    const scrollTarget = (): HTMLElement => document.body;
    const inputRule = {
      selector: ' .target ',
      label: labelCallback,
      marker: {
        attributes: {
          'DATA-State': 7,
          'aria-hidden': false,
          'aria-label': null,
          role: ' button ',
        },
      },
      scroll: {
        target: scrollTarget,
      },
    };

    element.replaceRules([inputRule as never]);

    const expected = validateRules([inputRule as never]).rules.map((rule) => rule.source);

    expect(expected).toHaveLength(1);
    expect(element.getRules()).toEqual(expected);

    const firstCall = element.getRules();

    expect(firstCall[0]?.label).toBe(labelCallback);
    expect((firstCall[0] as { scroll?: { target?: unknown } }).scroll?.target).toBe(scrollTarget);

    const secondCall = element.getRules();

    expect(firstCall).not.toBe(secondCall);
    expect(firstCall[0]).not.toBe(secondCall[0]);
    expect(Object.isFrozen(firstCall)).toBe(true);
    expect(Object.isFrozen(firstCall[0])).toBe(true);
    expect(() => {
      (firstCall[0] as { selector: string }).selector = 'mutated';
    }).toThrow();

    inputRule.selector = ' .mutated ';
    expect(element.getRules()).toEqual(expected);

    document.body.appendChild(element);
    expect(element.getRules()).toEqual(expected);

    element.remove();
    expect(element.getRules()).toEqual(expected);
  });

  it('creates and removes only its owned Light DOM structure during connection lifecycle', () => {
    const element = new TrackerElement();
    const applicationChild = document.createElement('span');

    applicationChild.className = 'application-child';
    element.appendChild(applicationChild);
    element.replaceOptions({
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    document.body.appendChild(element);

    const rootEl = element.querySelector(`.${CLASS_NAMES.ROOT}`);
    const viewportEl = element.querySelector(`.${CLASS_NAMES.VIEWPORT}`);
    const markersLayerEl = element.querySelector(`.${CLASS_NAMES.MARKERS}`);

    expect(element.shadowRoot).toBeNull();
    expect(rootEl).toBeInstanceOf(HTMLElement);

    // The stylesheet positions the viewport and the markers layer against the root,
    // so both must be direct children of the root, not nested in each other.
    expect(viewportEl?.parentElement).toBe(rootEl);
    expect(markersLayerEl?.parentElement).toBe(rootEl);
    expect(element.querySelectorAll('style')).toHaveLength(0);
    expect(element.querySelector('.application-child')).toBe(applicationChild);

    element.remove();

    expect(element.querySelector(`.${CLASS_NAMES.ROOT}`)).toBeNull();
    expect(element.querySelector('.application-child')).toBe(applicationChild);

    document.body.appendChild(element);

    expect(element.querySelectorAll(`.${CLASS_NAMES.ROOT}`)).toHaveLength(1);
    expect(element.querySelectorAll('style')).toHaveLength(0);
    expect(element.querySelector('.application-child')).toBe(applicationChild);

    element.remove();
  });

  it('deeply patches committed options but restores omitted values to defaults on replacement', () => {
    const element = new TrackerElement();

    document.body.appendChild(element);

    element.replaceOptions({
      orientation: 'horizontal',
      placement: 'bottom',
      updates: {
        mutation: {
          enabled: true,
          debounce: 100,
        },
      },
    });
    element.patchOptions({
      updates: {
        mutation: {
          debounce: 25,
        },
        scroll: {
          enabled: false,
        },
      },
    });

    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.getOptions().placement).toBe('bottom');
    expect(element.getOptions().updates.mutation).toMatchObject({ enabled: true, debounce: 25 });
    expect(element.getOptions().updates.scroll.enabled).toBe(false);

    element.replaceOptions({});

    expect(element.getOptions().orientation).toBe('vertical');
    expect(element.getOptions().placement).toBe('left');
    expect(element.getOptions().updates.mutation.debounce).toBe(100);
    expect(element.getOptions().updates.mutation.enabled).toBe(true);
    expect(element.getOptions().updates.scroll.enabled).toBe(true);

    const rootEl = element.querySelector('.rxtt');

    expect(rootEl?.getAttribute('data-rxtt-orientation')).toBe('vertical');
    expect(rootEl?.getAttribute('data-rxtt-placement')).toBe('left');

    element.remove();
  });

  it('keeps runtime-only rendering and diagnostics methods explicit across connection state', () => {
    const element = new TrackerElement();

    expect(element.getStats()).toBeNull();
    expect(() => element.render()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }));
    expect(() => element.requestRender()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }));
    expect(() => element.resetStats()).not.toThrow();

    element.replaceOptions({
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    document.body.appendChild(element);

    expect(element.getStats()).not.toBeNull();

    element.render();
    expect(element.getStats()?.renders.completed ?? 0).toBeGreaterThan(0);

    element.resetStats();
    expect(element.getStats()?.renders.completed ?? -1).toBe(0);

    element.render();
    expect(element.getStats()?.renders.completed ?? 0).toBeGreaterThan(0);

    expect(() => element.requestRender()).not.toThrow();

    element.remove();

    expect(element.getStats()).toBeNull();
    expect(() => element.render()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }));
    expect(() => element.requestRender()).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }));
  });

  it('rejects render arguments at both the public type and JavaScript runtime boundaries', () => {
    const element = new TrackerElement();

    element.replaceOptions({
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    document.body.appendChild(element);
    element.render();

    const rendersBefore = element.getStats()?.renders.completed ?? 0;

    expect(() => {
      // @ts-expect-error render() accepts no arguments at the public type boundary.
      element.render('unexpected-argument');
    }).toThrow(TypeError);

    expect(element.getStats()?.renders.completed ?? 0).toBe(rendersBefore);

    element.remove();
  });

  it('keeps diagnostics.output caller-owned while freezing the surrounding getOptions view', () => {
    const element = new TrackerElement();
    const sink = {
      codes: [] as string[],
      warn(code: string) {
        this.codes.push(code);
      },
    };

    element.replaceOptions({ diagnostics: { output: sink } });

    const disconnectedView = element.getOptions();

    expect(disconnectedView.diagnostics.output).toBe(sink);
    expect(Object.isFrozen(disconnectedView)).toBe(true);
    expect(Object.isFrozen(disconnectedView.diagnostics)).toBe(true);
    expect(Object.isFrozen(sink)).toBe(false);

    sink.warn('probe');
    expect(sink.codes).toEqual(['probe']);

    document.body.appendChild(element);

    const connectedView = element.getOptions();

    expect(connectedView.diagnostics.output).toBe(sink);
    expect(Object.isFrozen(connectedView)).toBe(true);
    expect(Object.isFrozen(connectedView.diagnostics)).toBe(true);
    expect(Object.isFrozen(sink)).toBe(false);

    sink.warn('connected-probe');
    expect(sink.codes).toEqual(['probe', 'connected-probe']);

    element.remove();
  });
});
