// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { resolveTrackerOptions, type TrackerOptions } from '@rightxt/tracker-core';
import {
  CLASS_NAMES,
  CSS_VARIABLES,
  DATA_ATTRIBUTES,
  type TrackerMarkerRecord,
  type TrackerReadonlyOptions,
  type TrackerRenderRecord,
  type TrackerRendererMountContext,
} from '@rightxt/tracker-core/renderer';
import { DomRenderer } from '../DomRenderer.js';

/**
 * Committed option branches read by the vanilla DOM renderer.
 *
 * Renderer hooks receive fully committed options, so tests merge over this
 * baseline instead of casting partial literals at every call site.
 */
/**
 * Builds committed renderer options for vanilla renderer tests.
 *
 * Only the branches the renderer reads are declared, so the merged value is cast
 * once here instead of duplicating the whole Core default baseline.
 *
 * @param optionsPatch - Option branches overridden by a test.
 * @returns Committed options accepted by the renderer hooks.
 */
function createRendererOptions(optionsPatch: TrackerOptions = {}): TrackerReadonlyOptions {
  return resolveTrackerOptions(optionsPatch) as TrackerReadonlyOptions;
}

/**
 * Creates a host-owned renderer context in the host's DOM realm.
 *
 * @param host - Renderer output host.
 * @returns Final renderer mount context.
 */
function createMountContext(host: HTMLElement): TrackerRendererMountContext {
  const activeWindow = host.ownerDocument.defaultView;

  if (activeWindow === null) {
    throw new Error('Expected a host with an active owner window.');
  }

  return {
    target: { kind: 'host', host },
    document: host.ownerDocument,
    window: activeWindow,
    scrollMode: 'window',
  };
}

/**
 * Creates the minimal marker data needed by vanilla renderer tests.
 *
 * @param params - Marker params.
 * @param params.attributes - Custom marker attributes.
 * @param params.className - Custom marker class.
 * @param params.cssVariables - Custom marker CSS variables.
 * @param params.key - Marker key.
 * @param params.label - Marker label.
 * @param params.removedAttributes - Rule-level marker attribute tombstones.
 * @param params.title - Rule-level native title override.
 * @returns Render record.
 */
function createMarkerRecord({
  attributes = {},
  className = '',
  cssVariables = {},
  key,
  label = null,
  removedAttributes = [],
  title,
}: {
  attributes?: Record<string, string>;
  className?: string;
  cssVariables?: Record<string, string>;
  key: string;
  label?: string | null;
  removedAttributes?: string[];
  title?: boolean;
}): TrackerRenderRecord {
  const focus = {
    enabled: false,
    target: 'self' as const,
  };
  const scroll = {
    align: 'start' as const,
    behavior: 'auto' as const,
    enabled: false,
    target: 'self' as const,
  };
  const marker = {
    cluster: null,
    element: document.createElement('div'),
    focus,
    key,
    label,
    kind: 'marker',
    rule: {
      focus,
      index: 0,
      label: null,
      marker: {
        attributes: {
          removals: new Set(removedAttributes),
          values: attributes,
        },
        className,
        cssVariables,
        title,
      },
      scroll,
      selector: '.source',
      source: {
        selector: '.source',
      },
    },
    ruleIndex: 0,
    selector: '.source',
    scroll,
  } as TrackerMarkerRecord;

  return {
    end: 20,
    key,
    kind: 'marker',
    marker,
    orientation: 'vertical',
    size: 10,
    start: 10,
  } as TrackerRenderRecord;
}

describe('vanilla DomRenderer', () => {
  it('synchronizes the delegated drag state attribute', () => {
    const renderer = new DomRenderer();
    const target = document.createElement('div');

    renderer.mount(createMountContext(target), createRendererOptions({ interaction: { drag: true } }));

    expect(renderer.root?.getAttribute(DATA_ATTRIBUTES.DRAG)).toBe('true');

    renderer.renderTrack(createRendererOptions({ interaction: { drag: false } }));

    expect(renderer.root?.hasAttribute(DATA_ATTRIBUTES.DRAG)).toBe(false);

    renderer.destroy();
  });

  it('updates stable keyed markers without structural DOM writes', () => {
    const renderer = new DomRenderer();
    const target = document.createElement('div');
    const records = [createMarkerRecord({ key: 'first' }), createMarkerRecord({ key: 'second' })];

    renderer.mount(createMountContext(target), createRendererOptions());
    renderer.renderMarkers(records);

    const markersLayer = target.querySelector(`.${CLASS_NAMES.MARKERS}`);

    if (markersLayer === null) {
      throw new Error('Expected a mounted markers layer.');
    }

    const firstMarker = markersLayer.querySelector(`[${DATA_ATTRIBUTES.KEY}="first"]`);
    const observer = new MutationObserver(() => {});

    observer.observe(markersLayer, { childList: true });

    renderer.renderMarkers(records);

    expect(observer.takeRecords()).toEqual([]);

    renderer.renderMarkers([
      createMarkerRecord({ className: 'updated-marker', key: 'first' }),
      createMarkerRecord({ key: 'second' }),
    ]);

    expect(observer.takeRecords()).toEqual([]);
    expect(markersLayer.querySelector(`[${DATA_ATTRIBUTES.KEY}="first"]`)).toBe(firstMarker);
    expect(firstMarker?.classList.contains('updated-marker')).toBe(true);

    observer.disconnect();
    renderer.destroy();
  });

  it('moves only the keyed marker whose order changed', () => {
    const renderer = new DomRenderer();
    const target = document.createElement('div');

    renderer.mount(createMountContext(target), createRendererOptions());
    renderer.renderMarkers([
      createMarkerRecord({ key: 'first' }),
      createMarkerRecord({ key: 'second' }),
      createMarkerRecord({ key: 'third' }),
    ]);

    const markersLayer = target.querySelector(`.${CLASS_NAMES.MARKERS}`);

    if (markersLayer === null) {
      throw new Error('Expected a mounted markers layer.');
    }

    const observer = new MutationObserver(() => {});

    observer.observe(markersLayer, { childList: true });
    renderer.renderMarkers([
      createMarkerRecord({ key: 'third' }),
      createMarkerRecord({ key: 'first' }),
      createMarkerRecord({ key: 'second' }),
    ]);

    const mutations = observer.takeRecords();
    const addedNodes = mutations.flatMap((mutation) => [...mutation.addedNodes]);
    const removedNodes = mutations.flatMap((mutation) => [...mutation.removedNodes]);

    expect(addedNodes).toHaveLength(1);
    expect(removedNodes).toHaveLength(1);
    expect(addedNodes[0]).toBe(removedNodes[0]);
    expect(Array.from(markersLayer.children, (element) => element.getAttribute(DATA_ATTRIBUTES.KEY))).toEqual([
      'third',
      'first',
      'second',
    ]);

    observer.disconnect();
    renderer.destroy();
  });

  it('performs only the required keyed add/remove writes while preserving surviving node identity', () => {
    const renderer = new DomRenderer();
    const target = document.createElement('div');

    renderer.mount(createMountContext(target), createRendererOptions());
    renderer.renderMarkers([createMarkerRecord({ key: 'first' })]);

    const markersLayer = target.querySelector(`.${CLASS_NAMES.MARKERS}`);

    if (markersLayer === null) {
      throw new Error('Expected a mounted markers layer.');
    }

    const firstMarker = markersLayer.querySelector(`[${DATA_ATTRIBUTES.KEY}="first"]`) as HTMLElement;
    const observer = new MutationObserver(() => {});

    observer.observe(markersLayer, { childList: true });

    renderer.renderMarkers([createMarkerRecord({ key: 'first' }), createMarkerRecord({ key: 'second' })]);

    let mutations = observer.takeRecords();

    expect(mutations.flatMap((mutation) => [...mutation.addedNodes])).toHaveLength(1);
    expect(mutations.flatMap((mutation) => [...mutation.removedNodes])).toHaveLength(0);

    const secondMarker = markersLayer.querySelector(`[${DATA_ATTRIBUTES.KEY}="second"]`) as HTMLElement;

    expect(markersLayer.querySelector(`[${DATA_ATTRIBUTES.KEY}="first"]`)).toBe(firstMarker);

    renderer.renderMarkers([createMarkerRecord({ key: 'second' })]);

    mutations = observer.takeRecords();

    expect(mutations.flatMap((mutation) => [...mutation.addedNodes])).toHaveLength(0);

    const removedNodes = mutations.flatMap((mutation) => [...mutation.removedNodes]);

    expect(removedNodes).toEqual([firstMarker]);
    expect(Array.from(markersLayer.children)).toEqual([secondMarker]);
    expect(firstMarker.parentNode).toBeNull();
    expect(markersLayer.contains(secondMarker)).toBe(true);
    expect(Array.from(markersLayer.children, (element) => element.getAttribute(DATA_ATTRIBUTES.KEY))).toEqual([
      'second',
    ]);

    observer.disconnect();
    renderer.destroy();
  });

  it('replaces complete application marker presentation while preserving keyed service state', () => {
    const renderer = new DomRenderer();
    const target = document.createElement('div');
    const initialRecords = [
      createMarkerRecord({
        attributes: { 'data-rule': 'retained', 'data-rule-stale': 'drop-me' },
        className: 'rule-marker rule-marker-stale',
        cssVariables: { [CSS_VARIABLES.MARKER_BG]: 'red' },
        key: 'marker',
        label: 'Source label',
        removedAttributes: ['data-suppressed'],
      }),
    ];
    const nextRecords = [
      createMarkerRecord({
        attributes: { 'data-rule': 'retained' },
        className: 'rule-marker',
        key: 'marker',
      }),
    ];

    renderer.mount(createMountContext(target), createRendererOptions());
    renderer.renderMarkers(initialRecords, createRendererOptions(), {
      attributes: {
        'data-global': 'initial',
        'data-suppressed': 'global',
      },
      className: 'global-marker',
      title: true,
    });
    renderer.renderSelection(null, 'marker');

    const marker = target.querySelector(`.${CLASS_NAMES.MARKER}`) as HTMLElement;
    const markerStart = marker.style.getPropertyValue(CSS_VARIABLES.MARKER_START);
    const markerSize = marker.style.getPropertyValue(CSS_VARIABLES.MARKER_SIZE);

    renderer.renderMarkerPresentation(nextRecords, {
      attributes: {
        'data-global-next': 'updated',
      },
      className: 'global-marker-next',
      title: false,
    });

    // Same node, application presentation fully replaced.
    expect(target.querySelector(`.${CLASS_NAMES.MARKER}`)).toBe(marker);
    expect(marker.className).toBe(`${CLASS_NAMES.MARKER} global-marker-next rule-marker`);
    expect(marker.classList.contains('rule-marker-stale')).toBe(false);
    expect(marker.getAttribute('data-rule')).toBe('retained');
    expect(marker.getAttribute('data-global-next')).toBe('updated');
    expect(marker.hasAttribute('data-global')).toBe(false);
    expect(marker.hasAttribute('data-rule-stale')).toBe(false);
    expect(marker.hasAttribute('data-suppressed')).toBe(false);
    expect(marker.hasAttribute('title')).toBe(false);
    expect(marker.style.getPropertyValue(CSS_VARIABLES.MARKER_BG)).toBe('');
    // Service state and runtime geometry are untouched by the presentation pass.
    expect(marker.getAttribute(DATA_ATTRIBUTES.KEY)).toBe('marker');
    expect(marker.getAttribute(DATA_ATTRIBUTES.KIND)).toBe('marker');
    expect(marker.getAttribute(DATA_ATTRIBUTES.SELECTED)).toBe('true');
    expect(marker.style.getPropertyValue(CSS_VARIABLES.MARKER_START)).toBe(markerStart);
    expect(marker.style.getPropertyValue(CSS_VARIABLES.MARKER_SIZE)).toBe(markerSize);

    renderer.destroy();
  });

  it('touches only the previous and next keyed nodes during selection changes', () => {
    const renderer = new DomRenderer();
    const target = document.createElement('div');

    renderer.mount(createMountContext(target), createRendererOptions());
    renderer.renderMarkers([
      createMarkerRecord({ key: 'first' }),
      createMarkerRecord({ key: 'second' }),
      createMarkerRecord({ key: 'third' }),
    ]);
    renderer.renderSelection(null, 'first');

    const root = renderer.root;

    if (root === null) {
      throw new Error('Expected a mounted renderer root.');
    }

    const observer = new MutationObserver(() => {});

    observer.observe(root, {
      attributeFilter: [DATA_ATTRIBUTES.SELECTED],
      attributes: true,
      subtree: true,
    });
    renderer.renderSelection('first', 'second');

    const mutations = observer.takeRecords();
    const targets = mutations.map((mutation) => mutation.target as HTMLElement);

    expect(mutations).toHaveLength(2);
    expect(new Set(targets)).toEqual(
      new Set([
        root.querySelector(`[${DATA_ATTRIBUTES.KEY}="first"]`),
        root.querySelector(`[${DATA_ATTRIBUTES.KEY}="second"]`),
      ]),
    );
    expect(root.querySelector(`[${DATA_ATTRIBUTES.KEY}="first"]`)?.hasAttribute(DATA_ATTRIBUTES.SELECTED)).toBe(false);
    expect(root.querySelector(`[${DATA_ATTRIBUTES.KEY}="second"]`)?.getAttribute(DATA_ATTRIBUTES.SELECTED)).toBe(
      'true',
    );
    expect(root.querySelector(`[${DATA_ATTRIBUTES.KEY}="third"]`)?.hasAttribute(DATA_ATTRIBUTES.SELECTED)).toBe(false);

    observer.disconnect();
    renderer.destroy();
  });

  it('resets internal state for a fresh remount even when unmount() fails to remove the root', () => {
    const renderer = new DomRenderer();
    const target = document.createElement('div');

    renderer.mount(createMountContext(target), createRendererOptions());

    const failingRoot = renderer.root;

    if (failingRoot === null) {
      throw new Error('Expected a mounted renderer root.');
    }

    const removeError = new Error('remove failed');

    failingRoot.remove = () => {
      throw removeError;
    };

    expect(() => renderer.unmount()).toThrow(removeError);
    expect(renderer.root).toBeNull();

    const remountedRoot = renderer.mount(createMountContext(target), createRendererOptions());

    expect(remountedRoot).not.toBeNull();
    expect(remountedRoot).not.toBe(failingRoot);
    expect(target.querySelectorAll(`.${CLASS_NAMES.ROOT}`)).toHaveLength(2);

    renderer.destroy();
  });
});
