import '@rightxt/tracker-element/register';
import '@rightxt/tracker-element/style.css';
import '../../../../shared/application/base.css';
import '../../../../shared/playground/styles.css';

import { createPlaygroundWorkbench } from '../../../../shared/playground/workbench.js';

/** Source root owned by the shared playground fixture. */
const content = document.querySelector('#playground-workbench-content');
/** Light-DOM host for the registered Custom Element. */
const mount = document.querySelector('#element-tracker-root');
if (!(content instanceof HTMLElement) || !(mount instanceof HTMLElement)) {
  throw new Error('Element playground markup is incomplete.');
}

/** Real registered Tracker Custom Element configured before connection. */
const tracker = document.createElement('rxt-tracker');
tracker.id = 'element-tracker';
tracker.sourceRoot = content;

/** Demo-only bridge that preserves the Custom Element's public surface. */
const workbench = createPlaygroundWorkbench({
  commitConfiguration: (configuration) => tracker.replaceConfiguration(configuration),
  getStats: () => tracker.getStats(),
  renderNow: () => tracker.render(),
  requestRender: () => tracker.requestRender(),
  resetStats: () => tracker.resetStats(),
});

/** Native event names forwarded to the framework-neutral workbench. */
const workbenchEventNames = [
  'marker:activate',
  'cluster:activate',
  'selection:change',
  'track:activate',
  'warning',
  'sync:start',
  'sync:end',
];
for (const eventName of workbenchEventNames) {
  tracker.addEventListener(eventName, (event) => {
    if (event instanceof CustomEvent) {
      workbench.handleEvent(eventName, event.detail);
    }
  });
}

tracker.replaceConfiguration(workbench.getInitialConfiguration());
mount.append(tracker);
workbench.start();

window.addEventListener('pagehide', () => tracker.remove(), { once: true });
