// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createConnectedElement } from '../../__tests__/support/connectedElement.js';
import { normalizeTrackerMountRequest } from '../mountContext.js';

/** Removes test-owned roots after each normalization scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('mount-context normalization', () => {
  it('applies Window defaults without ambient renderer-target inference', () => {
    const renderRoot = createConnectedElement();
    const normalized = normalizeTrackerMountRequest({
      rendererTarget: { kind: 'root', root: renderRoot },
    });

    expect(normalized).toMatchObject({
      sourceRoot: document.body,
      scrollRoot: window,
      rendererTarget: { kind: 'root', root: renderRoot },
      document,
      window,
      scrollMode: 'window',
    });
  });

  it.each(['body', 'documentElement', 'scrollingElement'] as const)(
    'normalizes the %s page-scroller alias to its owner Window',
    (aliasName) => {
      const renderRoot = createConnectedElement();
      const alias = document[aliasName];

      // Every page-scroller alias must resolve to a real element for this
      // normalization contract to be exercised; a missing alias fails the test
      // instead of silently passing.
      expect(alias).not.toBeNull();

      const normalized = normalizeTrackerMountRequest({
        rendererTarget: { kind: 'root', root: renderRoot },
        scrollRoot: alias as HTMLElement,
      });

      expect(normalized.scrollRoot).toBe(window);
      expect(normalized.scrollMode).toBe('window');
    },
  );

  it('keeps an explicit Document source root in the target realm', () => {
    const renderRoot = createConnectedElement();
    const normalized = normalizeTrackerMountRequest({
      sourceRoot: document,
      rendererTarget: { kind: 'root', root: renderRoot },
    });

    expect(normalized.sourceRoot).toBe(document);
  });

  it('reports an unavailable default body source before DOM readiness', () => {
    const iframe = document.createElement('iframe');

    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument!;
    const renderRoot = frameDocument.createElement('div');

    frameDocument.body.remove();
    frameDocument.head.appendChild(renderRoot);

    expect(() =>
      normalizeTrackerMountRequest({
        rendererTarget: { kind: 'root', root: renderRoot },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_INVALID_CONTEXT',
        message: expect.stringContaining('document.body is unavailable'),
      }),
    );
  });

  it('accepts a composed open ShadowRoot source inside an element scroll root', () => {
    const scrollRoot = document.createElement('section');
    const host = document.createElement('div');
    const renderRoot = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });

    scrollRoot.appendChild(host);
    document.body.append(scrollRoot, renderRoot);

    const normalized = normalizeTrackerMountRequest({
      sourceRoot: shadowRoot,
      scrollRoot,
      rendererTarget: { kind: 'root', root: renderRoot },
    });

    expect(normalized).toMatchObject({ sourceRoot: shadowRoot, scrollRoot, scrollMode: 'element' });
  });

  it('rejects an element-mode source outside the authoritative scroll root', () => {
    const scrollRoot = document.createElement('section');
    const sourceRoot = document.createElement('div');
    const renderRoot = document.createElement('div');

    document.body.append(scrollRoot, sourceRoot, renderRoot);

    expect(() =>
      normalizeTrackerMountRequest({
        sourceRoot,
        scrollRoot,
        rendererTarget: { kind: 'root', root: renderRoot },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_INVALID_CONTEXT',
        name: 'TrackerLifecycleError',
      }),
    );
  });

  it.each([
    ['null', null],
    ['arbitrary DocumentFragment', document.createDocumentFragment()],
    ['detached Element', document.createElement('div')],
  ])('rejects an explicit %s source with the invalid-context code', (_name, sourceRoot) => {
    const renderRoot = createConnectedElement();

    expect(() =>
      normalizeTrackerMountRequest({
        sourceRoot: sourceRoot as never,
        rendererTarget: { kind: 'root', root: renderRoot },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_INVALID_CONTEXT',
        name: 'TrackerLifecycleError',
      }),
    );
  });

  it('rejects a detached render root before renderer mount', () => {
    const renderRoot = document.createElement('div');

    expect(() => normalizeTrackerMountRequest({ rendererTarget: { kind: 'root', root: renderRoot } })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }),
    );
  });

  it('rejects source and scroll roots from another realm with the realm code', () => {
    const iframe = document.createElement('iframe');
    const renderRoot = createConnectedElement();

    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument!;

    expect(() =>
      normalizeTrackerMountRequest({
        sourceRoot: frameDocument.body,
        rendererTarget: { kind: 'root', root: renderRoot },
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH' }));
    expect(() =>
      normalizeTrackerMountRequest({
        scrollRoot: frameDocument.body,
        rendererTarget: { kind: 'root', root: renderRoot },
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH' }));
  });

  it('normalizes a same-origin iframe request entirely inside its own realm', () => {
    const iframe = document.createElement('iframe');

    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument!;
    const frameWindow = iframe.contentWindow!;
    const renderRoot = frameDocument.createElement('div');

    frameDocument.body.appendChild(renderRoot);

    const normalized = normalizeTrackerMountRequest({
      sourceRoot: frameDocument.body,
      scrollRoot: frameWindow,
      rendererTarget: { kind: 'root', root: renderRoot },
    });

    expect(normalized).toMatchObject({
      sourceRoot: frameDocument.body,
      scrollRoot: frameWindow,
      document: frameDocument,
      window: frameWindow,
      scrollMode: 'window',
    });
  });
});
