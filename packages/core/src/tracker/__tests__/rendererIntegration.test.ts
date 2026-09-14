// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTrackerRendererIntegration } from '../rendererIntegration.js';

/** Renderer that adopts an explicitly supplied root for facade tests. */
const ROOT_RENDERER = Object.freeze({
  mount: (context: { readonly target: { readonly kind: string; readonly root?: HTMLElement } }) =>
    context.target.root ?? null,
  unmount: () => undefined,
});

/** Removes connected test roots after each facade scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

/** Creates a mounted Direct Renderer facade with one source marker. */
function createMountedIntegration() {
  const sourceRoot = document.createElement('main');
  const source = document.createElement('section');
  const renderRoot = document.createElement('aside');
  const integration = createTrackerRendererIntegration(
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
      rules: [{ scroll: false, selector: '.renderer-integration-target' }],
    },
    { renderer: ROOT_RENDERER },
  );

  source.className = 'renderer-integration-target';
  sourceRoot.append(source);
  document.body.append(sourceRoot, renderRoot);
  integration.mount({ rendererTarget: { kind: 'root', root: renderRoot }, sourceRoot });

  return integration;
}

describe('Direct Renderer integration facade', () => {
  it('keeps mutable Core authorities outside the Direct Renderer facade', () => {
    const integration = createTrackerRendererIntegration(undefined, { renderer: ROOT_RENDERER });

    expect(integration.getState()).toBe('unmounted');
    expect(integration).not.toHaveProperty('instance');
    expect(integration).not.toHaveProperty('renderer');
    expect(integration).not.toHaveProperty('controllers');
    expect(integration).not.toHaveProperty('scheduler');

    integration.destroy();
  });

  it('defaults an explicit undefined configuration but does not mask null', () => {
    const integration = createTrackerRendererIntegration(undefined, { renderer: ROOT_RENDERER });

    expect(integration.getState()).toBe('unmounted');
    integration.destroy();

    expect(() =>
      // @ts-expect-error A null whole configuration is rejected, not defaulted like undefined.
      createTrackerRendererIntegration(null, { renderer: ROOT_RENDERER }),
    ).toThrow(TypeError);
  });

  it('rejects invalid TrackerRule shapes at both the facade type and runtime boundaries', () => {
    const integration = createMountedIntegration();

    expect(() => {
      // @ts-expect-error addRule() accepts a TrackerRule, not an arbitrary value.
      integration.addRule(null);
    }).toThrow();
    expect(() => {
      // @ts-expect-error TrackerRule.selector must be a string.
      integration.addRule({ selector: 1 });
    }).toThrow();

    integration.destroy();
  });

  it('rejects render arguments at both the facade type and runtime boundaries', () => {
    const integration = createMountedIntegration();

    expect(() => {
      // @ts-expect-error render() accepts no arguments.
      integration.render('markers');
    }).toThrow(TypeError);

    integration.destroy();
  });

  it('revalidates the call-time-captured renderer target before a deferred mount invokes the renderer', () => {
    const rootA = document.createElement('a-root');
    const rootB = document.createElement('b-root');
    const sourceRoot = document.createElement('main');

    document.body.append(rootA, rootB, sourceRoot);

    const mount = vi.fn(
      (context: { readonly target: { readonly kind: string; readonly root?: HTMLElement } }) =>
        context.target.root ?? null,
    );
    const integration = createTrackerRendererIntegration(
      { rules: [{ scroll: false, selector: '.reentrant-target' }] },
      { renderer: { mount, unmount: () => undefined } },
    );
    const request = { rendererTarget: { kind: 'root' as const, root: rootA }, sourceRoot };
    let hasTriggeredMount = false;

    const unsubscribe = integration.subscribeSnapshot(() => {
      // The deferred mount's own completion re-enters this listener; only the
      // first invocation drives the scenario.
      if (hasTriggeredMount) {
        return;
      }
      hasTriggeredMount = true;

      // mount() runs while a public dispatch is already in progress, so it is
      // queued rather than executed synchronously.
      integration.mount(request);

      // After mount() has returned but before the queued operation drains, the
      // caller mutates its own request object and disconnects the root that was
      // captured when mount() was called.
      request.rendererTarget.root = rootB;
      rootA.remove();
    });

    // Publishes a snapshot (the instance is not mounted yet), which invokes the
    // listener above and then drains the queued mount.
    integration.addRule({ scroll: false, selector: '.other-target' });

    // The queued mount is still bound to the captured rootA identity, so
    // switching request.rendererTarget.root to the still-connected rootB does
    // not rescue it; the captured rootA is revalidated for live connectivity at
    // execution time and fails before the renderer is ever invoked.
    expect(integration.isMounted()).toBe(false);
    expect(integration.getRoot()).toBe(null);
    expect(mount).not.toHaveBeenCalled();
    expect(integration.getStats().errors.last?.code).toBe('deferred-operation-error');
    expect(rootB.isConnected).toBe(true);

    unsubscribe();
    integration.destroy();
  });
});
