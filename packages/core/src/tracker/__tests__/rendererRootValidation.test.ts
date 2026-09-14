// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInternalDomRegistry } from '../../dom/internalDomRegistry.js';
import {
  createTrackerIntegrationInstance,
  destroyTrackerInstance,
  mountTrackerInstance,
  unmountTrackerInstance,
} from '../../__tests__/testIntegration.js';

import type { TrackerRendererMountContext } from '../../types.js';

/** Removes test-owned DOM after every renderer root validation scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderer root validation and exclusion boundaries', () => {
  it('rejects a remount while the previous renderer-owned root is still quarantined and connected', () => {
    const host = document.createElement('div');
    const mount = vi.fn((context: TrackerRendererMountContext) => {
      const target = context.target.kind === 'host' ? context.target.host : context.target.root;
      const root = context.document.createElement('div');

      target.appendChild(root);
      root.remove = vi.fn();

      return root;
    });
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(host);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      { getInstance: () => instance, renderer: { destroy: vi.fn(), mount } },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'host', host } });

    expect(() => unmountTrackerInstance(instance!)).toThrow(
      'Tracker renderer-owned root remained connected after cleanup.',
    );
    expect(mount).toHaveBeenCalledTimes(1);

    // The previously quarantined root is still connected (its remove() is a
    // permanent no-op), so this remount attempt must be rejected before the
    // renderer's mount() ever runs again, rather than silently reusing or
    // orphaning the stuck root.
    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'host', host } })).toThrow(
      'Tracker cannot remount while its previous renderer-owned root remains quarantined.',
    );
    expect(mount).toHaveBeenCalledTimes(1);
    expect(instance.mounted).toBe(false);

    const quarantinedRoot = host.firstElementChild as HTMLElement;

    expect(getInternalDomRegistry(document).getRegistrationState(quarantinedRoot)).toBe('quarantined');

    host.removeChild(quarantinedRoot);
    expect(() => destroyTrackerInstance(instance!)).not.toThrow();
    expect(getInternalDomRegistry(document).activeCount).toBe(0);
  });

  it('rejects mounting a second instance onto a root already registered by another instance', () => {
    const sharedRoot = document.createElement('div');
    const registry = getInternalDomRegistry(document);
    let firstInstance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;
    let secondInstance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(sharedRoot);
    firstInstance = createTrackerIntegrationInstance(
      { options: { updates: { interval: { enabled: false } } }, rules: [] },
      { getInstance: () => firstInstance, renderer: { destroy: vi.fn(), mount: () => sharedRoot } },
    );
    secondInstance = createTrackerIntegrationInstance(
      { options: { updates: { interval: { enabled: false } } }, rules: [] },
      { getInstance: () => secondInstance, renderer: { destroy: vi.fn(), mount: () => sharedRoot } },
    );

    mountTrackerInstance(firstInstance, { rendererTarget: { kind: 'root', root: sharedRoot } });

    // A second instance whose renderer misbehaves by returning a root already
    // owned by another instance must be rejected outright rather than being
    // allowed to silently share or steal the first instance's registration.
    expect(() => mountTrackerInstance(secondInstance!, { rendererTarget: { kind: 'root', root: sharedRoot } })).toThrow(
      'Tracker renderer root could not be registered in its document.',
    );

    // The failed second mount must not share, steal, or release the first
    // instance's registration: the shared root stays actively owned by one.
    expect(registry.getRegistrationState(sharedRoot)).toBe('active');
    expect(registry.activeCount).toBe(1);
    expect(secondInstance.mounted).toBe(false);
    expect(firstInstance.mounted).toBe(true);

    destroyTrackerInstance(secondInstance);
    destroyTrackerInstance(firstInstance);
    expect(registry.activeCount).toBe(0);
  });

  it('rolls back provisional renderer output when the element scroll profile degrades before the first staged render commit', () => {
    const host = document.createElement('div');
    const scrollRoot = document.createElement('div');
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    scrollRoot.getClientRects = () => [{}] as unknown as DOMRectList;
    Object.defineProperty(scrollRoot, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scrollRoot, 'clientWidth', { configurable: true, value: 100 });
    document.body.appendChild(host);
    document.body.appendChild(scrollRoot);

    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      {
        getInstance: () => instance,
        renderer: {
          destroy: vi.fn(),
          mount: (context: TrackerRendererMountContext) => {
            const target = context.target.kind === 'host' ? context.target.host : context.target.root;
            const root = context.document.createElement('div');

            // The scroll root passes profile validation at mount-time, but the
            // renderer's own mount hook (e.g. an injected reset stylesheet)
            // degrades it before the initial render pass re-validates geometry.
            scrollRoot.style.overflowY = 'visible';
            target.appendChild(root);

            return root;
          },
        },
      },
    );

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'host', host }, scrollRoot })).toThrow(
      'Tracker initial render did not produce a commit publication.',
    );
    expect(instance.mounted).toBe(false);
    // Rollback must physically detach the provisional renderer root the mount
    // hook appended to the host, not merely deregister it.
    expect(host.childElementCount).toBe(0);
    expect(getInternalDomRegistry(document).activeCount).toBe(0);
  });

  it('re-quarantines and reports a renderer-owned root that remains connected after the final destroy retry', () => {
    const host = document.createElement('div');
    let root: HTMLElement | null = null;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(host);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      {
        getInstance: () => instance,
        renderer: {
          destroy: vi.fn(),
          get root() {
            return root;
          },
          mount(context) {
            const target = context.target.kind === 'host' ? context.target.host : context.target.root;

            root = context.document.createElement('div');
            target.appendChild(root);
            // Permanently inert: unlike the retry-succeeds scenario above,
            // this root never actually detaches, so the final destroy retry
            // must also observe it as still connected.
            root.remove = vi.fn();

            return root;
          },
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'host', host } });

    expect(() => unmountTrackerInstance(instance!)).toThrow(
      'Tracker renderer-owned root remained connected after cleanup.',
    );
    expect(getInternalDomRegistry(document).getRegistrationState(root!)).toBe('quarantined');

    expect(() => destroyTrackerInstance(instance!)).toThrow(
      'Tracker renderer-owned root remained connected after final cleanup.',
    );
    expect(root!.isConnected).toBe(true);
    expect(getInternalDomRegistry(document).getRegistrationState(root!)).toBe('quarantined');

    // The registry has no way to know this root ever detaches on its own, so
    // clean it up directly to avoid leaking a permanently quarantined node
    // into unrelated tests sharing this document's registry.
    host.removeChild(root!);
    expect(getInternalDomRegistry(document).activeCount).toBe(0);
  });

  it('rejects a host renderer that returns its host and leaves no registration', () => {
    const host = document.createElement('div');
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(host);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      {
        getInstance: () => instance,
        renderer: {
          destroy: vi.fn(),
          mount: (context) => (context.target.kind === 'host' ? context.target.host : context.target.root),
          root: host,
        },
      },
    );

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'host', host } })).toThrow(
      'Tracker host renderer must return a strict descendant of its host.',
    );
    expect(instance.mounted).toBe(false);
    expect(instance.renderer.root).toBeNull();
    // The failed validation/rollback must never remove the application-owned host.
    expect(host.isConnected).toBe(true);
    expect(getInternalDomRegistry(document).activeCount).toBe(0);

    destroyTrackerInstance(instance);
  });

  it.each([
    {
      name: 'a non-HTMLElement value',
      expectedMessage: 'Tracker renderer must return an HTMLElement root.',
      buildCandidate: (): HTMLElement | null => ({}) as unknown as HTMLElement,
    },
    {
      name: 'a disconnected HTMLElement',
      expectedMessage: 'Tracker renderer returned a disconnected root.',
      buildCandidate: () => document.createElement('div'),
    },
    {
      name: 'an HTMLElement from another DOM realm',
      expectedMessage: 'Tracker renderer returned a root from another DOM realm.',
      buildCandidate: () => {
        const iframe = document.createElement('iframe');

        document.body.appendChild(iframe);

        const otherDocument = iframe.contentDocument!;
        const otherRoot = otherDocument.createElement('div');

        otherDocument.body.appendChild(otherRoot);

        return otherRoot;
      },
    },
    {
      name: 'an HTMLElement other than the exact expected root',
      expectedMessage: 'Tracker root renderer must return the exact expected root.',
      buildCandidate: () => {
        const unexpectedRoot = document.createElement('div');

        document.body.appendChild(unexpectedRoot);

        return unexpectedRoot;
      },
    },
  ])(
    'rejects a root renderer that returns $name and leaves the instance unmounted',
    ({ expectedMessage, buildCandidate }) => {
      const expectedRoot = document.createElement('div');
      let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

      document.body.appendChild(expectedRoot);
      instance = createTrackerIntegrationInstance(
        {
          options: {
            updates: {
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
              interval: { enabled: false },
            },
          },
          rules: [],
        },
        {
          getInstance: () => instance,
          renderer: {
            destroy: vi.fn(),
            mount: () => buildCandidate(),
          },
        },
      );

      expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root: expectedRoot } })).toThrow(
        expectedMessage,
      );
      expect(instance.mounted).toBe(false);
      // Every documented renderer-result guard runs before registry insertion,
      // so an invalid result must never leave an active registration behind.
      expect(getInternalDomRegistry(document).activeCount).toBe(0);

      destroyTrackerInstance(instance);
    },
  );

  it('rejects a renderer root that contains the configured sourceRoot', () => {
    const renderRoot = document.createElement('div');
    const sourceRoot = document.createElement('div');
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    renderRoot.appendChild(sourceRoot);
    document.body.appendChild(renderRoot);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      {
        getInstance: () => instance,
        renderer: {
          destroy: vi.fn(),
          mount: () => renderRoot,
        },
      },
    );

    expect(() =>
      mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root: renderRoot }, sourceRoot }),
    ).toThrow('Tracker renderer root must not contain the configured sourceRoot.');
    expect(instance.mounted).toBe(false);
    // Ownership validation runs before registry insertion, and the
    // application-owned render root must survive the rejection untouched.
    expect(renderRoot.isConnected).toBe(true);
    expect(getInternalDomRegistry(document).activeCount).toBe(0);

    destroyTrackerInstance(instance);
  });

  it('never registers or removes an unrelated exposed renderer root', () => {
    const host = document.createElement('div');
    const unrelatedRoot = document.createElement('div');
    let candidate: HTMLElement | null = null;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.append(host, unrelatedRoot);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      {
        getInstance: () => instance,
        renderer: {
          destroy: vi.fn(),
          mount(context) {
            const target = context.target.kind === 'host' ? context.target.host : context.target.root;

            candidate = context.document.createElement('div');
            target.appendChild(candidate);

            return candidate;
          },
          get root() {
            return unrelatedRoot;
          },
        },
      },
    );

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'host', host } })).toThrow(
      'Renderer returned a root that differs from its exposed root property.',
    );
    expect((candidate as HTMLElement | null)?.isConnected).toBe(false);
    expect(unrelatedRoot.isConnected).toBe(true);
    expect(getInternalDomRegistry(document).isNodeExcluded(unrelatedRoot)).toBe(false);
    expect(getInternalDomRegistry(document).activeCount).toBe(0);

    destroyTrackerInstance(instance);
  });
});
