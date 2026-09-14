// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InternalDomRegistry, getInternalDomRegistry } from '../internalDomRegistry.js';
import { QueryEngine } from '../../query/QueryEngine.js';

/**
 * Creates a minimal child-list mutation record.
 *
 * @param target - Mutation target.
 * @param addedNodes - Added nodes.
 * @param removedNodes - Removed nodes.
 * @returns Mutation record stub.
 */
function createChildListMutation(target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []): MutationRecord {
  return {
    addedNodes,
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    oldValue: null,
    previousSibling: null,
    removedNodes,
    target,
    type: 'childList',
  } as unknown as MutationRecord;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('InternalDomRegistry', () => {
  it('uses one weakly keyed registry per document', () => {
    const otherDocument = document.implementation.createHTMLDocument('Other');

    expect(getInternalDomRegistry(document)).toBe(getInternalDomRegistry(document));
    expect(getInternalDomRegistry(otherDocument)).not.toBe(getInternalDomRegistry(document));
    expect(getInternalDomRegistry(document)).toBeInstanceOf(InternalDomRegistry);
  });

  it('excludes active roots and descendants until release', () => {
    const registry = getInternalDomRegistry(document);
    const root = document.createElement('div');
    const child = document.createElement('span');

    root.appendChild(child);

    expect(registry.register(root, 'probe')).toBe(true);
    document.body.appendChild(root);

    expect(registry.activeCount).toBe(1);
    expect(registry.isNodeExcluded(root)).toBe(true);
    expect(registry.isNodeExcluded(child)).toBe(true);

    registry.release(root);

    expect(registry.activeCount).toBe(0);
    expect(registry.isNodeExcluded(root)).toBe(false);
    expect(registry.isNodeExcluded(child)).toBe(false);
  });

  it('retains disconnected roots only through one task checkpoint', () => {
    const registry = getInternalDomRegistry(document);
    const root = document.createElement('div');
    const child = document.createElement('span');

    root.appendChild(child);
    registry.register(root, 'probe');
    document.body.appendChild(root);
    root.remove();
    registry.retire(root);

    expect(registry.activeCount).toBe(0);
    expect(registry.isNodeExcluded(root)).toBe(false);
    expect(registry.isNodeRetired(root)).toBe(true);
    expect(registry.isNodeRetired(child)).toBe(true);
    expect(registry.isMutationInternal(createChildListMutation(document.body, [], [root]))).toBe(true);

    vi.runOnlyPendingTimers();

    expect(registry.isNodeRetired(root)).toBe(false);
    expect(registry.isNodeRetired(child)).toBe(false);
  });

  it('schedules and clears retirement through the owning document realm', () => {
    const iframe = document.createElement('iframe');

    document.body.appendChild(iframe);

    const childDocument = iframe.contentDocument;
    const childWindow = iframe.contentWindow;

    if (childDocument === null || childWindow === null) {
      throw new Error('Expected an iframe browsing context.');
    }

    const setTimeoutSpy = vi.spyOn(childWindow, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(childWindow, 'clearTimeout');
    const registry = getInternalDomRegistry(childDocument);
    const root = childDocument.createElement('div');

    registry.register(root, 'probe');
    registry.retire(root);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    registry.release(root);

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    iframe.remove();
  });

  it('falls back when a discarded document realm rejects new timer tasks', () => {
    const iframe = document.createElement('iframe');

    document.body.appendChild(iframe);

    const childDocument = iframe.contentDocument;
    const childWindow = iframe.contentWindow;

    if (childDocument === null || childWindow === null) {
      throw new Error('Expected an iframe browsing context.');
    }

    const scheduleError = new Error('Document realm is unavailable.');
    const childSetTimeoutSpy = vi.spyOn(childWindow, 'setTimeout').mockImplementation(() => {
      throw scheduleError;
    });
    const fallbackSetTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const registry = getInternalDomRegistry(childDocument);
    const root = childDocument.createElement('div');

    registry.register(root, 'probe');
    registry.retire(root);

    expect(childSetTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(fallbackSetTimeoutSpy).toHaveBeenCalledTimes(1);

    registry.release(root);
    iframe.remove();
  });

  it('releases disconnected quarantine lazily without a monitor', () => {
    const registry = getInternalDomRegistry(document);
    const root = document.createElement('div');

    document.body.appendChild(root);
    registry.quarantine(root);

    expect(registry.getRegistrationState(root)).toBe('quarantined');

    root.remove();

    expect(vi.getTimerCount()).toBe(0);
    expect(registry.getRegistrationState(root)).toBeNull();
    expect(registry.activeCount).toBe(0);
  });

  it('keeps active internal roots out of ordinary source queries', () => {
    const registry = getInternalDomRegistry(document);
    const internalRoot = document.createElement('div');
    const internalMatch = document.createElement('div');
    const externalMatch = document.createElement('div');
    const engine = new QueryEngine({ root: document });

    internalMatch.className = 'match';
    externalMatch.className = 'match';
    internalRoot.appendChild(internalMatch);
    registry.register(internalRoot, 'probe');
    document.body.append(internalRoot, externalMatch);

    const matches = engine.query([{ selector: '.match' }] as never);

    expect(matches.map(({ element }) => element)).toEqual([externalMatch]);

    registry.release(internalRoot);
    engine.destroy();
  });
});
