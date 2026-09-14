import '@angular/compiler';

import { createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createApp, h as createVueElement, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackerComponent as AngularTracker } from '../../packages/angular/src/public-api.ts';
import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
import { RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from './support/angular-error-handler.js';

/** Removes framework fixtures after every synchronous-teardown scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('framework destroy delivery during sync-start teardown', () => {
  it('delivers Vue destroy exactly once when the parent removes the child from sync-start', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'runtime-vue-destroy-target';
    document.body.append(target, container);

    const destroyPayloads = [];
    const trackerRef = ref(null);
    const app = createApp({
      setup() {
        const visible = ref(true);

        return () =>
          visible.value
            ? createVueElement(VueTracker, {
                ref: trackerRef,
                onSyncStart: () => {
                  visible.value = false;
                },
                options: {
                  clustering: { enabled: false },
                  updates: {
                    interval: { enabled: false },
                    mutation: { enabled: false },
                    resize: { enabled: false },
                    scroll: { enabled: false },
                  },
                },
                rules: [{ selector: '.runtime-vue-destroy-target' }],
              })
            : null;
      },
    });

    app.mount(container);

    const destroyedPromise = trackerRef.value.whenRuntimeDestroyed();

    destroyedPromise.then(() => destroyPayloads.push(true));
    await nextTick();
    await destroyedPromise;

    expect(destroyPayloads).toHaveLength(1);
    expect(container.querySelector('.rxtt')).toBeNull();

    app.unmount();
  });

  it('delivers Angular destroy exactly once when ComponentRef is destroyed from syncStart', async () => {
    const host = document.createElement('rxt-tracker-angular');
    const target = document.createElement('div');

    target.className = 'runtime-angular-destroy-target';
    document.body.append(target, host);

    const application = await createApplication({
      providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
    });
    const componentRef = createComponent(AngularTracker, {
      environmentInjector: application.injector,
      hostElement: host,
    });
    const destroyPayloads = [];

    componentRef.setInput('options', {
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    componentRef.setInput('rules', [{ selector: '.runtime-angular-destroy-target' }]);

    const destroyedPromise = componentRef.instance.whenRuntimeDestroyed();

    destroyedPromise.then(() => destroyPayloads.push(true));
    componentRef.instance.syncStart.subscribe(() => componentRef.destroy());
    application.attachView(componentRef.hostView);
    application.tick();
    await destroyedPromise;

    expect(destroyPayloads).toHaveLength(1);
    expect(componentRef.hostView.destroyed).toBe(true);

    application.destroy();
  });
});

describe('framework destroy from an initial-mount resolver callback', () => {
  it('delivers Vue destroy exactly once when a rule.label callback removes the child from render during initial mount', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'runtime-vue-label-destroy-target';
    document.body.append(target, container);

    const destroyPayloads = [];
    const trackerRef = ref(null);
    const app = createApp({
      setup() {
        const visible = ref(true);

        return () =>
          visible.value
            ? createVueElement(VueTracker, {
                ref: trackerRef,
                options: {
                  clustering: { enabled: false },
                  updates: {
                    interval: { enabled: false },
                    mutation: { enabled: false },
                    resize: { enabled: false },
                    scroll: { enabled: false },
                  },
                },
                rules: [
                  {
                    selector: '.runtime-vue-label-destroy-target',
                    label: () => {
                      visible.value = false;
                      return 'label-triggered-destroy';
                    },
                  },
                ],
              })
            : null;
      },
    });

    app.mount(container);

    const destroyedPromise = trackerRef.value.whenRuntimeDestroyed();

    destroyedPromise.then(() => destroyPayloads.push(true));
    await nextTick();
    await destroyedPromise;

    expect(destroyPayloads).toHaveLength(1);
    expect(container.querySelector('.rxtt')).toBeNull();

    app.unmount();
  });

  it('delivers Angular destroy exactly once when a rule.label callback destroys ComponentRef during initial mount', async () => {
    const host = document.createElement('rxt-tracker-angular');
    const target = document.createElement('div');

    target.className = 'runtime-angular-label-destroy-target';
    document.body.append(target, host);

    const application = await createApplication({
      providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
    });
    const componentRef = createComponent(AngularTracker, {
      environmentInjector: application.injector,
      hostElement: host,
    });
    const destroyPayloads = [];

    componentRef.setInput('options', {
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    componentRef.setInput('rules', [
      {
        selector: '.runtime-angular-label-destroy-target',
        label: () => {
          componentRef.destroy();
          return 'label-triggered-destroy';
        },
      },
    ]);

    const destroyedPromise = componentRef.instance.whenRuntimeDestroyed();

    destroyedPromise.then(() => destroyPayloads.push(true));
    application.attachView(componentRef.hostView);
    application.tick();
    await destroyedPromise;

    expect(destroyPayloads).toHaveLength(1);
    expect(componentRef.hostView.destroyed).toBe(true);

    application.destroy();
  });
});
