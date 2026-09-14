import '@angular/compiler';

import { createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createApp, h as createVueElement, nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackerComponent as AngularTracker } from '../../packages/angular/src/public-api.ts';
import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from './support/angular-error-handler.js';
import { waitFor } from './support/wait-for.js';

/**
 * Splits captured mutation records into the single childList record that
 * removes `removedRootNode` from its parent and everything else (evidence of
 * extra, unwanted framework work performed once teardown has begun).
 *
 * @param {MutationRecord[]} records - Captured mutation records, in delivery order.
 * @param {Node} removedRootNode - The node expected to be removed exactly once.
 * @returns {{ rootRemovals: MutationRecord[], otherMutations: MutationRecord[] }} Partitioned records.
 */
function partitionTeardownMutations(records, removedRootNode) {
  const rootRemovals = records.filter(
    (record) => record.type === 'childList' && Array.prototype.includes.call(record.removedNodes, removedRootNode),
  );
  const otherMutations = records.filter((record) => !rootRemovals.includes(record));

  return { otherMutations, rootRemovals };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('teardown reactive-state write safety', () => {
  it('removes the Vue projection tree without teardown-time reactive attribute writes', async () => {
    const host = document.createElement('div');

    document.body.appendChild(host);

    const target = document.createElement('div');

    target.className = 'vue-teardown-target';
    host.appendChild(target);

    const componentRoot = document.createElement('div');

    host.appendChild(componentRoot);

    const app = createApp({
      render: () =>
        createVueElement(VueTracker, {
          options: {
            clustering: { enabled: false },
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          rules: [{ selector: '.vue-teardown-target' }],
        }),
    });

    app.mount(componentRoot);

    await waitFor(
      () => componentRoot.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the mounted Vue marker',
    );

    const trackerRoot = componentRoot.querySelector('.rxtt');

    if (trackerRoot === null) {
      throw new Error('Expected a mounted Vue tracker root.');
    }

    const mutationsDuringTeardown = [];
    const observer = new MutationObserver((records) => {
      mutationsDuringTeardown.push(...records);
    });

    observer.observe(componentRoot, { attributes: true, childList: true, subtree: true });

    app.unmount();

    const detachedSynchronously = !document.contains(trackerRoot);

    await nextTick();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    mutationsDuringTeardown.push(...observer.takeRecords());
    observer.disconnect();

    // Projection integration releases Core before Vue removes its owned tree.
    // No terminal snapshot or root-attribute restoration is written through
    // the selected visual path; the only observable mutation is root removal.
    expect(detachedSynchronously).toBe(true);

    const { otherMutations, rootRemovals } = partitionTeardownMutations(mutationsDuringTeardown, trackerRoot);

    expect(rootRemovals).toHaveLength(1);
    expect(otherMutations).toEqual([]);
  });

  it('removes the Angular projection tree without teardown-time reactive attribute writes', async () => {
    const host = document.createElement('div');

    document.body.appendChild(host);

    const target = document.createElement('div');

    target.className = 'angular-teardown-target';
    host.appendChild(target);

    const container = document.createElement('rxt-tracker-angular');

    host.appendChild(container);

    const application = await createApplication({
      providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
    });
    const componentRef = createComponent(AngularTracker, {
      environmentInjector: application.injector,
      hostElement: container,
    });

    componentRef.setInput('options', {
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    componentRef.setInput('rules', [{ selector: '.angular-teardown-target' }]);
    application.attachView(componentRef.hostView);
    application.tick();

    await waitFor(
      () => container.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the mounted Angular marker',
    );

    const trackerRoot = container.querySelector('.rxtt');

    if (trackerRoot === null) {
      throw new Error('Expected a mounted Angular tracker root.');
    }

    const mutationsDuringTeardown = [];
    const observer = new MutationObserver((records) => {
      mutationsDuringTeardown.push(...records);
    });

    // Observed on `host`, not `container`: Angular's componentRef.destroy()
    // detaches the whole `container` host element (the node passed as
    // `hostElement` to createComponent) from ITS OWN parent, rather than
    // removing trackerRoot from within a stable container - a mutation whose
    // target is `host`, outside a subtree observer rooted at `container`.
    observer.observe(host, { attributes: true, childList: true, subtree: true });

    componentRef.destroy();

    const detachedSynchronously = !document.contains(trackerRoot);

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    mutationsDuringTeardown.push(...observer.takeRecords());
    observer.disconnect();

    // Projection integration releases Core without publishing terminal state
    // into Angular. Angular removes its owned host tree synchronously, with no
    // teardown-time attribute writes visible to the parent observer.
    expect(detachedSynchronously).toBe(true);

    const { otherMutations, rootRemovals } = partitionTeardownMutations(mutationsDuringTeardown, container);

    expect(rootRemovals).toHaveLength(1);
    expect(otherMutations).toEqual([]);

    application.destroy();
  });
});
