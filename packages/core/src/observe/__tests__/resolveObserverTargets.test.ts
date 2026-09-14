// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { getInternalDomRegistry } from '../../dom/internalDomRegistry.js';
import { WindowScrollContext } from '../../scroll/WindowScrollContext.js';
import type { TrackerRuntimeContext } from '../../tracker/mountContext.js';
import { resolveObserverTargets } from '../resolveObserverTargets.js';

/**
 * Creates a complete Window-mode observer context for one renderer root.
 *
 * @param renderRoot - Actual renderer root.
 * @param activeDocument - Active owner document.
 * @param activeWindow - Active owner window.
 * @returns Internal runtime context used by target resolution.
 */
function createRuntimeContext(
  renderRoot: HTMLElement,
  activeDocument: Document = document,
  activeWindow: Window = window,
): TrackerRuntimeContext {
  return {
    document: activeDocument,
    window: activeWindow,
    sourceRoot: activeDocument.body,
    scrollRoot: activeWindow,
    scrollMode: 'window',
    renderRoot,
    scrollContext: new WindowScrollContext(activeWindow),
  };
}

describe('core observer target resolution', () => {
  it('uses copied defaults when a resolver is omitted and filters invalid mutation targets', () => {
    const root = document.createElement('div');
    const text = document.createTextNode('target');
    const diagnostics = { warn: vi.fn() };

    document.body.appendChild(root);
    getInternalDomRegistry(document).register(root, 'render');

    const defaultTargets = [document.body, text, root, null as never, document.body];
    const targets = resolveObserverTargets({
      defaultTargets,
      diagnostics,
      observerType: 'mutation',
      reason: 'mount',
      runtimeContext: createRuntimeContext(root),
      targets: undefined,
    });

    expect(targets).toEqual([document.body, text]);
    expect(defaultTargets).toEqual([document.body, text, root, null, document.body]);
    expect(diagnostics.warn.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['WARN_TRACKER_OBSERVER_INVALID_TARGET', 'WARN_TRACKER_OBSERVER_INVALID_TARGET']),
    );
    expect(diagnostics.warn).not.toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_INVALID_RESULT',
      expect.any(String),
      expect.any(Object),
    );

    getInternalDomRegistry(document).release(root);
    root.remove();
  });

  it('passes the final context, copies defaults and deduplicates valid resize targets', () => {
    const root = document.createElement('div');
    const resizeTarget = document.createElement('section');
    const defaultTargets = [resizeTarget];
    const runtimeContext = createRuntimeContext(root);
    const resolver = vi.fn((context) => {
      expect(context).toMatchObject({
        observerType: 'resize',
        sourceRoot: document.body,
        scrollRoot: window,
        scrollMode: 'window',
        renderRoot: root,
        document,
        window,
        defaultTargets: [resizeTarget],
        reason: 'options:update',
      });
      expect(context.defaultTargets).not.toBe(defaultTargets);
      context.defaultTargets.length = 0;

      return [resizeTarget, resizeTarget, document.createTextNode('invalid')];
    });
    const diagnostics = { warn: vi.fn() };
    const targets = resolveObserverTargets({
      defaultTargets,
      diagnostics,
      observerType: 'resize',
      reason: 'options:update',
      runtimeContext,
      targets: resolver,
    });

    expect(targets).toEqual([resizeTarget]);
    expect(defaultTargets).toEqual([resizeTarget]);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(diagnostics.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_INVALID_TARGET',
      'Invalid resize observer target was ignored.',
      expect.objectContaining({ observerType: 'resize', reason: 'wrong-target-type' }),
    );
  });

  it('falls back to copied defaults when a resolver returns a non-array or throws', () => {
    const root = document.createElement('div');
    const fallbackTarget = document.createElement('div');
    const runtimeContext = createRuntimeContext(root);
    const diagnostics = { warn: vi.fn() };

    expect(
      resolveObserverTargets({
        defaultTargets: [fallbackTarget],
        diagnostics,
        observerType: 'resize',
        reason: 'mount',
        runtimeContext,
        targets: () => null as never,
      }),
    ).toEqual([fallbackTarget]);

    expect(
      resolveObserverTargets({
        defaultTargets: [fallbackTarget],
        diagnostics,
        observerType: 'resize',
        reason: 'mount',
        runtimeContext,
        targets: () => {
          throw new Error('failed');
        },
      }),
    ).toEqual([fallbackTarget]);

    expect(diagnostics.warn.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['WARN_TRACKER_OBSERVER_INVALID_RESULT', 'WARN_TRACKER_OBSERVER_RESOLVER_FAILED']),
    );
  });

  it('diagnoses an explicitly non-callable resolver and uses defaults', () => {
    const root = document.createElement('div');
    const fallbackTarget = document.createElement('div');
    const diagnostics = { warn: vi.fn() };

    expect(
      resolveObserverTargets({
        defaultTargets: [fallbackTarget],
        diagnostics,
        observerType: 'resize',
        reason: 'mount',
        runtimeContext: createRuntimeContext(root),
        targets: null,
      }),
    ).toEqual([fallbackTarget]);
    expect(diagnostics.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_INVALID_RESULT',
      expect.any(String),
      expect.objectContaining({ observerType: 'resize', reason: 'resolver-not-function' }),
    );
  });

  it('keeps the own render root as a resize target while excluding it as a mutation target', () => {
    const root = document.createElement('div');
    const registry = getInternalDomRegistry(document);
    const diagnostics = { warn: vi.fn() };
    const runtimeContext = createRuntimeContext(root);

    document.body.appendChild(root);
    expect(registry.register(root, 'render')).toBe(true);

    try {
      expect(
        resolveObserverTargets({
          defaultTargets: [document.body, root],
          diagnostics,
          observerType: 'resize',
          reason: 'mount',
          runtimeContext,
          targets: undefined,
        }),
      ).toEqual([document.body, root]);
      expect(diagnostics.warn).not.toHaveBeenCalled();

      expect(
        resolveObserverTargets({
          defaultTargets: [],
          diagnostics,
          observerType: 'mutation',
          reason: 'mount',
          runtimeContext,
          targets: () => [root],
        }),
      ).toEqual([]);
      expect(diagnostics.warn).toHaveBeenCalledWith(
        'WARN_TRACKER_OBSERVER_INVALID_TARGET',
        'Internal Tracker DOM cannot be used as an observer target.',
        expect.objectContaining({ observerType: 'mutation', reason: 'internal-root' }),
      );
    } finally {
      registry.release(root);
      root.remove();
    }
  });

  it('excludes internal render-root descendants from resize targets', () => {
    const root = document.createElement('div');
    const child = document.createElement('div');
    const registry = getInternalDomRegistry(document);
    const diagnostics = { warn: vi.fn() };

    root.appendChild(child);
    document.body.appendChild(root);
    expect(registry.register(root, 'render')).toBe(true);

    try {
      expect(
        resolveObserverTargets({
          defaultTargets: [],
          diagnostics,
          observerType: 'resize',
          reason: 'mount',
          runtimeContext: createRuntimeContext(root),
          targets: () => [child],
        }),
      ).toEqual([]);
      expect(diagnostics.warn).toHaveBeenCalledWith(
        'WARN_TRACKER_OBSERVER_INVALID_TARGET',
        'Internal Tracker DOM cannot be used as an observer target.',
        expect.objectContaining({ observerType: 'resize', reason: 'internal-root' }),
      );
    } finally {
      registry.release(root);
      root.remove();
    }
  });

  it('excludes observer targets from another realm', () => {
    const iframe = document.createElement('iframe');
    const diagnostics = { warn: vi.fn() };

    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument!;
    const frameWindow = iframe.contentWindow!;
    const root = frameDocument.createElement('div');

    frameDocument.body.appendChild(root);

    const targets = resolveObserverTargets({
      defaultTargets: [],
      diagnostics,
      observerType: 'mutation',
      reason: 'mount',
      runtimeContext: createRuntimeContext(root, frameDocument, frameWindow),
      targets: () => [document.body, frameDocument.body],
    });

    expect(targets).toEqual([frameDocument.body]);
    expect(diagnostics.warn).toHaveBeenCalledWith('WARN_TRACKER_OBSERVER_FOREIGN_REALM_TARGET', expect.any(String), {
      observerType: 'mutation',
    });

    iframe.remove();
  });

  it('never embeds a raw DOM node or other external reference in warning details', () => {
    const root = document.createElement('div');
    const invalidTarget = document.createTextNode('invalid');
    const runtimeContext = createRuntimeContext(root);
    const diagnostics = { warn: vi.fn() };

    resolveObserverTargets({
      defaultTargets: [],
      diagnostics,
      observerType: 'resize',
      reason: 'mount',
      runtimeContext,
      targets: () => [invalidTarget],
    });

    expect(diagnostics.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_INVALID_TARGET',
      expect.any(String),
      expect.objectContaining({
        target: {
          candidateType: 'node',
          nodeType: invalidTarget.nodeType,
          nodeName: '#text',
          ownerDocumentMatches: true,
        },
      }),
    );

    diagnostics.warn.mockClear();
    resolveObserverTargets({
      defaultTargets: [],
      diagnostics,
      observerType: 'resize',
      reason: 'mount',
      runtimeContext,
      targets: document.createElement('section') as never,
    });

    expect(diagnostics.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_INVALID_RESULT',
      expect.any(String),
      expect.objectContaining({
        reason: 'resolver-not-function',
        targets: { candidateType: 'node', nodeType: 1, nodeName: 'SECTION', ownerDocumentMatches: true },
      }),
    );

    diagnostics.warn.mockClear();
    resolveObserverTargets({
      defaultTargets: [],
      diagnostics,
      observerType: 'resize',
      reason: 'mount',
      runtimeContext,
      targets: () => document.body as never,
    });

    expect(diagnostics.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_INVALID_RESULT',
      expect.any(String),
      expect.objectContaining({
        reason: 'non-array-result',
        resolvedTargets: { candidateType: 'node', nodeType: 1, nodeName: 'BODY', ownerDocumentMatches: true },
      }),
    );

    diagnostics.warn.mock.calls.forEach(([, , details]) => {
      expect(() => JSON.stringify(details)).not.toThrow();
    });
  });

  it('safely and losslessly describes bigint, symbol, null-prototype and hostile-Proxy candidates', () => {
    const root = document.createElement('div');
    const runtimeContext = createRuntimeContext(root);
    const diagnostics = { warn: vi.fn() };
    const nullPrototypeCandidate: object = Object.create(null);
    const hostileProxyCandidate = new Proxy(
      {},
      {
        get(target, property) {
          if (property === 'constructor') {
            throw new Error('hostile constructor getter');
          }

          return Reflect.get(target, property);
        },
      },
    );

    resolveObserverTargets({
      defaultTargets: [],
      diagnostics,
      observerType: 'resize',
      reason: 'mount',
      runtimeContext,
      targets: () => [1n, Symbol('target'), nullPrototypeCandidate, hostileProxyCandidate],
    });

    const targetDescriptions = diagnostics.warn.mock.calls
      .filter(([code]) => code === 'WARN_TRACKER_OBSERVER_INVALID_TARGET')
      .map(([, , details]) => (details as { target: unknown }).target);

    expect(targetDescriptions).toEqual([
      { candidateType: 'bigint', value: '1' },
      { candidateType: 'symbol', description: 'target' },
      { candidateType: 'object', constructorName: 'Object' },
      { candidateType: 'object', constructorName: 'Unknown' },
    ]);

    targetDescriptions.forEach((description) => {
      expect(() => JSON.stringify(description)).not.toThrow();
    });
  });
});
