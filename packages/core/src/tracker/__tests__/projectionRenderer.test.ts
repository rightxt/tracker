// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTrackerIntegrationInstance } from '../integration.js';
import { destroyTrackerInstance, mountTrackerInstance, unmountTrackerInstance } from '../lifecycle.js';
import { createTrackerProjectionRenderer } from '../projectionRenderer.js';
import { renderTrackerInstance } from '../rendering.js';
import { performTrackerSelectionTransition } from '../selection.js';

/** Removes test DOM and restores mocks after each projection scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * Creates an initialized projection runtime and connected source/render roots.
 *
 * @returns Projection renderer, Core instance, roots, and commit collector.
 */
function createProjectionRuntime() {
  const sourceRoot = document.createElement('main');
  const target = document.createElement('section');
  const renderRoot = document.createElement('div');
  const renderer = createTrackerProjectionRenderer();
  const commits: Array<Parameters<Parameters<typeof renderer.subscribe>[0]>[0]> = [];

  target.className = 'projection-renderer-target';
  sourceRoot.append(target);
  document.body.append(sourceRoot, renderRoot);

  let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

  instance = createTrackerIntegrationInstance(
    {
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ label: 'Projection renderer item', selector: '.projection-renderer-target' }],
    },
    { getInstance: () => instance, renderer },
  );
  renderer.initialize(instance.rendererOptions);
  renderer.subscribe((commit) => commits.push(commit));

  return { commits, instance, renderer, renderRoot, sourceRoot };
}

/**
 * Defines the minimum connected box metrics required by element-mode validation.
 *
 * @param element - Element-mode scroll root.
 */
function stubElementLayout(element: HTMLElement): void {
  element.getClientRects = () => [{}] as unknown as DOMRectList;
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 100 });
}

describe('transactional projection renderer', () => {
  it('publishes one coherent initial generation without Core-owned root attributes', () => {
    const { commits, instance, renderer, renderRoot, sourceRoot } = createProjectionRuntime();

    mountTrackerInstance(instance, {
      rendererTarget: { kind: 'root', root: renderRoot },
      sourceRoot,
    });

    const projection = renderer.getProjection();

    expect(commits).toHaveLength(1);
    expect(commits[0]?.changed).toEqual(['chrome', 'items', 'mount', 'viewport']);
    expect(projection.generation).toBe(1);
    expect(projection.mount).toMatchObject({ geometryAvailable: true, mounted: true, scrollMode: 'window' });
    // Minimum item evidence only: detailed item shape/immutability/reference
    // dimensions are owned by viewProjection.test.ts.
    expect(projection.items).toHaveLength(1);
    expect(renderRoot.hasAttribute('data-rxtt-scroll-mode')).toBe(false);
    expect(renderRoot.hasAttribute('data-rxtt-geometry')).toBe(false);

    destroyTrackerInstance(instance);
  });

  it('keeps item identity stable for selection-only commits', () => {
    const { commits, instance, renderer, renderRoot, sourceRoot } = createProjectionRuntime();

    mountTrackerInstance(instance, {
      rendererTarget: { kind: 'root', root: renderRoot },
      sourceRoot,
    });
    commits.length = 0;
    const items = renderer.getProjection().items;

    performTrackerSelectionTransition(instance, { nextKey: 'marker:next', previousKey: null }, 'selection');

    expect(commits).toHaveLength(1);
    expect(commits[0]?.changed).toEqual(['selection']);
    expect(renderer.getProjection().items).toBe(items);
    expect(renderer.getProjection().selection.selectedKey).toBe('marker:next');

    destroyTrackerInstance(instance);
  });

  it('discards a failed render and publishes the next full recovery pass', () => {
    const { commits, instance, renderer, renderRoot, sourceRoot } = createProjectionRuntime();

    mountTrackerInstance(instance, {
      rendererTarget: { kind: 'root', root: renderRoot },
      sourceRoot,
    });
    commits.length = 0;
    const committed = renderer.getProjection();

    vi.spyOn(renderer, 'renderViewport').mockImplementationOnce(() => {
      throw new Error('projection viewport failed');
    });

    renderTrackerInstance(instance, 'viewport');

    expect(commits).toHaveLength(0);
    expect(renderer.getProjection()).toBe(committed);
    expect(instance.dirtyRenderTarget).toBe('all');

    renderTrackerInstance(instance, 'all');

    expect(commits).toHaveLength(1);
    expect(commits[0]?.changed).toEqual(['chrome', 'items', 'viewport']);
    expect(renderer.getProjection().revision).toBe(committed.revision + 1);

    destroyTrackerInstance(instance);
  });

  it('increments Projection generations across reversible unmount and remount while preserving stable item keys', () => {
    const { instance, renderer, renderRoot, sourceRoot } = createProjectionRuntime();

    mountTrackerInstance(instance, {
      rendererTarget: { kind: 'root', root: renderRoot },
      sourceRoot,
    });
    const mountedGeneration = renderer.getProjection().generation;
    const firstMountItem = renderer.getProjection().items[0];

    unmountTrackerInstance(instance);

    expect(renderer.getProjection().generation).toBe(mountedGeneration + 1);
    expect(renderer.getProjection().mount.mounted).toBe(false);
    expect(renderer.getProjection().items).toEqual([]);

    mountTrackerInstance(instance, {
      rendererTarget: { kind: 'root', root: renderRoot },
      sourceRoot,
    });

    expect(renderer.getProjection().generation).toBe(mountedGeneration + 2);
    expect(renderer.getProjection().mount.mounted).toBe(true);
    expect(renderer.getProjection().items).toHaveLength(1);
    const remountItem = renderer.getProjection().items[0];

    expect(remountItem?.key).toBe(firstMountItem?.key);

    destroyTrackerInstance(instance);
  });

  it('publishes geometry suspension and recovery without mutating the framework root', () => {
    const scrollRoot = document.createElement('div');
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const renderRoot = document.createElement('div');
    const renderer = createTrackerProjectionRenderer();

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    stubElementLayout(scrollRoot);
    target.className = 'projection-suspension-target';
    sourceRoot.append(target);
    scrollRoot.append(sourceRoot);
    document.body.append(scrollRoot, renderRoot);

    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createTrackerIntegrationInstance(
      {
        options: {
          clustering: { enabled: false },
          updates: {
            interval: { enabled: false },
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
          },
        },
        rules: [{ selector: '.projection-suspension-target' }],
      },
      { getInstance: () => instance, renderer },
    );
    renderer.initialize(instance.rendererOptions);
    mountTrackerInstance(instance, {
      rendererTarget: { kind: 'root', root: renderRoot },
      scrollRoot,
      sourceRoot,
    });

    expect(renderer.getProjection().items).toHaveLength(1);
    expect(renderer.getProjection().mount.geometryAvailable).toBe(true);

    scrollRoot.style.overflowY = 'visible';
    renderTrackerInstance(instance, 'all');

    expect(renderer.getProjection().items).toEqual([]);
    expect(renderer.getProjection().mount).toMatchObject({
      geometryAvailable: false,
      mounted: true,
      scrollMode: 'element',
    });
    expect(renderer.getProjection().chrome.markersLayer.hidden).toBe(true);
    expect(renderRoot.hasAttribute('data-rxtt-geometry')).toBe(false);
    expect(renderRoot.hasAttribute('aria-disabled')).toBe(false);

    scrollRoot.style.overflowY = 'auto';
    renderTrackerInstance(instance, 'viewport');

    expect(renderer.getProjection().mount.geometryAvailable).toBe(true);
    expect(renderer.getProjection().items).toHaveLength(1);

    destroyTrackerInstance(instance);
  });
});
