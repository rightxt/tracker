import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';

import { Tracker } from '@rightxt/tracker-vue';
import '@rightxt/tracker-vue/style.css';
import './shared/base.css';
import './playground/styles.css';

import { createPlaygroundWorkbench } from './playground/workbench.js';

/** Vue application mount container. */
const mount = document.querySelector('#vue-tracker-root');
/** Source root owned by the shared playground fixture. */
const content = document.querySelector('#playground-workbench-content');
if (!(mount instanceof HTMLElement) || !(content instanceof HTMLElement)) {
  throw new Error('Vue playground markup is incomplete.');
}

/** Replaceable configuration value delivered through Vue props. */
const configuration = shallowRef(null);
/** Exposed public Tracker component handle. */
const trackerHandle = shallowRef(null);
/** Receives Vue listener events once the workbench is initialized. */
let receiveWorkbenchEvent = () => {};

/** Vue-owned declarative boundary around the shared workbench fixture. */
const App = defineComponent({
  name: 'VuePlaygroundApp',
  setup() {
    return () =>
      h(Tracker, {
        ref: trackerHandle,
        options: configuration.value.options,
        rules: configuration.value.rules,
        sourceRoot: content,
        onClusterActivate: (payload) => receiveWorkbenchEvent('cluster:activate', payload),
        onMarkerActivate: (payload) => receiveWorkbenchEvent('marker:activate', payload),
        onSelectionChange: (payload) => receiveWorkbenchEvent('selection:change', payload),
        onSyncEnd: (payload) => receiveWorkbenchEvent('sync:end', payload),
        onSyncStart: (payload) => receiveWorkbenchEvent('sync:start', payload),
        onTrackActivate: (payload) => receiveWorkbenchEvent('track:activate', payload),
        onWarning: (payload) => receiveWorkbenchEvent('warning', payload),
      });
  },
});

/** Demo-only bridge from the shared workbench to Vue state and exposed methods. */
const workbench = createPlaygroundWorkbench({
  commitConfiguration: (candidate) => {
    configuration.value = candidate;
  },
  getStats: () => trackerHandle.value.getStats(),
  renderNow: () => trackerHandle.value.refresh(),
  requestRender: () => trackerHandle.value.requestRefresh(),
  resetStats: () => trackerHandle.value.resetStats(),
});
receiveWorkbenchEvent = workbench.handleEvent;
configuration.value = workbench.getInitialConfiguration();
/** Vue application instance for teardown on page exit. */
const app = createApp(App);
app.mount(mount);
await nextTick();
workbench.start();

window.addEventListener('pagehide', () => app.unmount(), { once: true });
