import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import '../../../../shared/application/base.css';
import '../../../../shared/playground/styles.css';

import { createPlaygroundWorkbench } from '../../../../shared/playground/workbench.js';

/** Source root owned by the shared playground fixture. */
const content = document.querySelector('#playground-workbench-content');
if (!(content instanceof HTMLElement)) {
  throw new Error('Tracked fixture host is missing.');
}

/** Imperative Vanilla Tracker instance for this playground page. */
const tracker = new Tracker();

/** Demo-only bridge that maps workbench commands to the real Vanilla API. */
const workbench = createPlaygroundWorkbench({
  commitConfiguration: (configuration) => tracker.replaceConfiguration(configuration),
  getStats: () => tracker.getStats(),
  renderNow: () => tracker.render(),
  requestRender: () => tracker.requestRender(),
  resetStats: () => tracker.resetStats(),
});

/** Public event names forwarded from Vanilla to the shared workbench. */
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
  tracker.on(eventName, (payload) => workbench.handleEvent(eventName, payload));
}

tracker.replaceConfiguration(workbench.getInitialConfiguration());
tracker.mount({ sourceRoot: content });
workbench.start();

window.addEventListener('pagehide', () => tracker.destroy(), { once: true });
