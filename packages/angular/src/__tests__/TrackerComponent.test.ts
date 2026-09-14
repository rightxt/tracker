// @vitest-environment jsdom

import '@angular/compiler';

import { provideZonelessChangeDetection } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { TrackerComponent } from '../TrackerComponent.js';
import { defineTrackerComponentTests, ensureTestResizeObserver } from './projectionComponentTestBody.js';
import { RETHROWING_TEST_ERROR_HANDLER_PROVIDER } from './testErrorHandler.js';

import type { MountedTrackerComponent } from './projectionComponentTestBody.js';

/** Bootstraps one zoneless Tracker fixture. */
async function mountTracker(): Promise<MountedTrackerComponent<TrackerComponent>> {
  ensureTestResizeObserver();
  const application = await createApplication({
    providers: [provideZonelessChangeDetection(), RETHROWING_TEST_ERROR_HANDLER_PROVIDER],
  });
  const host = document.createElement('rxt-tracker-angular-test');

  document.body.appendChild(host);

  const component = application.bootstrap(TrackerComponent, host);
  const detectChanges = (): void => component.changeDetectorRef.detectChanges();

  detectChanges();
  await Promise.resolve();
  detectChanges();

  return { application, component, detectChanges, host };
}

defineTrackerComponentTests(mountTracker);

/** Options isolating synchronous item and selection behavior. */
const TEST_OPTIONS = {
  a11y: { enabled: true, keyboard: true },
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
} as const;

/**
 * Angular-specific ownership of the projected item layer: the zoneless adapter is
 * the final owner of keyed marker-node identity across selection and presentation
 * updates. Event emission, pointer activation, and cross-adapter parity are owned
 * by Browser Mode.
 */
describe('Angular TrackerComponent item ownership', () => {
  it('keeps item nodes stable and mutates only the selected attributes', async () => {
    const sourceRoot = document.createElement('main');

    ['a', 'b', 'c'].forEach((suffix) => {
      const target = document.createElement('div');

      target.className = 'angular-selection-target';
      target.dataset.suffix = suffix;
      sourceRoot.append(target);
    });
    document.body.append(sourceRoot);

    const mounted = await mountTracker();

    mounted.component.setInput('options', TEST_OPTIONS);
    mounted.component.setInput('rules', [{ selector: '.angular-selection-target' }]);
    mounted.component.setInput('sourceRoot', sourceRoot);
    mounted.detectChanges();
    mounted.component.instance.refresh();
    mounted.detectChanges();
    await Promise.resolve();
    mounted.detectChanges();

    const trackerRoot = mounted.host.querySelector('.rxtt');
    const markers = Array.from(mounted.host.querySelectorAll<HTMLElement>('.rxtt__marker'));

    expect(markers).toHaveLength(3);

    const keys = markers.map((marker) => marker.getAttribute('data-rxtt-key'));

    expect(keys.every((key) => typeof key === 'string' && key !== '')).toBe(true);

    const assertOnlySelected = (expectedIndex: number): void => {
      const current = Array.from(mounted.host.querySelectorAll<HTMLElement>('.rxtt__marker'));

      // A selection transition never replaces, reorders, or re-keys a marker node.
      expect(current).toEqual(markers);
      expect(current.map((marker) => marker.getAttribute('data-rxtt-key'))).toEqual(keys);
      current.forEach((marker, index) => {
        expect(marker.getAttribute('data-rxtt-selected')).toBe(index === expectedIndex ? 'true' : null);
      });
    };

    // Deterministic initial auto-selection is the first keyed marker.
    assertOnlySelected(0);

    trackerRoot?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    mounted.detectChanges();
    await Promise.resolve();
    mounted.detectChanges();
    assertOnlySelected(1);

    trackerRoot?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    mounted.detectChanges();
    await Promise.resolve();
    mounted.detectChanges();
    assertOnlySelected(2);

    mounted.application.destroy();
    mounted.host.remove();
    sourceRoot.remove();
  });

  it('updates marker presentation without replacing keyed item nodes', async () => {
    const target = document.createElement('div');

    target.className = 'angular-presentation-target';
    document.body.append(target);

    const mounted = await mountTracker();

    mounted.component.setInput('options', { ...TEST_OPTIONS, marker: { className: 'before' } });
    mounted.component.setInput('rules', [{ selector: '.angular-presentation-target' }]);
    mounted.detectChanges();
    mounted.component.instance.refresh();
    mounted.detectChanges();
    await Promise.resolve();
    mounted.detectChanges();

    const marker = mounted.host.querySelector<HTMLElement>('.rxtt__marker');

    expect(marker).toBeInstanceOf(HTMLElement);
    expect(marker?.classList.contains('before')).toBe(true);

    const markerKey = marker?.getAttribute('data-rxtt-key');

    expect(typeof markerKey).toBe('string');
    expect(markerKey).not.toBe('');

    // An immutable options replacement carrying only a new marker className.
    mounted.component.setInput('options', { ...TEST_OPTIONS, marker: { className: 'after' } });
    mounted.detectChanges();
    await Promise.resolve();
    mounted.detectChanges();

    const updatedMarker = mounted.host.querySelector<HTMLElement>('.rxtt__marker');

    // The exact same keyed HTMLElement is reused; only its presentation classes change.
    expect(updatedMarker).toBe(marker);
    expect(updatedMarker?.getAttribute('data-rxtt-key')).toBe(markerKey);
    expect(updatedMarker?.isConnected).toBe(true);
    expect(updatedMarker?.classList.contains('after')).toBe(true);
    expect(updatedMarker?.classList.contains('before')).toBe(false);

    mounted.application.destroy();
    mounted.host.remove();
    target.remove();
  });
});
