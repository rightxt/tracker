// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackerNormalizedRule } from '../../types.js';
import { QueryEngine } from '../QueryEngine.js';

/**
 * Creates a normalized rule stub with the given selector.
 *
 * @param selector - CSS selector.
 * @returns Normalized rule stub.
 */
function createRule(selector: string): TrackerNormalizedRule {
  return { selector } as TrackerNormalizedRule;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('core query engine', () => {
  it('matches elements per rule in priority order', () => {
    document.body.innerHTML = '<p class="first"></p><p class="second"></p><p class="first"></p>';

    const engine = new QueryEngine({ root: document });
    const matches = engine.query([createRule('.first'), createRule('.second')]);

    expect(matches).toHaveLength(3);
    expect(matches.map((match) => match.ruleIndex)).toEqual([0, 0, 1]);
    expect(matches[0].element.className).toBe('first');
    expect(matches[2].element.className).toBe('second');
  });

  it('reflects a DOM change made between two query() calls on the same engine', () => {
    document.body.innerHTML = '<p></p>';

    const target = document.querySelector('p')!;
    const engine = new QueryEngine({ root: document });

    expect(engine.query([createRule('.tracked')])).toHaveLength(0);

    target.classList.add('tracked');

    // query() performs a full live-DOM query on every call; it carries no
    // state between calls, so nothing needs to be told what changed.
    expect(engine.query([createRule('.tracked')])).toHaveLength(1);
  });

  it('returns no matches for missing or empty rule lists', () => {
    const engine = new QueryEngine({ root: document });

    expect(engine.query([])).toEqual([]);
    expect(engine.query(null as never)).toEqual([]);
  });

  it('reports invalid selectors and continues with remaining rules', () => {
    document.body.innerHTML = '<p class="first"></p>';

    const diagnostics = { error: vi.fn() };
    const engine = new QueryEngine({ diagnostics, root: document });
    const matches = engine.query([createRule(':::broken'), createRule('.first')]);

    expect(matches).toHaveLength(1);
    expect(diagnostics.error).toHaveBeenCalledTimes(1);
    expect(diagnostics.error).toHaveBeenCalledWith(
      'query-selector-error',
      expect.stringContaining(':::broken'),
      expect.objectContaining({ selector: ':::broken' }),
    );
  });

  it('prefers the dynamic root over the static root', () => {
    document.body.innerHTML = '<p class="outside"></p>';

    const staticRoot = document.createElement('div');
    const dynamicRoot = document.createElement('div');

    staticRoot.innerHTML = '<p class="inside"></p>';
    dynamicRoot.innerHTML = '<p class="inside"></p><p class="inside"></p>';
    document.body.append(staticRoot, dynamicRoot);

    const engine = new QueryEngine({
      root: staticRoot,
      getRoot: () => dynamicRoot,
    });

    expect(engine.query([createRule('p')])).toHaveLength(2);
  });

  it('does not fall back to another root when the authoritative provider is unusable', () => {
    const staticRoot = document.createElement('div');

    staticRoot.innerHTML = '<p class="inside"></p>';

    const engine = new QueryEngine({
      root: staticRoot,
      getRoot: () => null,
    });

    expect(engine.query([createRule('p')])).toHaveLength(0);
  });

  it('returns no matches without an explicit root instead of an ambient document fallback', () => {
    document.body.innerHTML = '<p class="in-document"></p>';

    const documentQuery = vi.spyOn(document, 'querySelectorAll');
    const engine = new QueryEngine();

    expect(engine.query([createRule('.in-document')])).toEqual([]);
    expect(documentQuery).not.toHaveBeenCalled();
  });

  it('filters out elements from a disconnected root subtree at render time', () => {
    const detachedRoot = document.createElement('div');

    detachedRoot.innerHTML = '<p class="inside"></p>';

    const engine = new QueryEngine({ root: detachedRoot });

    expect(engine.query([createRule('.inside')])).toEqual([]);
  });

  it('filters out connected elements outside the composed subtree of the active root', () => {
    const root = document.createElement('div');
    const outside = document.createElement('p');

    outside.className = 'match';
    root.innerHTML = '<p class="match"></p>';
    document.body.append(root, outside);

    // Simulates a reparent between selector search and render-time filtering.
    vi.spyOn(root, 'querySelectorAll').mockReturnValue([
      root.firstElementChild,
      outside,
    ] as unknown as NodeListOf<Element>);

    const matches = new QueryEngine({ root }).query([createRule('.match')]);

    expect(matches).toHaveLength(1);
    expect(matches[0].element).toBe(root.firstElementChild);
  });

  it('keeps elements inside an open ShadowRoot query root', () => {
    const host = document.createElement('div');

    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const inside = document.createElement('p');

    inside.className = 'shadow-match';
    shadowRoot.appendChild(inside);

    const matches = new QueryEngine({ root: shadowRoot }).query([createRule('.shadow-match')]);

    expect(matches).toHaveLength(1);
    expect(matches[0].element).toBe(inside);
  });

  it('updates and explicitly clears dynamic root providers through context patches', () => {
    const initialRoot = document.createElement('div');
    const nextRoot = document.createElement('div');

    initialRoot.innerHTML = '<p></p>';
    nextRoot.innerHTML = '<p></p><p></p>';
    document.body.append(initialRoot, nextRoot);

    const initialProvider = vi.fn(() => initialRoot);
    const engine = new QueryEngine({ getRoot: initialProvider });

    engine.updateContext({ getRoot: () => nextRoot });

    expect(engine.query([createRule('p')])).toHaveLength(2);

    engine.updateContext({ root: nextRoot, getRoot: null as never });

    expect(engine.query([createRule('p')])).toHaveLength(2);
    expect(initialProvider).not.toHaveBeenCalled();
  });

  it('releases context references on destroy', () => {
    const staticRoot = document.createElement('div');

    staticRoot.innerHTML = '<p></p>';
    document.body.innerHTML = '<p></p>';
    const documentQuery = vi.spyOn(document, 'querySelectorAll');

    const engine = new QueryEngine({ root: staticRoot });

    engine.destroy();

    expect(engine.query([createRule('p')])).toEqual([]);
    expect(documentQuery).not.toHaveBeenCalled();
  });
});
