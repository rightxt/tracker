# Building a custom integration

Use `@rightxt/tracker-core` when you are implementing a Tracker integration and need to own rendering or bind immutable view state to an application. If you only need to install Tracker in an application, start with an [official adapter](../../README.md). This guide follows the custom-integration workflow; the [Core README](../../packages/core/README.md) remains the package entry point.

For exact contracts, see the [Core API](../reference/core-api.md), [rendering protocols](../reference/core-rendering.md), and [runtime diagnostics](../reference/core-runtime.md) references.

## When to use Core

Core owns shared behavior: rule queries, marker geometry and clustering, semantic interaction, synchronization, configuration validation, lifecycle, and diagnostics. Your integration supplies the output boundary and connects that behavior to its UI. Core does not install the canonical stylesheet or decide where your application should place the rail.

Keep a single clear owner for the output subtree, subscriptions, and teardown. Do not reach into an official adapter's private integration to build a second rendering layer around it.

## Choose Projection or Direct Renderer

| Decision                | Projection                                                                | Direct Renderer                                                                      |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Best fit                | Application/framework owns DOM and consumes immutable view state.         | Integration implements synchronous renderer hooks.                                   |
| Factory entry           | `@rightxt/tracker-core/projection`                                        | `@rightxt/tracker-core/renderer`                                                     |
| Output input            | Exact connected `renderRoot`.                                             | Required `renderer`, then a host or root target at mount.                            |
| State/render connection | Read `getProjection()` and subscribe with `subscribeProjection()`.        | Render hooks receive current records, options, selection, and viewport measurements. |
| Configuration surface   | Complete `replaceConfiguration()` envelope.                               | Complete replacement plus options/rule-specific mutation methods.                    |
| Refresh                 | `render()`, `requestRender()`; `flushRender()` only drains existing work. | `render()`, `requestRender()`; no Projection flush facade.                           |

These are distinct public facades. Projection view state is not a `TrackerSnapshot`, and Direct Renderer does not expose Projection subscription/preflight methods. Choose the model before designing your wrapper API.

## Create the integration

Both factories create an alive, unmounted integration. For Projection:

```js
import { createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection';
import '@rightxt/tracker-core/style.css';

const integration = createTrackerProjectionIntegration({
  options: { orientation: 'vertical', placement: 'right' },
  rules: [{ selector: 'h2', label: (element) => element.textContent }],
});
```

For Direct Renderer, pass your renderer object as the second factory argument:

```js
import { createTrackerRendererIntegration } from '@rightxt/tracker-core/renderer';
import '@rightxt/tracker-core/style.css';

function createIntegration(renderer) {
  return createTrackerRendererIntegration({ rules: [{ selector: 'h2' }] }, { renderer });
}
```

Here `renderer` is your implementation of the public `TrackerRendererLike` contract, not a DOM element or an official adapter instance. A successful mount requires its `mount()` hook to return a valid actual root. Implement the rendering hooks needed by your UI for track, marker records, marker presentation, viewport, and selection, with corresponding cleanup. Hooks are synchronous; returning a Promise does not make mounting or rendering asynchronous.

## Configure options and rules

Creation accepts separate `options` and `rules` channels. Later `replaceConfiguration({ options, rules })` replaces both together and requires both fields. Options replacement resolves omitted fields from defaults; it is not a patch. Rule lists remain ordered and first-match ownership applies.

Normal configuration mutations validate strictly and atomically. Pure validation helpers can return recovered candidates and diagnostics but do not commit them. For rule-marker CSS names, invalid entries are removed from recovered candidates; strict integration updates still reject any candidate containing diagnostics. See [Rule behavior](rules-and-marker-behavior.md#validation-recovery-and-strict-updates).

Direct Renderer additionally provides `patchOptions()`, `replaceOptions()`, `replaceRules()`, and incremental rule methods. Projection does not provide those methods. A custom wrapper around Projection should keep application-owned configuration and send complete envelopes rather than assuming Direct Renderer method parity.

## Choose render/source/scroll roots

The render target/root selects the active document and Window. Source and scroll roots must belong to that realm and be current/connected. Omitted source/scroll identities follow the [environment defaults](environments.md#root-and-realm-model).

Projection uses the exact HTMLElement you supply. Your application owns that node and its DOM reconciliation. Do not use a ShadowRoot itself as the render root. For output in shadow DOM, use a connected HTMLElement inside it and load CSS in the same scope.

Direct Renderer has two ownership forms:

- `{ kind: 'root', root }`: the hook returns that exact caller-owned root.
- `{ kind: 'host', host }`: the renderer creates and returns its own distinct root strictly inside the supplied host.

The actual root must be a connected same-realm HTMLElement, must not contain or equal the source root, and must not be reused while owned by another active integration. If the renderer exposes a non-null `root` property, it must agree with the root returned from `mount()`. These constraints prevent ambiguous output ownership and source/output inversion. A body source may contain the output root; the reverse relationship is not allowed.

Keep visual writes and owned descendants inside that root. The application still owns surrounding nodes and borrowed DOM objects. See [Environments](environments.md) for the container profile and iframe placement rules.

## Mount

Mount only after the output root/host and intended source are connected. The following helper assumes the application has created the nodes and established the Projection subscription described in the next section:

```js
function mountProjection(integration, renderRoot, sourceRoot) {
  integration.mount({ renderRoot, sourceRoot });
}
```

A Direct Renderer host request has a different shape:

```js
function mountRenderer(integration, host, sourceRoot) {
  integration.mount({
    rendererTarget: { kind: 'host', host },
    sourceRoot,
  });
}
```

Include `scrollRoot` for element mode. A second mount while mounted rejects; call `unmount()` before replacing the context. A failed mount settles unmounted, and failed initial synchronization does not publish a successful initial sync pair. Treat successful mount completion as the boundary for mounted-only operations.

## Synchronize state

### Connect Projection to your view

`getProjection()` immediately provides deterministic initial shell state, before mounting. `subscribeProjection()` delivers future coherent commits synchronously; it does not replay the initial state. Read once and subscribe before mounting:

```js
function connectProjection(integration, renderView) {
  renderView(integration.getProjection());
  return integration.subscribeProjection(({ state }) => {
    renderView(state);
  });
}
```

`renderView` is your application-provided DOM/framework binding, not a Tracker API. It must reconcile the projected root and marker-layer classes, attributes, style variables, hidden state, viewport, and keyed items into the owned output. Remove stale projected attributes/styles/items as well as adding new ones. Preserve item keys and the standard structure when using delegated interaction and canonical CSS. The root object must stay the root given to `mount()`.

Projection DTOs are immutable, DOM-free view data. Do not mutate them or treat them as source-element snapshots. A framework may commit its DOM later than the synchronous Core publication: Core `sync:end` does not establish that framework commit, layout, or paint has finished. Coordinate any DOM-dependent application work with the framework's own commit boundary.

Projection listeners are integration-owned. Their failures are diagnosed; committed state is not rolled back, and a later publication can request full view resynchronization. Keep the binding capable of applying complete state, even if you normally optimize using changed domains.

### Connect Direct Renderer hooks

Use hook arguments as read-only inputs. Current render records can contain borrowed source Elements and Core-owned records; do not mutate or retain them as an independent mutable application model. Reconcile the marker/cluster output, viewport geometry, and selection inside the owned root. `resolveMarkerPresentation()` from the renderer entry applies global/rule/primary-marker presentation precedence when building item views.

Core provides delegated interaction for conforming DOM output. When a Direct Renderer performs its own hit testing, its facade also offers `activateItem(key, { sourceEvent })` for semantic activation of a current keyed item. Avoid activating the same native event again through a second application path.

### Request synchronization

While mounted, `render()` requests complete synchronization and flushes the scheduler immediately; `requestRender()` requests complete scheduled/coalesced work. Use them after application changes not covered by automatic sources. Projection's `flushRender()` only drains already-pending work, such as a pending request after configuration reconciliation. It does not request a new measurement when nothing is pending.

Configured automatic updates and manual requests share scheduling and non-overlap semantics. See [Updates and manual refresh](updates-and-refresh.md).

## Events and application callbacks

Subscribe using the chosen Core facade's `on()` and release subscriptions with their returned cleanup functions. For example, an integration can observe completion of Core synchronization:

```js
const stopSync = integration.on('sync:end', () => {
  // Core synchronization completed; a framework DOM commit may still be pending.
});
```

Core facade event handlers are integration-owned bridge callbacks. If you expose an application callback API, decide and implement its host/framework error-reporting boundary explicitly: an exception escaping your bridge can become a Core `integration-event-handler-error`. Do not assume the first-party adapters' different callback, emit, output, and CustomEvent channels are interchangeable.

Activation notifications follow semantic scroll/focus behavior and do not provide a cancellation return protocol. Keep callback delivery outside view rendering where your framework requires it.

### Reentrancy

State-changing calls made during public event or snapshot dispatch are deferred until dispatch completes. Their call return does not imply the queued change has completed. Calls from inside active lifecycle or renderer transitions have stricter rules; do not mount, replace configuration, or synchronize the same integration from a render hook or resolver. Perform those actions at an outer integration boundary. Exact transition and teardown matrices are beyond this workflow guide.

## Styling

Import `@rightxt/tracker-core/style.css` yourself. For the standard stylesheet, reproduce the supported `.rxtt`, `.rxtt__viewport`, `.rxtt__markers`, and `.rxtt__marker` hierarchy and public metadata. A differently structured custom renderer must provide its own appropriate styling rather than assuming the canonical direct-child selectors apply.

Keep renderer-owned geometry distinct from configurable theme variables. Projection normalizes root style output by trimming nonblank values and omitting blank values while committed options retain the original strings. See the complete [styling reference](../reference/styling.md).

## Unmount, remount, and destroy

`unmount()` reversibly releases the active mount context and its observers, listeners, and pending generation work. The same integration, options, and ordered rules survive. Mount again with connected/current roots when needed; never reuse stale iframe identities after navigation.

Projection leaves application-owned DOM ownership with your binding. Direct Renderer cleanup must release its owned nodes, subscriptions, and side effects while preserving caller-owned roots/hosts and unrelated children. Core cannot discover and undo arbitrary external resources created by a custom renderer. Design cleanup to work after partial setup as well as successful mount.

`destroy()` is terminal and idempotent. Capture `whenDestroyed()` if the integration needs a completion promise. Cleanup can throw while the integration still settles destroyed; do not interpret the exception as permission to reuse it. Release application-owned subscriptions and DOM resources even if teardown reports an error. For example, with the cleanup functions from the snippets above:

```js
const destroyed = integration.whenDestroyed();

try {
  integration.destroy();
} finally {
  stopSync();
  // Also release the unsubscribe returned by connectProjection(), if used.
  await destroyed;
}
```

## Diagnostics and debugging

Distinguish thrown configuration/lifecycle errors from recoverable runtime diagnostics. `diagnostics.output` supplies optional warning/error sinks; `getStats()` provides retained diagnostic counters. `diagnostics.warnings: false` gates only fallback `console.warn`: a configured `output.warn`, warning stats, and the Core `warning` event remain active. Error diagnostics and `console.error` are not controlled by that flag.

Use the [Core README](../../packages/core/README.md) for conditional or explicit debug entry selection. Advanced trace access is a Core-author capability and is not exposed through official adapter handles. Do not assume framework packages have their own `/debug` entry or that adapter examples expose the underlying Core integration.

## Integration checklist

- Choose one facade and implement its actual configuration and rendering surface.
- Create connected output in the intended realm; validate source/scroll relationships and CSS scope.
- Connect initial/future Projection state or synchronous renderer hooks, with coherent keyed output.
- Mount successfully before requesting geometry work; handle failed mount as unmounted.
- Provide manual refresh for unobserved application changes and keep public callback/error ownership explicit.
- Release mount resources on unmount, preserve configuration for remount, and complete terminal cleanup on destroy.

The [styling](../../site/demos/scenarios/styling/README.md), [observation](../../site/demos/scenarios/observation/README.md), [diagnostics](../../site/demos/scenarios/diagnostics/README.md), and [rule-resolution](../../site/demos/scenarios/rule-resolution/README.md) scenarios illustrate shared behavior through Vanilla. They are not custom-Core integration templates; there is no dedicated Core scenario in this set.
