import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { Tracker } from '@rightxt/tracker-react';
import '@rightxt/tracker-react/style.css';
import './shared/base.css';
import './playground/styles.css';

import { createPlaygroundWorkbench } from './playground/workbench.js';

/** React root container for the integration-owned Tracker component. */
const mount = document.querySelector('#react-tracker-root');
/** Source root owned by the shared playground fixture. */
const content = document.querySelector('#playground-workbench-content');
if (!(mount instanceof HTMLElement) || !(content instanceof HTMLElement)) {
  throw new Error('React playground markup is incomplete.');
}

/** Supported imperative React Tracker handle. */
const trackerRef = createRef();
/** React application root for this standalone demo. */
const root = createRoot(mount);
/** Current immutable configuration passed through Tracker props. */
let configuration;
/** Receives callback-prop events once the workbench is initialized. */
let receiveWorkbenchEvent = () => {};

/** Renders immutable configuration props while preserving the mounted Tracker component identity. */
function renderTracker() {
  flushSync(() => {
    root.render(
      <Tracker
        ref={trackerRef}
        options={configuration.options}
        rules={configuration.rules}
        sourceRoot={content}
        onClusterActivate={(payload) => receiveWorkbenchEvent('cluster:activate', payload)}
        onMarkerActivate={(payload) => receiveWorkbenchEvent('marker:activate', payload)}
        onSelectionChange={(payload) => receiveWorkbenchEvent('selection:change', payload)}
        onSyncEnd={(payload) => receiveWorkbenchEvent('sync:end', payload)}
        onSyncStart={(payload) => receiveWorkbenchEvent('sync:start', payload)}
        onTrackActivate={(payload) => receiveWorkbenchEvent('track:activate', payload)}
        onWarning={(payload) => receiveWorkbenchEvent('warning', payload)}
      />,
    );
  });
}

/** Demo-only bridge from the shared workbench to React props and ref methods. */
const workbench = createPlaygroundWorkbench({
  commitConfiguration: (candidate) => {
    configuration = candidate;
    renderTracker();
  },
  getStats: () => trackerRef.current.getStats(),
  renderNow: () => trackerRef.current.refresh(),
  requestRender: () => trackerRef.current.requestRefresh(),
  resetStats: () => trackerRef.current.resetStats(),
});
receiveWorkbenchEvent = workbench.handleEvent;
configuration = workbench.getInitialConfiguration();
renderTracker();
workbench.start();

window.addEventListener('pagehide', () => root.unmount(), { once: true });
