import { type TrackerConfiguration, type TrackerRule, resolveTrackerOptions } from '@rightxt/tracker-core';
import { getTrackerDebugTrace, type TrackerDebugIntegration } from '@rightxt/tracker-core/advanced';
import {
  createTrackerProjectionIntegration,
  type TrackerItemView,
  type TrackerProjectionCommit,
  type TrackerProjectionIntegration,
} from '@rightxt/tracker-core/projection';
import {
  CSS_VARIABLES,
  createTrackerRendererIntegration,
  type TrackerRendererIntegration,
  type TrackerRendererLike,
} from '@rightxt/tracker-core/renderer';

/** Consumer configuration shared by both supported visual SPIs. */
const configuration: TrackerConfiguration = {
  options: { placement: 'right' },
  rules: [{ selector: '.target' } satisfies TrackerRule],
};

/** Minimal renderer accepted by the Direct Renderer facade. */
const renderer: TrackerRendererLike = {
  mount: (context) => (context.target.kind === 'root' ? context.target.root : null),
  renderSelection: () => undefined,
  unmount: () => undefined,
};

/** Supported imperative integration without exposure of a mutable Core instance. */
const rendererIntegration: TrackerRendererIntegration = createTrackerRendererIntegration(configuration, { renderer });

rendererIntegration.mount({ rendererTarget: { kind: 'root', root: document.body }, sourceRoot: document });
rendererIntegration.render();
rendererIntegration.requestRender();
rendererIntegration.activateItem('missing', { sourceEvent: null });
rendererIntegration.on('marker:activate', (payload) => payload.selector);
rendererIntegration.getSnapshot();
rendererIntegration.getOptions();
rendererIntegration.getRules();

/** Supported declarative integration whose commits contain DOM-free item views. */
const projectionIntegration: TrackerProjectionIntegration = createTrackerProjectionIntegration(configuration);

projectionIntegration.subscribeProjection((commit: TrackerProjectionCommit) => {
  const items: readonly TrackerItemView[] = commit.state.items;

  void items;
});
projectionIntegration.getSnapshot();
projectionIntegration.subscribeSnapshot(() => undefined)();
projectionIntegration.mount({ renderRoot: document.body, sourceRoot: document });

/** Advanced diagnostics accept only opaque supported integration facades. */
const debugIntegration: TrackerDebugIntegration = rendererIntegration;

getTrackerDebugTrace(debugIntegration);
getTrackerDebugTrace(projectionIntegration);
resolveTrackerOptions({});
void CSS_VARIABLES.MARKER_START;

rendererIntegration.destroy();
projectionIntegration.destroy();
