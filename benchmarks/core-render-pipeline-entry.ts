import { createTrackerRendererIntegration } from '../packages/core/src/renderer.js';
import type { TrackerRendererLike } from '../packages/core/src/renderer.js';
import { getTrackerIntegrationInstance } from '../packages/core/src/tracker/integrationRegistry.js';
import { flushTrackerInstanceRender } from '../packages/core/src/tracker/scheduling.js';
import type { TrackerConfiguration } from '../packages/core/src/types.js';

/**
 * Creates the benchmark's no-op Direct Renderer integration.
 *
 * Core still executes its real query, marker, layout, cluster, snapshot, and
 * render-record pipeline. The renderer deliberately accepts the caller-owned
 * root and performs no meaningful output work.
 */
function createBenchmarkCoreIntegration(configuration: TrackerConfiguration = {}) {
  const renderer: TrackerRendererLike = {
    mount(context) {
      return context.target.kind === 'root' ? context.target.root : context.target.host;
    },
  };
  const integration = createTrackerRendererIntegration(configuration, { renderer });

  return {
    ...integration,
    /**
     * Synchronously executes an already-queued targeted render request
     * (for example, the MARKERS-only target a rule or clustering-option
     * change requests) without widening it to a full render, unlike the
     * public `render()` method. Uses the same privileged-diagnostics
     * registry lookup as Core's `@rightxt/tracker-core/advanced` subpath —
     * the Direct Renderer facade deliberately excludes this capability,
     * so it is reached here rather than added to that public interface.
     */
    flushPendingRender() {
      const instance = getTrackerIntegrationInstance(integration);

      if (instance !== null) {
        flushTrackerInstanceRender(instance);
      }
    },
    mount(request: {
      renderRoot: HTMLElement;
      scrollRoot?: HTMLElement | Window;
      sourceRoot?: Document | HTMLElement;
    }) {
      integration.mount({
        rendererTarget: { kind: 'root', root: request.renderRoot },
        ...(request.scrollRoot === undefined ? {} : { scrollRoot: request.scrollRoot }),
        ...(request.sourceRoot === undefined ? {} : { sourceRoot: request.sourceRoot }),
      });
    },
  };
}

export { createBenchmarkCoreIntegration };
