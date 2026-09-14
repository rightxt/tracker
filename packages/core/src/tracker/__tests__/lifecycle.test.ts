// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createTrackerInstance } from '../createTrackerInstance.js';
import { destroyTrackerInstance, mountTrackerInstance } from '../lifecycle.js';
import { emitTrackerInstanceSnapshot, subscribeTrackerInstanceSnapshot } from '../snapshotStore.js';

describe('core tracker destroy', () => {
  it('releases the diagnostics output sink reference after destroy', () => {
    const output = { warn: vi.fn() };
    const instance = createTrackerInstance({ options: { diagnostics: { output } }, rules: [] });

    destroyTrackerInstance(instance);

    expect(instance.options.diagnostics?.output).toBeNull();
    expect(instance.rendererOptions.diagnostics?.output).toBeNull();
  });
});

describe('core tracker mount reentrancy', () => {
  it('rejects a queued mount whose sourceRoot was disconnected while the call awaited its dispatch boundary', () => {
    const sourceRoot = document.createElement('div');
    const renderRoot = document.createElement('div');

    document.body.append(sourceRoot, renderRoot);

    const renderer = {
      root: renderRoot,
      mount: vi.fn(() => renderRoot),
      unmount: vi.fn(),
      destroy: vi.fn(),
      renderMarkers: vi.fn(),
      renderTrack: vi.fn(),
      renderViewport: vi.fn(),
      updateContext: vi.fn(),
    };
    const instance = createTrackerInstance({ rules: [] }, { renderer });
    let reentered = false;

    // A snapshot subscriber runs inside a public dispatch, so a mount() call issued
    // from it is queued rather than run immediately (see coordinateTrackerOperation).
    subscribeTrackerInstanceSnapshot(instance, () => {
      if (reentered) {
        return;
      }

      reentered = true;
      mountTrackerInstance(instance, {
        rendererTarget: { kind: 'root', root: renderRoot },
        sourceRoot,
      });
      sourceRoot.remove();
    });

    emitTrackerInstanceSnapshot(instance);

    expect(instance.mounted).toBe(false);
    expect(instance.lifecycleState).toBe('unmounted');
    expect(instance.runtimeContext).toBeNull();
  });
});
