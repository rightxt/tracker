import { afterEach, describe, expect, it } from 'vitest';

import { CLASS_NAMES } from '../../packages/core/src/renderer.ts';
import { TrackerElement, defineTrackerElement } from '../../packages/element/src/index.ts';

defineTrackerElement();

/** Creates one mounted Element fixture with deterministic update sources. */
function mountTransactionElement(sourceRoot) {
  const errors = [];
  const element = document.createElement('rxt-tracker');

  if (!(element instanceof TrackerElement)) {
    throw new Error('Expected a registered TrackerElement.');
  }

  element.replaceOptions({
    clustering: { enabled: false },
    diagnostics: {
      output: {
        error: (code, message, details) => errors.push({ code, details, message }),
      },
    },
    placement: 'right',
    updates: {
      interval: { enabled: false },
      mutation: { enabled: false },
      resize: { enabled: false },
      scroll: { enabled: false },
    },
  });
  element.replaceRules([{ selector: '.forwarded-browser-target' }]);
  element.sourceRoot = sourceRoot;
  document.body.appendChild(element);

  return { element, errors };
}

/** Removes browser fixtures after each transaction scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('Element forwarded-event transactions', () => {
  it('preserves sourceRoot A -> B -> A FIFO semantics within one forwarded event', () => {
    const firstSourceRoot = document.createElement('main');
    const secondSourceRoot = document.createElement('main');
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');

    firstTarget.className = 'forwarded-browser-target';
    secondTarget.className = 'forwarded-browser-target';
    firstSourceRoot.appendChild(firstTarget);
    secondSourceRoot.appendChild(secondTarget);
    document.body.append(firstSourceRoot, secondSourceRoot);

    const { element, errors } = mountTransactionElement(firstSourceRoot);

    element.addEventListener(
      'sync:end',
      () => {
        element.sourceRoot = secondSourceRoot;
        element.sourceRoot = firstSourceRoot;

        expect(element.sourceRoot).toBe(firstSourceRoot);
      },
      { once: true },
    );

    element.render();

    expect(element.sourceRoot).toBe(firstSourceRoot);
    expect(element.querySelectorAll(`.${CLASS_NAMES.MARKER}`)).toHaveLength(1);
    expect(errors).toHaveLength(0);
    element.remove();
  });

  it('orders patchOptions(render:false) before a later render() through the single Core FIFO', () => {
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');

    target.className = 'forwarded-browser-target';
    sourceRoot.appendChild(target);
    document.body.appendChild(sourceRoot);

    const { element, errors } = mountTransactionElement(sourceRoot);

    element.addEventListener(
      'sync:end',
      () => {
        element.patchOptions({ placement: 'left' }, { render: false });
        element.render();
      },
      { once: true },
    );

    element.render();

    expect(element.getOptions().placement).toBe('left');
    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-placement')).toBe('left');
    expect(errors).toHaveLength(0);
    element.remove();
  });

  it('keeps the later of two patchOptions() calls when a synchronous reconnect happens between them (FINAL-001)', () => {
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');

    target.className = 'forwarded-browser-target';
    sourceRoot.appendChild(target);
    document.body.append(sourceRoot, containerA, containerB);

    const { element, errors } = mountTransactionElement(sourceRoot);

    element.remove();
    containerA.appendChild(element);

    element.addEventListener(
      'sync:end',
      () => {
        element.patchOptions({ placement: 'left' });
        containerB.appendChild(element);
        element.patchOptions({ placement: 'right' });
      },
      { once: true },
    );

    element.render();

    expect(element.getOptions().placement).toBe('right');
    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-placement')).toBe('right');
    expect(element.parentElement).toBe(containerB);

    // A later explicit render must not flip the committed value back.
    element.render();
    expect(element.getOptions().placement).toBe('right');
    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-placement')).toBe('right');

    expect(errors).toHaveLength(0);
    element.remove();
  });

  it('keeps the third of three sourceRoot generations, never left settled on the second after a mid-flight reconnect (FINAL-001)', () => {
    const sourceRootA = document.createElement('main');
    const sourceRootB = document.createElement('main');
    const sourceRootC = document.createElement('main');
    const targetA = document.createElement('div');
    const targetB = document.createElement('div');
    const targetC = document.createElement('div');
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');

    targetA.className = 'forwarded-browser-target';
    targetB.className = 'forwarded-browser-target';
    targetC.className = 'forwarded-browser-target';
    sourceRootA.appendChild(targetA);
    sourceRootB.appendChild(targetB);
    sourceRootC.appendChild(targetC);
    document.body.append(sourceRootA, sourceRootB, sourceRootC, containerA, containerB);

    const { element, errors } = mountTransactionElement(sourceRootA);

    element.remove();
    containerA.appendChild(element);

    element.addEventListener(
      'sync:end',
      () => {
        // B is accepted through the still-current generation and deferred into
        // its FIFO; the reconnect then replaces that generation before B settles.
        element.sourceRoot = sourceRootB;
        containerB.appendChild(element);
        element.sourceRoot = sourceRootC;
      },
      { once: true },
    );

    element.render();

    expect(element.sourceRoot).toBe(sourceRootC);
    expect(element.parentElement).toBe(containerB);
    expect(element.querySelectorAll(`.${CLASS_NAMES.MARKER}`)).toHaveLength(1);
    expect(element.getStats()?.errors.byCode['deferred-operation-error']).toBeUndefined();
    expect(errors).toHaveLength(0);
    element.remove();
  });
});
