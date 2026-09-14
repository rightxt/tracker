# Environments

Tracker can represent a page or one element scroll container, including content in an open ShadowRoot or an accessible same-origin iframe. Choose the source, scrolling context, and output location together. This guide explains their relationship; the [package READMEs](../../README.md) define each integration's public configuration and lifecycle API.

## Root and realm model

A mount has three separate responsibilities:

| Responsibility     | Meaning                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Source root        | `sourceRoot` scopes selector queries and default mutation observation.                     |
| Scroll root        | `scrollRoot` selects page/window scrolling or one authoritative element scrolling context. |
| Render target/root | Owns the rail's DOM location and selects the active `Document` and `Window`.               |

In Core Projection, `renderRoot` selects the active realm. In Core Direct Renderer, `rendererTarget.host` or `rendererTarget.root` selects it. `sourceRoot` and `scrollRoot` are validated against that realm; they do not select a different active realm. Tracked elements, rendered output, scrolling, and geometry must belong to that one document. A mount cannot combine parent-page sources and child-iframe output, or project markers across documents.

Use connected roots from the current document. A DOM object retained from a navigated iframe is not a replacement for a root in its new document. Active-realm constructors and capabilities govern DOM validation, observers, listeners, scheduling, and scrolling where applicable. For custom integrations, use the render root's `ownerDocument` and its `defaultView` for DOM work instead of assuming ambient browser globals refer to the same realm. Borrowed DOM nodes, windows, and events remain platform-owned.

## Page/document tracking

An omitted scroll root selects window mode. The active `Window`, and the active document's `body`, `documentElement`, and `scrollingElement`, are page-scroller aliases: passing one of these elements does not create element mode.

With an omitted source root, window mode uses the active document's body. Wait until that body exists, or provide an explicit source and render target through the package's API. Page geometry is measured against the document; native scrolling drives source activation.

Vanilla resolves an omitted `renderHost` to the inferred request document's body. Its inference order is explicit `renderHost`, then `scrollRoot`, then `sourceRoot`, then ambient `document`. Thus a parent-owned Vanilla instance can infer a child-document body from child-document roots. This inference prepares the renderer target; the resulting renderer target remains Core's realm authority.

## Element scroll containers

Pass a supported `HTMLElement` other than a page-scroller alias as `scrollRoot`. Its client and scroll dimensions define the represented scrolling space. An omitted source root resolves to that element. An explicit source must lie within the supported scroll subtree, including the ShadowRoot host traversal described below.

One Tracker represents one authoritative scroll root. Relevant scrolling in descendants can invalidate marker geometry, but does not turn the rail into a representation of several independent scroll ranges. Arrange the output overlay to correspond visually to the selected container. Vanilla requires an explicit `renderHost` for element mode; framework integrations render the rail at their component location.

### Supported container profile

| Condition                 | Required behavior                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document and connection   | Connected to a standards-mode document (`CSS1Compat`), with computed styles available.                                                                          |
| Principal box             | At least one client rectangle and positive `clientHeight` for vertical tracking or positive `clientWidth` for horizontal tracking.                              |
| Display                   | Computed `block`, `flow-root`, `flex`, `inline-flex`, `grid`, `inline-grid`, or `inline-block`.                                                                 |
| Element category          | Use a container. `img`, `video`, `audio`, `canvas`, `iframe`, `embed`, `object`, `input`, `textarea`, `select`, `button`, `meter`, and `progress` are excluded. |
| Represented-axis overflow | `auto`, `scroll`, or `hidden`; `hidden` permits programmatic scrolling. Effective `visible` and `clip` are outside this profile.                                |
| Scroll snap               | No active computed `scroll-snap-type`.                                                                                                                          |
| Scroll origin             | No detected reverse flex direction or reverse wrap that reverses the represented physical axis.                                                                 |

Vertical Tracker geometry uses the physical Y axis, and horizontal geometry uses X. Writing mode affects which flex direction corresponds to those axes. For example, a reverse direction is rejected when its reversal maps onto the represented axis; this is not a prohibition on every reverse direction in every layout.

A zero current scroll range is valid. The container can mount before content growth makes it scrollable, provided the represented client extent is positive. Mounting or changing configuration to an unsupported element profile is rejected. Passing the bounded profile checks does not prove that arbitrary ancestor transforms, zoom, containing blocks, or overlay placement produce matching coordinates; those remain application layout responsibilities.

The [Core rendering reference](../reference/core-rendering.md#active-realm-and-root-ownership) defines the exact Projection and Direct Renderer root identity, validation, and cleanup contracts.

## Source roots

Supported sources are `Document`, `Element`, and a directly supplied open `ShadowRoot`. Queries follow `querySelectorAll()` scope: an Element source matches descendants, not itself. A Document source queries that document rather than automatically entering its child shadow trees or iframes.

Use `sourceRoot` to state the intended query scope even when framework children, slots, or projected content visually surround the tracker. That content does not automatically become Tracker's source. Changing the query scope and changing where the rail is rendered are separate actions.

## Shadow DOM

Pass an open ShadowRoot when the shadow tree itself should be the selector and default observation scope. A closed ShadowRoot is not supported as a direct source. An Element inside a shadow tree can instead scope its own descendants. Selectors do not pierce shadow boundaries or discover unrelated nested shadow trees automatically.

For element-mode containment, Core follows parent nodes and crosses a ShadowRoot through its host. It does not follow `assignedSlot`. A source or activation target appearing inside a container only through slot assignment is therefore not sufficient evidence of supported containment. This containment check is separate from selector traversal.

The actual rendered Tracker root remains an `HTMLElement`, never the ShadowRoot itself. For Vanilla, put an HTMLElement `renderHost` inside the user-managed ShadowRoot. Element owns a Light DOM `.rxtt` child of its custom-element host; the host may itself be inside a user ShadowRoot, or may remain in document Light DOM while the source is an open ShadowRoot. In either case, the source and host must satisfy the document and scroll-subtree constraints.

React, Vue, and Angular also need their actual rendered root in the intended output scope. Creating a shadow source does not relocate component output. Load the [canonical stylesheet and theme](../reference/styling.md#shadow-dom) in the scope that contains the actual `.rxtt` tree; document CSS does not cross a shadow boundary automatically.

## iframe and multiple documents

Use accessible same-origin child-document objects. Tracker provides no cross-origin bridge, automatic frame traversal, or cross-document marker projection. Passing the parent document's `<iframe>` element as the scroll root does not track its contents; use the child's Window or a supported child HTMLElement.

There is no single iframe recipe for all packages. Output placement determines which document can be tracked, and adapters differ in how that placement is controlled.

## Adapter comparison

| Integration                                 | How output selects the document                                       | Supported child-document workflow                                                                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Core](../../packages/core/README.md)       | Projection `renderRoot`; Direct Renderer target host/root.            | A custom integration can supply accessible child-realm targets and matching roots. It owns output placement and lifecycle.                                                                                                     |
| [Vanilla](../../packages/vanilla/README.md) | Explicit or inferred `renderHost`.                                    | Parent code can mount an instance into the child using child roots/host. This is the most flexible parent-controlled iframe form among official adapters.                                                                      |
| [Element](../../packages/element/README.md) | The custom-element host and its owned render root.                    | Register and render the element in the child document. A parent-document host cannot target child source/scroll roots.                                                                                                         |
| [React](../../packages/react/README.md)     | The actual Tracker DOM placed by React.                               | Render the app in the child, or use a surrounding React renderer that actually places Tracker DOM there. Tracker has no `renderHost` or portal prop of its own.                                                                |
| [Vue](../../packages/vue/README.md)         | The actual Tracker DOM, subject to Vue item registration constraints. | Use an iframe-local Vue application. Parent-realm Teleport into a child iframe is not fully realm-safe: item registration checks `HTMLElement` in the ambient realm. Projection's realm model does not remove this limitation. |
| [Angular](../../packages/angular/README.md) | The component's internal render root.                                 | Create the application/component host in the child document. Tracker has no render-target or portal input.                                                                                                                     |

Every child document needs its own package stylesheet and theme. A stylesheet loaded only by the parent cannot style the child rail.

## Navigation and remounting

Iframe navigation replaces the document association. An existing mount generation does not retarget itself. For Core and Vanilla, use this sequence:

1. Call `unmount()` before navigation or context replacement.
2. After the new document loads, obtain fresh document, Window, source, scroll, and render identities.
3. Mount again with a coherent request from the new document.

A second `mount()` while already mounted is rejected; it is not a context update. Core and Vanilla preserve the same integration and application configuration/rules across unmount/remount.

Element disconnect destroys its current Core generation. Reconnection creates a fresh generation while Element-owned configuration and root properties persist; correct stale explicit roots before reuse. Connected same-origin adoption instead remounts the same Projection integration. Only omitted roots take destination defaults. Disconnected root assignments defer mount validation to connection; connected setters can preflight and throw. Lifecycle reaction failures use lifecycle diagnostic reporting.

Framework root changes unmount before attempting the new mount. A failed remount leaves the adapter unmounted rather than restoring the previous roots; a valid configuration replacement made before that failure can remain committed. Recreate the component or correct its roots according to its package lifecycle. These components expose no consumer `destroy()` method; use their captured `whenRuntimeDestroyed()` promise when teardown completion matters.

## Recovery and geometry suspension

An initial valid mount is required. If external CSS or DOM changes make an element scroll root unsupported after mount, the next render can suspend geometry without replacing the lifecycle context. Marker output becomes empty and viewport geometry invisible; standard output reports `data-rxtt-geometry="suspended"`. Observers remain connected.

Restore the profile and synchronize again to recover full query, layout, and rendering. This recovery occurs at a render boundary, not merely when CSS becomes valid. Stylesheet or CSSOM changes are not guaranteed mutation signals. Call `render()` for Core, Vanilla, or Element, or `refresh()` through a framework handle, while mounted when automatic signals are insufficient. See [Updates and manual refresh](updates-and-refresh.md#geometry-recovery).

## Examples

This Vanilla example runs after the application's `.scroller` and `.tracker-overlay` elements are connected. The scroller must satisfy the profile above, and the overlay is the application's chosen rail location:

```js
import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';

const scrollRoot = document.querySelector('.scroller');
const renderHost = document.querySelector('.tracker-overlay');
const tracker = new Tracker({ rules: [{ selector: 'h2' }] });

tracker.mount({ sourceRoot: scrollRoot, scrollRoot, renderHost });
```

The following links open scenario materials in the repository:

- [Writing modes](../../site/demos/scenarios/writing-mode/README.md): physical axes and container layouts.
- [React container](../../site/demos/scenarios/container/react/README.md), [Vue container](../../site/demos/scenarios/container/vue/README.md), and [Angular container](../../site/demos/scenarios/container/angular/README.md): framework root bindings.
- [Vanilla in Shadow DOM](../../site/demos/scenarios/shadow-dom-vanilla/README.md) and [Element with a shadow source](../../site/demos/scenarios/shadow-dom-element/README.md): distinct output and source scopes.
- [Vanilla iframe navigation](../../site/demos/scenarios/iframe-vanilla/README.md): parent-owned integration across child-document replacement.
