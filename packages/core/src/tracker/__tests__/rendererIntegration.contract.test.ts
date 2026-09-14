// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackerRendererLike } from '../../types.js';
import { createTrackerRendererIntegration } from '../rendererIntegration.js';

/** Update configuration that removes asynchronous observer noise from contract tests. */
const DISABLED_UPDATES = Object.freeze({
  interval: { enabled: false },
  mutation: { enabled: false },
  resize: { enabled: false },
  scroll: { enabled: false },
});

/** Mutable controls and spies for one contract renderer. */
interface RendererController {
  readonly renderer: TrackerRendererLike;
  readonly hooks: {
    readonly destroy: ReturnType<typeof vi.fn>;
    readonly mount: ReturnType<typeof vi.fn>;
    readonly renderMarkerPresentation: ReturnType<typeof vi.fn>;
    readonly renderMarkers: ReturnType<typeof vi.fn>;
    readonly renderTrack: ReturnType<typeof vi.fn>;
    readonly renderViewport: ReturnType<typeof vi.fn>;
    readonly unmount: ReturnType<typeof vi.fn>;
    readonly updateContext: ReturnType<typeof vi.fn>;
  };
  fail: Set<string>;
}

/** Connected roots and facade used by one public contract scenario. */
interface IntegrationFixture {
  readonly controller: RendererController;
  readonly first: HTMLElement;
  readonly integration: ReturnType<typeof createTrackerRendererIntegration>;
  readonly renderRoot: HTMLElement;
  readonly second: HTMLElement;
  readonly sourceRoot: HTMLElement;
}

/** Creates a stable DOMRect used by marker geometry and scrolling tests. */
function createRect(top: number, height = 10): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    toJSON: () => ({}),
    top,
    width: 100,
    x: 0,
    y: top,
  } as DOMRect;
}

/** Installs deterministic document geometry for snapshot assertions. */
function installDocumentGeometry(): void {
  Object.defineProperties(document.documentElement, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 1000 },
  });
  Object.defineProperties(document.body, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 1000 },
  });
  Object.defineProperties(window, {
    innerHeight: { configurable: true, value: 100 },
    scrollY: { configurable: true, value: 0 },
  });
}

/** Creates a renderer whose individual hooks can be made to fail on demand. */
function createRendererController(): RendererController {
  const fail = new Set<string>();
  const invoke = (name: string): void => {
    if (fail.has(name)) {
      throw new Error(`Expected ${name} failure.`);
    }
  };
  const hooks = {
    destroy: vi.fn(() => invoke('destroy')),
    mount: vi.fn((context: { readonly target: { readonly kind: string; readonly root?: HTMLElement } }) => {
      invoke('mount');
      return context.target.root ?? null;
    }),
    renderMarkerPresentation: vi.fn(() => invoke('renderMarkerPresentation')),
    renderMarkers: vi.fn(() => invoke('renderMarkers')),
    renderTrack: vi.fn(() => invoke('renderTrack')),
    renderViewport: vi.fn(() => invoke('renderViewport')),
    unmount: vi.fn(() => invoke('unmount')),
    updateContext: vi.fn((context: { readonly document?: Document | null }) => {
      if (context.document !== null) {
        invoke('updateContext');
      }
    }),
  };

  return { fail, hooks, renderer: hooks };
}

/** Creates an unmounted facade and connected source/render roots. */
function createFixture(): IntegrationFixture {
  const controller = createRendererController();
  const sourceRoot = document.createElement('main');
  const first = document.createElement('section');
  const second = document.createElement('section');
  const renderRoot = document.createElement('aside');
  const integration = createTrackerRendererIntegration(
    {
      options: {
        clustering: { enabled: false, threshold: 2 },
        updates: DISABLED_UPDATES,
      },
      rules: [
        {
          focus: { enabled: true, target: 'self' },
          scroll: { align: 'center', behavior: 'smooth', enabled: true, target: 'self' },
          selector: '.renderer-contract-first',
        },
        { scroll: false, selector: '.renderer-contract-second' },
      ],
    },
    { renderer: controller.renderer },
  );

  first.className = 'renderer-contract-first';
  second.className = 'renderer-contract-second';
  first.getBoundingClientRect = () => createRect(120);
  second.getBoundingClientRect = () => createRect(620);
  renderRoot.getBoundingClientRect = () => createRect(0, 320);
  sourceRoot.append(first, second);
  document.body.append(sourceRoot, renderRoot);

  return { controller, first, integration, renderRoot, second, sourceRoot };
}

/** Mounts an existing fixture through the public facade. */
function mountFixture(fixture: IntegrationFixture): void {
  fixture.integration.mount({
    rendererTarget: { kind: 'root', root: fixture.renderRoot },
    sourceRoot: fixture.sourceRoot,
  });
}

/** Returns the first pending animation-frame callback while keeping scheduling deterministic. */
function captureAnimationFrames(): { readonly callbacks: FrameRequestCallback[] } {
  const callbacks: FrameRequestCallback[] = [];

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

  return { callbacks };
}

/** Restores test-owned DOM and spies after every scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Installs deterministic geometry before every scenario. */
beforeEach(() => {
  installDocumentGeometry();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('TrackerRendererIntegration public contract', () => {
  it('reports lifecycle and root state across mount, repeated mount rejection, unmount, remount, and destroy', async () => {
    const fixture = createFixture();
    const { integration, renderRoot, sourceRoot } = fixture;

    expect(integration.getState()).toBe('unmounted');
    expect(integration.isMounted()).toBe(false);
    expect(integration.isDestroyed()).toBe(false);
    expect(integration.getRoot()).toBeNull();

    mountFixture(fixture);

    expect(integration.getState()).toBe('mounted');
    expect(integration.getRoot()).toBe(renderRoot);
    expect(() => mountFixture(fixture)).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_ALREADY_MOUNTED' }));
    expect(integration.getRoot()).toBe(renderRoot);

    integration.unmount();
    integration.unmount();

    expect(integration.getState()).toBe('unmounted');
    expect(integration.getRoot()).toBeNull();

    integration.mount({ rendererTarget: { kind: 'root', root: renderRoot }, sourceRoot });

    const destroyed = integration.whenDestroyed();

    integration.destroy();
    integration.destroy();

    await expect(destroyed).resolves.toBeUndefined();
    await expect(integration.whenDestroyed()).resolves.toBeUndefined();
    expect(integration.getState()).toBe('destroyed');
    expect(integration.isDestroyed()).toBe(true);
    expect(integration.getRoot()).toBeNull();
    expect(() => mountFixture(fixture)).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }));
  });

  it('calls renderer.destroy exactly once when destroyed before any mount', () => {
    const { controller, integration } = createFixture();

    integration.destroy();
    integration.destroy();

    expect(controller.hooks.destroy).toHaveBeenCalledTimes(1);
    expect(integration.isDestroyed()).toBe(true);
  });

  it('rolls back a renderer mount-hook failure and permits recovery', () => {
    const fixture = createFixture();
    const { controller, integration } = fixture;

    controller.fail.add('mount');

    expect(() => mountFixture(fixture)).toThrow('Expected mount failure.');
    expect(integration.getState()).toBe('unmounted');
    expect(integration.getRoot()).toBeNull();

    controller.fail.delete('mount');
    expect(() => mountFixture(fixture)).not.toThrow();
    expect(integration.getState()).toBe('mounted');

    integration.destroy();
  });

  it('rolls back a late initial render failure and permits a clean remount', () => {
    const fixture = createFixture();
    const { controller, integration } = fixture;

    controller.fail.add('renderViewport');

    expect(() => mountFixture(fixture)).toThrow('Expected renderViewport failure.');
    expect(integration.getState()).toBe('unmounted');
    expect(integration.getRoot()).toBeNull();

    controller.fail.delete('renderViewport');
    mountFixture(fixture);

    expect(integration.getSnapshot().items).toHaveLength(2);

    integration.destroy();
  });

  it('contains a marker-presentation hook failure and recovers on a later full render', () => {
    const fixture = createFixture();
    const { controller, integration } = fixture;
    const frames = captureAnimationFrames();

    mountFixture(fixture);
    controller.fail.add('renderMarkerPresentation');
    integration.patchOptions({ marker: { className: 'changed-marker' } });

    expect(frames.callbacks).toHaveLength(1);
    frames.callbacks.shift()?.(0);

    expect(integration.getState()).toBe('mounted');
    expect(integration.getStats().warnings.byCode['render-error']).toBe(1);

    controller.fail.delete('renderMarkerPresentation');
    integration.render();

    expect(integration.getState()).toBe('mounted');

    integration.destroy();
  });

  it('reaches stable unmounted and destroyed states even when renderer cleanup hooks fail', () => {
    const unmountFixture = createFixture();

    mountFixture(unmountFixture);
    unmountFixture.controller.fail.add('unmount');

    expect(() => unmountFixture.integration.unmount()).toThrow('Expected unmount failure.');
    expect(unmountFixture.integration.getState()).toBe('unmounted');
    expect(unmountFixture.integration.getRoot()).toBeNull();

    unmountFixture.controller.fail.delete('unmount');
    unmountFixture.integration.destroy();

    const destroyFixture = createFixture();

    mountFixture(destroyFixture);
    destroyFixture.controller.fail.add('destroy');

    expect(() => destroyFixture.integration.destroy()).toThrow('Expected destroy failure.');
    expect(destroyFixture.integration.getState()).toBe('destroyed');
    expect(destroyFixture.integration.getRoot()).toBeNull();
    expect(() => destroyFixture.integration.destroy()).not.toThrow();
    expect(destroyFixture.controller.hooks.destroy).toHaveBeenCalledTimes(1);
  });

  it('resolves a whenDestroyed() promise captured before destroy() even when the renderer destroy hook fails', async () => {
    const fixture = createFixture();
    const { controller, integration } = fixture;

    mountFixture(fixture);

    const destroyed = integration.whenDestroyed();

    controller.fail.add('destroy');

    expect(() => integration.destroy()).toThrow('Expected destroy failure.');

    await expect(destroyed).resolves.toBeUndefined();
    await expect(integration.whenDestroyed()).resolves.toBeUndefined();
    expect(integration.getState()).toBe('destroyed');
    expect(integration.isDestroyed()).toBe(true);
  });

  it('delegates option and replacement mutations through the Direct Renderer facade', () => {
    const { integration } = createFixture();

    integration.replaceOptions({ placement: 'right', updates: DISABLED_UPDATES });
    expect(integration.getOptions().placement).toBe('right');

    integration.patchOptions({ viewport: { enabled: false } });
    expect(integration.getOptions().viewport.enabled).toBe(false);

    integration.replaceRules([{ selector: '.renderer-contract-second' }]);
    expect(integration.getRules()).toHaveLength(1);

    integration.replaceConfiguration({
      options: { orientation: 'horizontal', placement: 'top', updates: DISABLED_UPDATES },
      rules: [{ selector: '.renderer-contract-first' }],
    });
    expect(integration.getOptions()).toMatchObject({ orientation: 'horizontal', placement: 'top' });
    expect(integration.getRules()[0]?.selector).toBe('.renderer-contract-first');

    integration.destroy();
  });

  it('rolls back configuration when renderer context replacement fails', () => {
    const fixture = createFixture();
    const { controller, integration } = fixture;

    mountFixture(fixture);
    const optionsBefore = integration.getOptions();

    controller.hooks.updateContext.mockClear();
    controller.hooks.updateContext.mockImplementationOnce(() => {
      throw new Error('Expected updateContext failure.');
    });

    expect(() => integration.patchOptions({ placement: 'right' })).toThrow('Expected updateContext failure.');
    expect(integration.getOptions()).toBe(optionsBefore);
    expect(integration.getOptions().placement).toBe('left');
    // Failed options transaction: one failed candidate synchronization followed
    // by one rollback synchronization back to the committed context.
    expect(controller.hooks.updateContext).toHaveBeenCalledTimes(2);

    integration.patchOptions({ placement: 'right' });
    expect(integration.getOptions().placement).toBe('right');

    integration.destroy();
  });

  it('delegates immediate and coalesced scheduled full renders through the facade', () => {
    const fixture = createFixture();
    const { controller, integration } = fixture;
    const frames = captureAnimationFrames();

    mountFixture(fixture);
    const immediateCalls = controller.hooks.renderMarkers.mock.calls.length;

    integration.render();
    expect(controller.hooks.renderMarkers).toHaveBeenCalledTimes(immediateCalls + 1);

    frames.callbacks.length = 0;

    integration.requestRender();
    integration.requestRender();
    integration.requestRender();

    expect(frames.callbacks).toHaveLength(1);
    expect(integration.getSnapshot().render.pending).toBe(true);

    frames.callbacks.shift()?.(0);

    expect(controller.hooks.renderMarkers).toHaveBeenCalledTimes(immediateCalls + 2);
    expect(integration.getSnapshot().render.pending).toBe(false);

    integration.destroy();
  });

  it('publishes immutable snapshots, honors unsubscribe, and makes post-destroy subscriptions inert', () => {
    const fixture = createFixture();
    const { integration } = fixture;
    const snapshots: Array<ReturnType<typeof integration.getSnapshot>> = [];
    const initialSnapshot = integration.getSnapshot();
    const unsubscribe = integration.subscribeSnapshot((snapshot) => snapshots.push(snapshot));

    expect(initialSnapshot).toMatchObject({ mounted: false });
    expect(Object.isFrozen(initialSnapshot)).toBe(true);

    mountFixture(fixture);
    expect(snapshots.at(-1)).toBe(integration.getSnapshot());
    expect(integration.getSnapshot().items).toHaveLength(2);

    unsubscribe();
    const snapshotCount = snapshots.length;
    integration.render();
    expect(snapshots).toHaveLength(snapshotCount);

    integration.destroy();
    expect(integration.getSnapshot().lifecycle.destroyed).toBe(true);

    const lateListener = vi.fn();
    const lateUnsubscribe = integration.subscribeSnapshot(lateListener);

    expect(() => lateUnsubscribe()).not.toThrow();
    expect(() => lateUnsubscribe()).not.toThrow();
    expect(lateListener).not.toHaveBeenCalled();

    integration.destroy();
  });

  it('activates marker keys with scroll, focus, payload, source-event deduplication, and no track duplicate', () => {
    const fixture = createFixture();
    const { first, integration, renderRoot } = fixture;
    const markerHandler = vi.fn();
    const trackHandler = vi.fn();
    const scrollIntoView = vi.fn();
    const focus = vi.spyOn(first, 'focus');

    first.scrollIntoView = scrollIntoView;
    mountFixture(fixture);
    integration.on('marker:activate', markerHandler);
    integration.on('track:activate', trackHandler);

    const [marker] = integration.getSnapshot().markers;
    const sourceEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

    expect(marker).toBeDefined();
    expect(integration.activateItem(marker!.key, { sourceEvent })).toBe(true);
    expect(integration.activateItem(marker!.key, { sourceEvent })).toBe(false);
    renderRoot.dispatchEvent(sourceEvent);

    expect(sourceEvent.defaultPrevented).toBe(true);
    expect(markerHandler).toHaveBeenCalledTimes(1);
    expect(markerHandler).toHaveBeenCalledWith(
      expect.objectContaining({ element: first, key: marker!.key, sourceEvent }),
    );
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(focus).toHaveBeenCalled();
    expect(trackHandler).not.toHaveBeenCalled();

    integration.destroy();
  });
});
