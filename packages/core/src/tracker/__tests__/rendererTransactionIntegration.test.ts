// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES } from '../../events/eventNames.js';
import { createTrackerIntegrationInstance } from '../integration.js';
import { destroyTrackerInstance, mountTrackerInstance } from '../lifecycle.js';
import { registerTrackerRendererTransaction } from '../rendererTransaction.js';
import { performTrackerSelectionTransition } from '../selection.js';

/** Clears connected roots and mock state after every transaction scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('core renderer transaction boundaries', () => {
  it('commits standalone selection rendering before publishing selection:change', () => {
    const root = document.createElement('div');
    const sequence: string[] = [];
    const source = {
      mount: () => root,
      renderSelection: (previousKey: string | null, nextKey: string | null) => {
        sequence.push(`selection:${String(previousKey)}:${String(nextKey)}`);
      },
    };

    registerTrackerRendererTransaction(source, {
      begin: () => sequence.push('begin'),
      commit: () => sequence.push('commit'),
      rollback: () => sequence.push('rollback'),
      updateMount: vi.fn(),
    });
    document.body.append(root);

    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createTrackerIntegrationInstance({}, { getInstance: () => instance, renderer: source });
    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });
    sequence.length = 0;

    // The public selection observer appends to the same probe so its ordering
    // relative to the renderer transaction is asserted directly.
    const selectionHandler = vi.fn(() => {
      sequence.push('event:selection');
    });

    instance.events.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    performTrackerSelectionTransition(instance, { nextKey: 'marker:after', previousKey: 'marker:before' }, 'selection');

    expect(sequence).toEqual(['begin', 'selection:marker:before:marker:after', 'commit', 'event:selection']);
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(selectionHandler).toHaveBeenCalledWith({
      previousKey: 'marker:before',
      selectedKey: 'marker:after',
    });

    destroyTrackerInstance(instance);
  });

  it('rolls back failed selection rendering before publishing the logical selection transition', () => {
    const root = document.createElement('div');
    const sequence: string[] = [];
    const source = {
      mount: () => root,
      renderSelection: () => {
        throw new Error('selection render failed');
      },
    };

    registerTrackerRendererTransaction(source, {
      begin: () => sequence.push('begin'),
      commit: () => sequence.push('commit'),
      rollback: () => sequence.push('rollback'),
      updateMount: vi.fn(),
    });
    document.body.append(root);

    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createTrackerIntegrationInstance({}, { getInstance: () => instance, renderer: source });
    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });
    sequence.length = 0;

    const selectionHandler = vi.fn(() => {
      sequence.push('event:selection');
    });

    instance.events.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    performTrackerSelectionTransition(instance, { nextKey: 'marker:after', previousKey: 'marker:before' }, 'selection');

    expect(sequence).toEqual(['begin', 'rollback', 'event:selection']);
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(selectionHandler).toHaveBeenCalledWith({
      previousKey: 'marker:before',
      selectedKey: 'marker:after',
    });
    expect(instance.diagnostics.getStats().warnings.byCode['render-error']).toBe(1);

    destroyTrackerInstance(instance);
  });
});
