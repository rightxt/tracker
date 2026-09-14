// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createTrackerStateIntegration } from '../../__tests__/testIntegration.js';
import { createTrackerMarkerDefaultsSnapshot } from '../markerDefaultsSnapshot.js';
import {
  createTrackerMountView,
  projectTrackerChromeView,
  projectTrackerItemViews,
  projectTrackerViewportView,
} from '../viewProjection.js';

/** Splits a projected class string into comparable tokens. */
function classTokens(className: string): readonly string[] {
  return className.split(/\s+/).filter((token) => token !== '');
}

/** Clears test-owned DOM roots. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('framework renderer view projections', () => {
  it('projects normalized marker, chrome, and viewport presentation into minimal immutable framework views', () => {
    const renderRoot = document.createElement('div');
    const target = document.createElement('section');

    target.className = 'projection-target';
    document.body.append(target, renderRoot);

    const runtime = createTrackerStateIntegration({
      options: {
        a11y: { enabled: true, keyboard: true, label: 'Projected tracker' },
        clustering: { enabled: false },
        cssVariables: { '--rxtt-track-thickness': '12px' },
        interaction: { drag: true },
        marker: { attributes: { 'aria-label': 'Global marker' }, className: 'global-marker' },
        markerLayer: { className: 'projected-layer' },
        orientation: 'horizontal',
        placement: 'top',
        track: { className: 'projected-track' },
        viewport: { className: 'projected-viewport' },
      },
      rules: [
        {
          label: 'Projected item',
          marker: {
            attributes: { 'aria-label': 'Rule marker', 'data-projection': 'item' },
            className: 'rule-marker',
            cssVariables: { '--projection-color': 'teal' },
          },
          selector: '.projection-target',
        },
      ],
    });

    runtime.mount({ renderRoot });

    const instance = runtime.instance;
    const geometryAvailable = instance.mounted && instance.runtimeContext !== null && !instance.geometrySuspended;
    const mount = createTrackerMountView(
      instance.mounted,
      instance.runtimeContext?.scrollMode ?? null,
      geometryAvailable,
    );
    const chrome = projectTrackerChromeView(instance.rendererOptions, mount);
    const items = projectTrackerItemViews(
      instance.renderRecords,
      createTrackerMarkerDefaultsSnapshot(instance.options.marker),
      mount.geometryAvailable,
    );
    const viewport = projectTrackerViewportView(
      instance.renderer.viewportLayout,
      instance.rendererOptions,
      mount.geometryAvailable,
    );

    // Chrome root: canonical service class plus configured track class, and the
    // representative public attribute surface derived from real mount state.
    expect(classTokens(chrome.root.className)).toEqual(expect.arrayContaining(['rxtt', 'projected-track']));
    expect(chrome.root.attributes).toMatchObject({
      'aria-label': 'Projected tracker',
      'data-rxtt-geometry': 'available',
      'data-rxtt-orientation': 'horizontal',
      'data-rxtt-placement': 'top',
      'data-rxtt-scroll-mode': 'window',
      tabindex: '0',
    });
    expect(chrome.root.attributes['data-rxtt-drag']).toBe('true');
    expect(chrome.root.styleVars['--rxtt-track-thickness']).toBe('12px');

    // Chrome marker layer: canonical service class plus configured class, visible.
    expect(classTokens(chrome.markersLayer.className)).toEqual(
      expect.arrayContaining(['rxtt__markers', 'projected-layer']),
    );
    expect(chrome.markersLayer.hidden).toBe(false);

    // Viewport: canonical service class plus configured class; visibility and the
    // percentage geometry custom properties follow the committed layout.
    const viewportVisible =
      mount.geometryAvailable &&
      instance.rendererOptions.viewport.enabled &&
      instance.renderer.viewportLayout?.visible === true;

    expect(classTokens(viewport.className)).toEqual(expect.arrayContaining(['rxtt__viewport', 'projected-viewport']));
    expect(viewport.hidden).toBe(!viewportVisible);

    if (viewportVisible) {
      expect(viewport.styleVars['--rxtt-viewport-start']).toMatch(/%$/);
      expect(viewport.styleVars['--rxtt-viewport-size']).toMatch(/%$/);
    } else {
      expect(viewport.styleVars).toEqual({});
    }

    // Ordinary item: exactly one, with the documented own-property surface only.
    expect(items).toHaveLength(1);

    const item = items[0]!;

    expect(Object.keys(item).sort()).toEqual(['attributes', 'className', 'key', 'styleVars']);
    expect(classTokens(item.className)).toEqual(
      expect.arrayContaining(['rxtt__marker', 'global-marker', 'rule-marker']),
    );
    expect(item.attributes).toMatchObject({
      'aria-label': 'Rule marker',
      'data-projection': 'item',
      'data-rxtt-key': item.key,
      'data-rxtt-kind': 'marker',
      title: 'Projected item',
    });
    expect(item.styleVars['--projection-color']).toBe('teal');
    expect(item.styleVars['--rxtt-marker-start']).toMatch(/%$/);
    expect(item.styleVars['--rxtt-marker-size']).toMatch(/%$/);

    // No observation-only or source-graph fields leak into the framework view.
    expect(Object.hasOwn(item, 'label')).toBe(false);
    expect(Object.hasOwn(item, 'selected')).toBe(false);
    expect(Object.hasOwn(item, 'element')).toBe(false);
    expect(Object.hasOwn(item, 'rule')).toBe(false);
    expect(Object.hasOwn(item.attributes, 'data-rxtt-selected')).toBe(false);

    // Every documented projected value and map is frozen.
    expect(Object.isFrozen(chrome)).toBe(true);
    expect(Object.isFrozen(chrome.root)).toBe(true);
    expect(Object.isFrozen(chrome.root.attributes)).toBe(true);
    expect(Object.isFrozen(chrome.root.styleVars)).toBe(true);
    expect(Object.isFrozen(chrome.markersLayer)).toBe(true);
    expect(Object.isFrozen(chrome.markersLayer.attributes)).toBe(true);
    expect(Object.isFrozen(chrome.markersLayer.styleVars)).toBe(true);
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.attributes)).toBe(true);
    expect(Object.isFrozen(item.styleVars)).toBe(true);
    expect(Object.isFrozen(viewport)).toBe(true);
    expect(Object.isFrozen(viewport.attributes)).toBe(true);
    expect(Object.isFrozen(viewport.styleVars)).toBe(true);

    runtime.destroy();
  });

  it('produces a deterministic hidden shell without geometry', () => {
    const runtime = createTrackerStateIntegration({
      options: {
        a11y: { enabled: false },
        orientation: 'horizontal',
        placement: 'bottom',
      },
      rules: [],
    });
    const mount = createTrackerMountView(false, null, false);
    const chrome = projectTrackerChromeView(runtime.instance.rendererOptions, mount);
    const viewport = projectTrackerViewportView(null, runtime.instance.rendererOptions, false);
    const items = projectTrackerItemViews([], undefined, false);

    expect(chrome.root.attributes).toMatchObject({
      'aria-disabled': 'true',
      'aria-hidden': 'true',
      'data-rxtt-geometry': 'unavailable',
      'data-rxtt-orientation': 'horizontal',
      'data-rxtt-placement': 'bottom',
    });
    expect(chrome.markersLayer.hidden).toBe(true);
    expect(viewport.hidden).toBe(true);
    expect(items).toEqual([]);
    expect(Object.isFrozen(items)).toBe(true);

    runtime.destroy();
  });

  it('projects cluster presentation without exposing cluster observation metadata', () => {
    const renderRoot = document.createElement('div');
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');

    firstTarget.className = 'projection-cluster-target';
    secondTarget.className = 'projection-cluster-target';
    document.body.append(firstTarget, secondTarget, renderRoot);

    const runtime = createTrackerStateIntegration({
      options: {
        clustering: { enabled: true, threshold: 1 },
        marker: { className: 'cluster-default' },
      },
      rules: [{ label: 'Cluster item', selector: '.projection-cluster-target' }],
    });

    runtime.mount({ renderRoot });

    const instance = runtime.instance;
    const geometryAvailable = instance.mounted && instance.runtimeContext !== null && !instance.geometrySuspended;
    const items = projectTrackerItemViews(
      instance.renderRecords,
      createTrackerMarkerDefaultsSnapshot(instance.options.marker),
      geometryAvailable,
    );

    // Two colliding sources collapse into exactly one projected cluster item.
    expect(instance.renderRecords).toHaveLength(1);
    expect(instance.renderRecords[0]!.kind).toBe('cluster');
    expect(items).toHaveLength(1);

    const item = items[0]!;

    expect(Object.keys(item).sort()).toEqual(['attributes', 'className', 'key', 'styleVars']);
    expect(classTokens(item.className)).toEqual(expect.arrayContaining(['rxtt__marker', 'cluster-default']));
    expect(item.attributes['data-rxtt-kind']).toBe('cluster');
    expect(item.attributes['data-rxtt-count']).toBe('2');
    expect(item.attributes['data-rxtt-key']).toBe(item.key);
    // Representative geometry presentation is carried as percentage custom properties.
    expect(item.styleVars['--rxtt-marker-start']).toMatch(/%$/);
    expect(item.styleVars['--rxtt-marker-size']).toMatch(/%$/);

    // Cluster observation and source-graph metadata never reaches the framework view.
    expect(Object.hasOwn(item, 'markerKeys')).toBe(false);
    expect(Object.hasOwn(item, 'primaryMarkerKey')).toBe(false);
    expect(Object.hasOwn(item, 'element')).toBe(false);
    expect(Object.hasOwn(item, 'rule')).toBe(false);
    expect(Object.hasOwn(item.attributes, 'data-rxtt-marker-keys')).toBe(false);

    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.attributes)).toBe(true);
    expect(Object.isFrozen(item.styleVars)).toBe(true);

    runtime.destroy();
  });
});
