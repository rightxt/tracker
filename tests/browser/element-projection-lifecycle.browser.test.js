import { afterEach, describe, expect, it } from 'vitest';

import { TrackerElement } from '../../packages/element/src/TrackerElement.ts';
import '../../packages/core/src/styles/rxt-tracker.css';

/** Private Tracker tag registered only in this browser suite. */
const TRACKER_TAG = 'rxt-tracker-projection-lifecycle-test';

customElements.define(TRACKER_TAG, TrackerElement);

/** Creates one registered TrackerElement instance. */
function createTrackerElement() {
  const element = document.createElement(TRACKER_TAG);

  if (!(element instanceof TrackerElement)) {
    throw new Error('Expected a registered TrackerElement.');
  }

  return element;
}

/** Configures deterministic synchronous updates. */
function configureTrackerElement(element) {
  element.replaceOptions({
    a11y: { enabled: true, keyboard: true },
    clustering: { enabled: false },
    updates: {
      interval: { enabled: false },
      mutation: { enabled: false },
      resize: { enabled: false },
      scroll: { enabled: false },
    },
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('TrackerElement projection browser lifecycle', () => {
  it('keeps property updates synchronous while isolating root, viewport and selection DOM writes', async () => {
    const sourceRoot = document.createElement('main');
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 100; index += 1) {
      const target = document.createElement('div');

      target.className = 'element-browser-target';
      target.style.height = '8px';
      fragment.append(target);
    }

    sourceRoot.append(fragment);
    document.body.append(sourceRoot);

    const element = createTrackerElement();

    configureTrackerElement(element);
    element.replaceRules([{ selector: '.element-browser-target' }]);
    element.sourceRoot = sourceRoot;
    document.body.append(element);

    const observer = new MutationObserver(() => {});

    observer.observe(element, { attributes: true, childList: true, subtree: true });
    element.patchOptions({ placement: 'left' });
    const rootRecords = observer.takeRecords();

    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-placement')).toBe('left');
    expect(rootRecords.length).toBeLessThan(20);
    expect(rootRecords.every((record) => !record.target.classList.contains('rxtt__marker'))).toBe(true);

    element.patchOptions({ viewport: { className: 'element-browser-viewport' } });
    const viewportRecords = observer.takeRecords();

    expect(element.querySelector('.rxtt__viewport')?.classList.contains('element-browser-viewport')).toBe(true);
    // A viewport-only option change must not touch marker DOM at all. The
    // numeric ceiling below is kept as a secondary guard, but the primary
    // contract (mirrored from the root phase) is that no recorded mutation
    // targets a marker node.
    expect(viewportRecords.every((record) => !record.target.classList.contains('rxtt__marker'))).toBe(true);
    expect(viewportRecords.length).toBeLessThan(10);

    const root = element.querySelector('.rxtt');

    root?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    root?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    const selectionRecords = observer.takeRecords();
    const selectedAttributeRecords = selectionRecords.filter((record) => record.attributeName === 'data-rxtt-selected');

    expect(selectedAttributeRecords).toHaveLength(4);
    expect(selectionRecords.length - selectedAttributeRecords.length).toBeLessThanOrEqual(1);
    expect(
      selectionRecords
        .filter((record) => record.target.classList.contains('rxtt__marker'))
        .every((record) => record.attributeName === 'data-rxtt-selected'),
    ).toBe(true);
    expect(element.querySelectorAll('[data-rxtt-selected="true"]')).toHaveLength(1);

    observer.disconnect();
    element.remove();
  });

  it('preserves forwarded-event reentrancy guards and terminal destroy delivery', () => {
    const target = document.createElement('div');
    const element = createTrackerElement();
    const transactionErrors = [];
    const reportedErrors = [];
    let destroyCount = 0;

    target.className = 'element-reentrant-target';
    document.body.append(target);
    configureTrackerElement(element);
    element.patchOptions({
      diagnostics: {
        output: {
          error: (code, message, details) => reportedErrors.push({ code, details, message }),
        },
      },
    });
    element.replaceRules([{ selector: '.element-reentrant-target' }]);
    document.body.append(element);
    element.addEventListener('destroy', () => {
      destroyCount += 1;
    });
    element.addEventListener(
      'sync:start',
      () => {
        try {
          // Staged, not rejected: commits later against a still-live runtime, or
          // safely no-ops if the element.remove() below disconnects it first.
          element.patchOptions({ placement: 'left' });
        } catch (error) {
          transactionErrors.push(error);
        }

        // Reentrant disconnect from inside the still-running forwarded dispatch.
        element.remove();
      },
      { once: true },
    );

    element.render();

    expect(transactionErrors).toHaveLength(0);
    expect(destroyCount).toBe(1);
    expect(element.querySelector('.rxtt')).toBeNull();
    // The deferred patchOptions() commit runs as a safe no-op against the
    // disconnected element: no failure is reported through diagnostics.
    expect(reportedErrors).toHaveLength(0);
  });
});
