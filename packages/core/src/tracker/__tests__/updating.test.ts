// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES, createTrackerStateIntegration } from '../../__tests__/testIntegration.js';

/**
 * Creates a mounted runtime with three keyboard-addressable markers.
 *
 * @param a11yEnabled - Initial accessibility keyboard mode.
 * @returns Runtime and connected source/target elements.
 */
function createMountedKeyboardRuntime(a11yEnabled: boolean) {
  const first = document.createElement('div');
  const second = document.createElement('div');
  const third = document.createElement('div');
  const target = document.createElement('div');
  const runtime = createTrackerStateIntegration({
    options: {
      a11y: {
        enabled: a11yEnabled,
        keyboard: a11yEnabled,
      },
      clustering: {
        enabled: false,
      },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    },
    rules: [
      { scroll: false, selector: '.first-target' },
      { scroll: false, selector: '.second-target' },
      { scroll: false, selector: '.third-target' },
    ],
  });

  first.className = 'first-target';
  second.className = 'second-target';
  third.className = 'third-target';
  document.body.append(first, second, third, target);
  runtime.mount({ renderRoot: target });

  return { first, runtime, second, target, third };
}

describe('performTrackerInstanceOptionsUpdate selection transitions under render:false', () => {
  it('commits and publishes a selection transition immediately when enabling keyboard selection with render:false', () => {
    const { first, runtime, second, target, third } = createMountedKeyboardRuntime(false);
    const selectionHandler = vi.fn();
    const firstKey = runtime.getSnapshotProps().items[0]!.activationKey;
    const rendersBefore = runtime.getStats().renders;

    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    runtime.patchOptions({ a11y: { enabled: true, keyboard: true } }, { render: false });

    // The logical transition (null -> firstKey) is committed and published
    // immediately and exactly once, even though presentation stays deferred.
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(selectionHandler).toHaveBeenCalledWith({ previousKey: null, selectedKey: firstKey });
    expect(runtime.getSnapshot().selection).toEqual({ enabled: true, key: firstKey });
    expect(runtime.getSnapshot().render.dirtyTarget).toBe('all');
    expect(runtime.getStats().renders.requested).toBe(rendersBefore.requested);

    // A later real render must not re-emit the already-committed transition.
    runtime.render();
    expect(selectionHandler).toHaveBeenCalledTimes(1);

    runtime.destroy();
    first.remove();
    second.remove();
    third.remove();
    target.remove();
  });

  it('commits and publishes a selection transition immediately when disabling keyboard selection with render:false', () => {
    const { first, runtime, second, target, third } = createMountedKeyboardRuntime(true);
    const selectionHandler = vi.fn();
    const firstKey = runtime.getSnapshotProps().items[0]!.activationKey;
    const rendersBefore = runtime.getStats().renders;

    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    runtime.patchOptions({ a11y: { enabled: false, keyboard: false } }, { render: false });

    // The logical transition (firstKey -> null) is committed and published
    // immediately and exactly once, even though presentation stays deferred.
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(selectionHandler).toHaveBeenCalledWith({ previousKey: firstKey, selectedKey: null });
    expect(runtime.getSnapshot().selection).toEqual({ enabled: false, key: null });
    expect(runtime.getSnapshot().render.dirtyTarget).toBe('all');
    expect(runtime.getStats().renders.requested).toBe(rendersBefore.requested);

    // A later real render must not re-emit the already-committed transition.
    runtime.render();
    expect(selectionHandler).toHaveBeenCalledTimes(1);

    runtime.destroy();
    first.remove();
    second.remove();
    third.remove();
    target.remove();
  });

  it('keeps applying the selection transition through the renderer when render defaults to true', () => {
    const { first, runtime, second, target, third } = createMountedKeyboardRuntime(false);
    const selectionHandler = vi.fn();
    const firstKey = runtime.getSnapshotProps().items[0]!.activationKey;

    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    runtime.patchOptions({ a11y: { enabled: true, keyboard: true } });

    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(selectionHandler).toHaveBeenCalledWith({ previousKey: null, selectedKey: firstKey });
    expect(runtime.getSnapshot().render.dirtyTarget).toBeNull();

    runtime.destroy();
    first.remove();
    second.remove();
    third.remove();
    target.remove();
  });
});
