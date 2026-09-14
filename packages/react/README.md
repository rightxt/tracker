# @rightxt/tracker-react

[![npm version](https://img.shields.io/npm/v/%40rightxt%2Ftracker-react)](https://www.npmjs.com/package/@rightxt/tracker-react) [![React](https://img.shields.io/npm/dependency-version/%40rightxt%2Ftracker-react/peer/react?label=React&logo=react)](https://react.dev/) [![TypeScript declarations](https://img.shields.io/npm/types/%40rightxt%2Ftracker-react)](https://www.npmjs.com/package/@rightxt/tracker-react)

## Overview

RXT Tracker adds a track with markers for source elements matched by ordered CSS selector rules. The React 19 component owns the rendered track; the shared Core runtime measures content, groups markers, handles activation, and observes changes through an internal Projection integration.

Use props for configuration, callback props for notifications, and a ref handle for explicit synchronization and runtime state. The Projection integration itself is private.

## Installation, artifacts and debug model

```sh
pnpm add @rightxt/tracker-react
```

React is an external peer with range `>=19 <20`. Core is a regular dependency and stays external in the built adapter.

| Import path                           | Contents                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@rightxt/tracker-react`              | Normal ESM component `Tracker` and its `default` alias; types `TrackerProps` and `TrackerHandle`. |
| `@rightxt/tracker-react/style.css`    | Canonical stylesheet; import it explicitly.                                                       |
| `@rightxt/tracker-react/package.json` | Package metadata resource.                                                                        |

The root resolves to `dist/rxt-tracker-react.mjs` with `dist/index.d.ts` declarations. There is one normal ESM adapter entry, no package-local `/debug` ESM path, and no standalone/global browser bundle or standalone debug JavaScript. Neutral external Core condition selection supplies debug behavior; see [Debug and diagnostics](#debug-and-diagnostics).

## Quick start

`Tracker` is a normal React component. The same props, update-identity, event, and imperative-ref contracts apply regardless of how the surrounding component logic is organized.

```tsx
import { useRef, useState } from 'react';
import { Tracker, type TrackerHandle, type TrackerProps } from '@rightxt/tracker-react';
import '@rightxt/tracker-react/style.css';

export default function Article() {
  const trackerRef = useRef<TrackerHandle>(null);
  const [options, setOptions] = useState<TrackerProps['options']>({
    a11y: { enabled: true, keyboard: true },
  });
  const [rules] = useState<TrackerProps['rules']>([{ selector: '.article-section', label: (element) => element.textContent }]);

  return (
    <>
      <button type="button" onClick={() => setOptions({ ...options, clustering: { enabled: false } })}>
        Show individual markers
      </button>
      <main>
        <h1>Article</h1>
        <h2 className="article-section">Introduction</h2>
        <p>Your article content goes here.</p>
        <h2 className="article-section">Details</h2>
      </main>
      <Tracker ref={trackerRef} options={options} rules={rules} onMarkerActivate={(payload) => console.log(payload.selector)} />
    </>
  );
}
```

The ref is a React 19 prop; no `forwardRef()` wrapper is required. State preserves configuration identities between renders, and the button supplies a new options object. The article is outside `Tracker`; default source scope finds it in the actual render root's document body. React owns teardown.

## Component model and concepts

A **source element** is a matched DOM element. A **rule** selects sources and configures their labels, presentation, scrolling, and focus. A **marker** represents one source position; a **cluster** groups nearby markers and uses a primary marker. The **track** represents a scroll range; its **viewport indicator** represents the visible portion. Logical item selection is distinct from browser focus.

React creates the `.rxtt` render root and its `.rxtt__viewport`, `.rxtt__markers`, and `.rxtt__marker` descendants. `sourceRoot` chooses selector scope; `scrollRoot` chooses the represented scrolling context. Neither relocates the rendered track.

The five non-callback members of `TrackerProps` are:

| Prop         | Type / default                                                            | Contract                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`    | Partial options object; omitted means `{}`                                | Complete non-rule configuration; new object identity applies replacement defaults.                                                                             |
| `rules`      | Readonly ordered rule array; omitted/`undefined` means `[]`               | Only rule channel. New array identity replaces the whole list; null rejects.                                                                                   |
| `sourceRoot` | Document, Element, open ShadowRoot, null, or undefined; default undefined | Selector scope. Null keeps the runtime unmounted. Omission resolves in the actual render root's document: body in window mode, scroll element in element mode. |
| `scrollRoot` | Window, HTMLElement, null, or undefined; default undefined                | Undefined, the active Window, and page-scroller element aliases select window mode; other HTMLElements select element mode. Null keeps the runtime unmounted.  |
| `ref`        | React `Ref<TrackerHandle>`; omitted                                       | Object or callback ref for the six-method handle.                                                                                                              |

The seven callback props in [Events](#events) complete all twelve `TrackerProps` members. React `children` are not Tracker source content and do not define `sourceRoot`; this component does not accept children as a public prop. There are no `className`, `style`, arbitrary root-attribute, `renderHost`, or portal-target props; unknown runtime props are not forwarded. Use presentation options and reachable CSS.

## Configuration

Supply whole `options` and whole `rules` values. There is no patch-style options API, incremental rule API, or declarative `{ render: false }` escape. An own `options.rules` key throws a native TypeError; rules belong only to the separate prop.

Top-level identity is the update boundary. Mutating `options.a11y.label` on the same options object, or editing the same rules array in place, is not a supported update signal. Provide a new object and a new rules array for their respective changes. Omitted option leaves return to defaults on replacement; omission of rules clears the list.

The tables below cover all **36 option leaves**. Every field is optional; structural containers are not additional leaves. Known own undefined values inside configuration and unknown fields reject. Null is valid only where explicitly listed. Static validation occurs during render. A normal replacement rejects any diagnostic, including warnings, without partially accepting that candidate.

### Track geometry and placement

| Option        | Type / values                            | Default                                 | Meaning and constraints                                                                                                                                                                                 |
| ------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orientation` | `'vertical' \| 'horizontal'`             | `'vertical'`                            | Physical Y or X axis. Changing orientation while mounted in element mode revalidates that scroll root for the requested axis and can reject before commit.                                              |
| `placement`   | `'left' \| 'right' \| 'top' \| 'bottom'` | Vertical: `'left'`; horizontal: `'top'` | Vertical accepts left/right; horizontal accepts top/bottom. An explicitly incompatible pair rejects. An omitted incompatible placement falls back to the new axis default. No scrollbar-side inference. |

### Presentation

| Option                  | Type / values                                      | Default | Meaning and constraints                                                                                                                                                                                                                                                                                           |
| ----------------------- | -------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cssVariables`          | Plain map of string or null values                 | `{}`    | Root custom-property input. Supported Tracker names and valid application names are accepted; renderer geometry/unknown `--rxtt-*` names reject. Committed strings remain unchanged; null means no configured value. Whole replacement removes omitted entries. See [Styling](#styling) for output normalization. |
| `track.className`       | `string`                                           | `''`    | Application classes appended to the standard `.rxtt` root. Whitespace normalized and tokens deduplicated; reserved Tracker service classes reject.                                                                                                                                                                |
| `viewport.enabled`      | `boolean`                                          | `true`  | Show the viewport indicator when geometry is available. Does not enable/disable update sources.                                                                                                                                                                                                                   |
| `viewport.className`    | `string`                                           | `''`    | Application classes on `.rxtt__viewport`; same class normalization/reservation rules.                                                                                                                                                                                                                             |
| `markerLayer.className` | `string`                                           | `''`    | Application classes on `.rxtt__markers`; same class rules.                                                                                                                                                                                                                                                        |
| `marker.attributes`     | Plain map: string, finite number, boolean, or null | `{}`    | Global application attributes for marker/cluster items. Names lowercased; collisions/reserved names reject. Global null contributes no attribute; rule null suppresses inheritance. See the name constraints below.                                                                                               |
| `marker.className`      | `string`                                           | `''`    | Application classes for every marker/cluster, combined with its owning rule's classes. Same class rules.                                                                                                                                                                                                          |
| `marker.title`          | `boolean`                                          | `true`  | Use a nonempty resolved label as native title; an explicit rule boolean overrides the global policy.                                                                                                                                                                                                              |

Application attributes support `role`, supported `data-*`, and supported `aria-*` names. `role` requires a nonempty trimmed string; other supported non-null values serialize to strings. `class`, `style`, `id`, `tabindex`, `title`, event-handler/framework-special names, and `data-rxtt-*` are reserved. Use the dedicated class/title/CSS options. Global and per-rule presentation composition is defined in the [rule guide](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/#marker-presentation).

### Clustering

| Option                 | Type / values        | Default | Meaning and constraints                                                                                                                                                                                      |
| ---------------------- | -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clustering.enabled`   | `boolean`            | `true`  | Group nearby measured markers; false keeps individual marker records.                                                                                                                                        |
| `clustering.threshold` | Finite number `>= 0` | `2`     | Distance in track percentage points, not pixels/CSS length. Grouping compares against accumulated cluster bounds. The first spatial member is primary and supplies cluster presentation/activation behavior. |

### Automatic updates

Each family is independently enabled. Delays/debounces use milliseconds. Observer target callbacks are synchronous functions returning arrays; a bare array is not the configuration type.

| Option                      | Type / values            | Default                                                                                               | Meaning and constraints                                                                                                                                                                                |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `updates.mutation.enabled`  | `boolean`                | `true`                                                                                                | Connect the MutationObserver source for relevant external source changes.                                                                                                                              |
| `updates.mutation.targets`  | `(context) => Node[]`    | Resolver returning `[sourceRoot]`                                                                     | Select mutation targets in the active document. Invalid/foreign/Tracker output targets are filtered. A throw/non-array result falls back to defaults; explicit `[]` leaves this observer disconnected. |
| `updates.mutation.debounce` | Finite number `>= 0`     | `100`                                                                                                 | Debounce relevant mutation batches before requesting marker synchronization.                                                                                                                           |
| `updates.resize.enabled`    | `boolean`                | `true`                                                                                                | Control both ResizeObserver and active Window resize updates.                                                                                                                                          |
| `updates.resize.targets`    | `(context) => Element[]` | Source Element or ShadowRoot host, element scroll root when applicable, and render root; deduplicated | Configure ResizeObserver only; Window resize is independent of this target list. Throw/non-array falls back to defaults; `[]` disconnects ResizeObserver, not Window resize.                           |
| `updates.resize.debounce`   | Finite number `>= 0`     | `50`                                                                                                  | Shared debounce for ResizeObserver and Window resize signals.                                                                                                                                          |
| `updates.scroll.enabled`    | `boolean`                | `true`                                                                                                | Frame-coalesced scroll invalidation, including marker geometry and viewport synchronization. False stops automatic viewport synchronization as well.                                                   |
| `updates.interval.enabled`  | `boolean`                | `false`                                                                                               | Enable polling independently of the other update sources.                                                                                                                                              |
| `updates.interval.delay`    | Finite number `> 0`      | `1000`                                                                                                | Polling period while interval updates are active.                                                                                                                                                      |

Target context contains `observerType`, `sourceRoot`, `scrollRoot`, `scrollMode`, `renderRoot`, `document`, `window`, `defaultTargets`, and `reason`. `reason` describes connection/reconnection; `defaultTargets` supplies fresh runtime defaults. Results are deduplicated. Mutation accepts Nodes; resize requires Elements and allows the integration's own render root. Callbacks may inspect the active DOM but must return synchronously and must not mutate the same Tracker during resolution. See [observation targets](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/#observation-targets).

The seven native mutation controls are separate configurable leaves:

| Option                                           | Type / values                                  | Default | Meaning and constraints                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updates.mutation.options.childList`             | `boolean`                                      | `true`  | Observe added/removed children. At least one effective category must remain enabled.                                                              |
| `updates.mutation.options.subtree`               | `boolean`                                      | `true`  | Extend observation to descendants; this alone is not an observation category.                                                                     |
| `updates.mutation.options.attributes`            | `boolean`                                      | `false` | Observe attributes. Effective native value becomes true when an attribute filter exists or old values are requested, even if this field is false. |
| `updates.mutation.options.attributeFilter`       | Nonempty, non-sparse array of nonempty strings | Omitted | Restrict observed attribute names and enable effective attribute observation.                                                                     |
| `updates.mutation.options.attributeOldValue`     | `boolean`                                      | Omitted | Request old attribute values when true; also enables effective attribute observation.                                                             |
| `updates.mutation.options.characterData`         | `boolean`                                      | `false` | Observe text data. Effective native value becomes true when character-data old values are requested.                                              |
| `updates.mutation.options.characterDataOldValue` | `boolean`                                      | Omitted | Request old text-data values when true and enable effective character-data observation.                                                           |

The effective configuration must enable child-list, attributes, or character data. An all-disabled effective configuration rejects; turn off `updates.mutation.enabled` to disable the source instead.

### Interaction

| Option                   | Type / values | Default | Meaning and constraints                                                                                                                                     |
| ------------------------ | ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interaction.activation` | `boolean`     | `true`  | Enable marker, cluster, discrete track, and selected-item keyboard activation. False suppresses their semantic action/activation notifications.             |
| `interaction.drag`       | `boolean`     | `false` | Enable continuous track dragging independently of activation. Standard root `data-rxtt-drag="true"` denotes enabled capability, not a current drag session. |

### Accessibility

| Option          | Type / values     | Default             | Meaning and constraints                                                                                                          |
| --------------- | ----------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `a11y.enabled`  | `boolean`         | `false`             | Standard root gets an accessible label when enabled, or `aria-hidden="true"` when disabled.                                      |
| `a11y.keyboard` | `boolean`         | `false`             | Enable arrows/Home/End selection and Enter/Space activation when a11y is also enabled. `enabled: false, keyboard: true` rejects. |
| `a11y.label`    | Nonempty `string` | `'Content tracker'` | Root accessible label when enabled. Use a meaningful name for the represented content.                                           |

The complete replacement must have a valid accessibility combination. Set both fields consistently when disabling keyboard accessibility. Logical selection is separate from browser focus; preserve visible focus and selected-item styling in custom output.

### Diagnostics

| Option                 | Type / values                                               | Default                 | Meaning and constraints                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnostics.warnings` | `boolean`                                                   | `true`                  | Gate fallback `console.warn` only; configured `output.warn`, warning stats, and the warning event remain active.                                                                 |
| `diagnostics.metrics`  | `boolean`                                                   | `false`                 | Collect render timing when a clock is available. Counters update independently of this flag.                                                                                     |
| `diagnostics.output`   | Sink object with optional `warn`/`error` functions, or null | Omitted; no custom sink | Replace console fallback per implemented severity. Null clears the sink. It is caller-owned and callbacks are best-effort; see [Diagnostics and errors](#debug-and-diagnostics). |

### Rules

Rules are processed in priority order. `selector` is required, trimmed, nonempty, and unique after normalization. The first matching rule owns an overlapping source element. Selector queries follow the source scope: an Element source searches descendants, not itself, and queries do not automatically enter shadow trees or iframes. DOM-dependent syntax is validated against the actual source at mount/mounted update boundaries.

The tables cover all **12 rule leaves**. `marker`, `scroll`, and `focus` are containers; `scroll` and `focus` also accept boolean shorthands.

#### Selection, labels, and presentation

| Field                 | Type / values                                      | Default               | Meaning and constraints                                                                                                                                                                                |
| --------------------- | -------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `selector`            | Nonempty CSS selector string                       | Required              | Trimmed unique selector; rule order determines overlapping element ownership.                                                                                                                          |
| `label`               | String, null, or `(element) => string \| null`     | `null`                | Static or synchronous source-Element label. Throw is diagnosed; non-string callback output gives no label. Promises are not awaited. Nonempty labels can supply native title.                          |
| `marker.className`    | `string`                                           | `''`                  | Normalized application classes combined with global marker classes. Reserved service classes reject.                                                                                                   |
| `marker.title`        | `boolean`                                          | Inherit global policy | Explicit true/false overrides global `marker.title`; title still needs a nonempty label. Omit to inherit, rather than supplying own `undefined`.                                                       |
| `marker.attributes`   | Plain map: string, finite number, boolean, or null | `{}`                  | Same supported names/serialization as global attributes. Rule values override globals; rule null persistently suppresses the matching inherited attribute.                                             |
| `marker.cssVariables` | Plain string map                                   | `{}`                  | Complete item map, not a patch. Accepts 17 marker/cluster Tracker variables and valid application custom properties; null rejects. Inline item values override inherited values; strings may be blank. |

For a cluster, the primary spatial marker supplies rule presentation. Global/rule classes combine, attributes override or suppress, and rule title policy overrides the global flag. See [rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/).

#### Scroll and focus

| Field             | Type / values                                                  | Default   | Meaning and constraints                                                                                                                    |
| ----------------- | -------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `scroll.enabled`  | `boolean`                                                      | `true`    | Attempt scrolling during accepted activation, before focus. `scroll: false` disables just this phase.                                      |
| `scroll.target`   | `'self'`, nonempty selector, or `(element) => Element \| null` | `'self'`  | Resolve the navigation target synchronously. It must belong to the active document and, in element mode, the authoritative scroll subtree. |
| `scroll.behavior` | `'auto' \| 'smooth'`                                           | `'auto'`  | Requested scrolling behavior.                                                                                                              |
| `scroll.align`    | `'start' \| 'center' \| 'end' \| 'nearest'`                    | `'start'` | Alignment along the represented physical axis.                                                                                             |
| `focus.enabled`   | `boolean`                                                      | `false`   | Attempt focus after scrolling. `focus: true` enables it with the default target.                                                           |
| `focus.target`    | Same target forms as `scroll.target`                           | `'self'`  | Same realm/subtree constraints; final target must be an HTMLElement.                                                                       |

Boolean `scroll`/`focus` shorthands toggle their enabled value while retaining other defaults. Target selectors search source descendants, then the containing ShadowRoot when present, then the owner document. Invalid targets, selector failures, or throwing target callbacks yield no usable target for that phase and diagnostics. Callbacks must return synchronously and must not mutate the same Tracker while resolving.

Normal declarative configuration rejects diagnostic-bearing rule replacement. Pure rule validation removes invalid rule-marker CSS names/entries from its recovered candidate, keeps valid entries, and reports diagnostics. This sanitation does not allow a normal declarative replacement to silently accept only the valid portion. [Validation and recovery](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/#validation-recovery-and-strict-updates) and [activation behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/#activation) provide the detailed contracts.

Build the desired complete list and pass a new `rules` array; use `[]` to clear it. Function-valued labels and targets remain synchronous JavaScript callbacks. There is no separate rule mutation method on the ref handle.

## Lifecycle and reconciliation

### Render, mount, and SSR

The component creates and configures its Projection runtime during React render. Server output can therefore contain resolved root and marker-layer chrome derived from options/rules. Server rendering has no mounted runtime geometry or projected tracked markers/clusters. Configuration is not delayed until hydration.

Layout effects install the event mappings and mount against the actual React-owned render root. Initial Core synchronization occurs synchronously during mount; initial synchronization notifications are staged until initial Projection state is committed. React still owns subsequent DOM commit, layout, and paint timing.

The active callback reference updates only in a committed layout effect. An interrupted or discarded render cannot replace the currently active callbacks.

### Configuration and root reconciliation

With stable roots, accepted new options/rules identities replace the complete runtime configuration and flush pending Projection work before the layout effect returns. This internal flush is not a public `flushRender()` method and does not guarantee browser paint.

A root identity change releases the current mount first, applies changed configuration, then attempts the new mount. Either null root leaves the same integration alive but unmounted; valid roots can mount it again. Same-instance stats and marker-key history survive a reversible root unmount/remount, while current mounted records are rebuilt.

A failed new mount does not restore the previous mount. Valid configuration can remain committed before that remount fails: there is no atomic adapter transaction rolling the previous configuration and roots back together. Invalid static props fail validation before Core mutation. A failed React commit/remount normally follows React's failed-component teardown path and retires that generation; recovery normally means rendering a fresh component generation through the application's React error/recovery boundary.

### Teardown and Strict Mode

True cleanup synchronously unmounts and releases event subscriptions, then schedules terminal runtime destruction in a guarded microtask. Explicit Strict Mode layout-effect replay protection cancels accidental terminal destruction when the effect setup is immediately replayed. This guarantee concerns Strict Mode replay, not arbitrary temporary-detach mechanisms.

A captured handle can briefly report `unmounted` before deferred destruction changes it to `destroyed`. Save the handle or its `whenRuntimeDestroyed()` Promise before teardown; React clears the ref. The Promise is stable for that generation and resolves after terminal cleanup attempts even if cleanup throws. Deferred cleanup failures have no active React lifecycle boundary and are contained by the cleanup path. A later component generation owns a fresh runtime.

## Events

Each optional callback receives the unchanged runtime payload synchronously when its Core semantic event is published. These seven callback props are the complete notification surface:

| Callback prop       | Semantic event     | Payload meaning and notification timing                                                                                                                        |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onMarkerActivate`  | `marker:activate`  | After scroll then focus attempts: key, source element, ruleIndex, selector, nullable label and sourceEvent.                                                    |
| `onClusterActivate` | `cluster:activate` | After primary-marker activation: key, count, markers, nullable primaryMarker and sourceEvent. Member descriptors contain key/element/ruleIndex/selector/label. |
| `onTrackActivate`   | `track:activate`   | After discrete track scrolling: nullable percentage position and sourceEvent. Continuous drag movement is excluded.                                            |
| `onSelectionChange` | `selection:change` | Committed logical selection transition: nullable previousKey and selectedKey; separate from browser focus.                                                     |
| `onSyncStart`       | `sync:start`       | Synchronization starts: reason, scheduled flag, nullable timestamp. Initial mount notifications are staged.                                                    |
| `onSyncEnd`         | `sync:end`         | Successful synchronization: markersCount, clustersCount, nullable duration and timestamp.                                                                      |
| `onWarning`         | `warning`          | After warning stats/output: code, message, open nullable details.                                                                                              |

Activation callbacks notify after Core behavior; their return values cannot cancel scrolling, focus, or activation. Disabling activation suppresses those semantic actions/notifications; drag capability is independent. Sync callbacks describe a Core transaction, not a React DOM commit, browser layout, or paint. Metrics-dependent timing can be null.

Tracker-owned payload containers are frozen; source Elements and native Events are borrowed references. Warning details is a borrowed live graph, not a deeply frozen retained diagnostic copy. Copy the values needed for application history rather than treating event payloads as snapshots.

Synchronous callback exceptions are caught by the adapter and host-reported through `globalThis.reportError()` or a microtask-throw fallback. They do not become Core `integration-event-handler-error` diagnostics or Core integration-handler error stats. Return values and thenables are ignored; catch rejections inside asynchronous callback work.

There is no `onDestroy`, generic error callback, mount callback, or unmount callback. Observe terminal completion with `whenRuntimeDestroyed()` on the captured handle.

## Imperative ref handle

A React object/callback ref receives `TrackerHandle` during the commit lifecycle. Capture it before unmount when later observation is needed.

| Method                   | Result and lifecycle                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `getState()`             | `'unmounted' \| 'mounted' \| 'destroyed'`; retained handles remain readable after teardown.                    |
| `getStats()`             | Detached, unfrozen stats clone, including retained terminal stats; external debug Core can add debug metadata. |
| `refresh()`              | Immediate Core synchronization; mounted-only, returns void. Unmounted/destroyed calls throw a lifecycle error. |
| `requestRefresh()`       | Scheduled/coalesced Core synchronization; mounted-only, returns void.                                          |
| `resetStats()`           | Alive-only counter/diagnostic/timing reset, returns void; no synchronization request. Destroyed calls reject.  |
| `whenRuntimeDestroyed()` | Stable `Promise<void>` for the captured runtime generation, including after teardown.                          |

Stats include render/rule/marker/cluster/observer counters, warning/error totals and last entries, timing, and optional debug metadata. `diagnostics.metrics` gates timing only. Reset also zeros current counters without clearing rendered records, rules, or configuration. See the [underlying stats reference](https://rightxt.github.io/tracker/docs/reference/core-runtime/#stats) for field detail.

There are no snapshots (`getSnapshot()` or `subscribeSnapshot()`), options/rules getters (`getOptions()`/`getRules()`), Core event subscriptions (`on()`/`off()`), render-root getter, boolean lifecycle getters, `render()`/`requestRender()` aliases, or consumer `destroy()`. The handle does not expose the Core integration, Projection facade, or advanced trace. Framework teardown owns terminal destruction.

## Observation and manual refresh

A normal React rerender with unchanged options/rules/root identities does not itself request Core synchronization. Callback changes also do not recreate or synchronize the runtime. External source DOM/layout changes use the configured automatic mutation, resize, scroll, and interval sources or explicit `refresh()`; use `requestRefresh()` for scheduled/coalesced work after a handle is mounted.

CSS/CSSOM-only geometry changes may require explicit refresh. Disabling automatic sources shifts their synchronization responsibility to the caller; disabling scroll updates also stops automatic viewport synchronization. Initial mounting and accepted declarative configuration changes still synchronize. The [updates and refresh guide](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/) explains target resolution, scheduler reasons, and invalidation boundaries.

## Environments

### Documents and containers

The actual React-owned `.rxtt` ownerDocument/Window defines the active realm. With roots omitted, source scope is that document's body and scrolling uses its Window. Page-scroller element aliases also select window mode.

An HTMLElement `scrollRoot` selects one authoritative element scroll range; omitted source scope then resolves to that element. Explicit sources must satisfy same-document and scroll-subtree constraints. Relevant descendant scrolling is separately observed for invalidation, without representing extra scroll ranges. The track stays where React rendered it, so place it alongside the intended scroll container and use the supported container geometry/CSS profile described in [environments](https://rightxt.github.io/tracker/docs/guides/environments/).

Use null for either root while a DOM ref is unavailable; it keeps the shell visually hidden and non-interactive and the runtime unmounted. Once both roots are valid or undefined, reconciliation can mount.

Use a connected scroll container in a standards-mode document with a positive client extent along the represented axis. Supported container displays are block, flow-root, flex, inline-flex, grid, inline-grid, and inline-block; represented-axis overflow must be auto, scroll, or hidden. Active scroll snap, reverse flex/wrap that reverses that axis, and replaced/form-control elements are outside the supported profile. A zero current scroll range is valid. Overlay alignment, transforms, zoom, and surrounding layout remain application responsibilities.

### Shadow DOM

An open ShadowRoot can be source scope. Selectors do not automatically pierce shadow boundaries. Output can live in a shadow tree when the surrounding React renderer actually creates Tracker's DOM there; install package/theme CSS in that style scope. Keep all roots in the same active document.

### Same-origin iframes and navigation

Tracker has no `renderHost` or portal-target prop. The surrounding React renderer must place the actual Tracker DOM/root in the child document, with compatible child-document sources and scroll roots. The resulting render root selects that child realm. A parent-document Tracker cannot target iframe source/scroll roots; mixed roots reject with `ERR_TRACKER_REALM_MISMATCH`.

Load the stylesheet in the child document. There is no cross-origin bridge. The adapter does not watch render-root ownerDocument changes: after iframe navigation, recreate Tracker in the new document or use a genuine new-root lifecycle/reconciliation with fresh realm identities. Stale DOM objects and relocating output without root reconciliation are insufficient.

## Styling

Import `@rightxt/tracker-react/style.css` before application theme CSS. JavaScript does not inject the canonical stylesheet. Imported/global styles must reach the generated `.rxtt`; CSS Modules do not automatically target Tracker service classes. Shadow and iframe output need styles in their actual scope.

| Service class     | Role                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `.rxtt`           | Track root; use `track.className` for additional application classes.  |
| `.rxtt__viewport` | Viewport indicator; use `viewport.className`.                          |
| `.rxtt__markers`  | Marker layer; use `markerLayer.className`.                             |
| `.rxtt__marker`   | Marker/cluster item; global and rule marker presentation compose here. |

Use root `options.cssVariables`, rule `marker.cssVariables`, supported attributes, and reachable CSS. Committed root option strings remain unchanged; standard Projection root output trims nonblank values and omits blank/whitespace-only values. React adds no second normalization layer. Item/rule style maps follow the item style path; the root trim/drop rule is not a promise about every item map.

Renderer-owned geometry variables and `data-rxtt-*` metadata are not application configuration or business identifiers. `data-rxtt-drag="true"` means drag capability enabled, not an active drag session. Preserve visible focus and selected-item styling.

The [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/) contains the full 33-root-variable/17-rule-variable contract and metadata names. Use the [Theme Builder source entry](https://rightxt.github.io/tracker/tools/theme-builder/) to explore themes.

## Debug and diagnostics

The adapter imports neutral external Core entries. A resolver selecting Core's `development` condition composes the same React API with debug Core; `getStats()` may include `debug` metadata. Merely using React development mode does not substitute for external Core resolution. There is no React-local debug JavaScript artifact and `getTrackerDebugTrace()` is not adapter API because the underlying Projection integration remains private.

Configure diagnostic output through `options.diagnostics.output`; warning notifications use `onWarning`. `diagnostics.warnings` gates only fallback `console.warn`, leaving the configured sink, warning stats/events, and errors active. `diagnostics.metrics` gates timing, not counters.

Core configuration/lifecycle errors can propagate through render, layout effects, and handle operations with their classes/codes preserved. Examples include `TrackerConfigurationError` and `TrackerLifecycleError`, with `ERR_TRACKER_INVALID_CONTEXT`, `ERR_TRACKER_DESTROYED`, or `ERR_TRACKER_REALM_MISMATCH` where applicable. Error classes/code types are not re-exported by this package. Native TypeError for `options.rules` and cleanup AggregateError are additional boundaries; there is no adapter-local error-code family.

Consumer callback errors use the host-reporting boundary described in Events and do not become Core integration-handler diagnostics. Handle configuration/lifecycle failures according to the application's React error boundary and recovery flow. The [runtime diagnostics reference](https://rightxt.github.io/tracker/docs/reference/core-runtime/#diagnostic-channels) adds channel detail without granting snapshot or trace access through this handle.

## Demos and further documentation

These links open repository source documentation:

- [React playground](https://rightxt.github.io/tracker/playgrounds/react/): package setup and interactive options.
- [React container scenario](https://rightxt.github.io/tracker/scenarios/container/react/): component placement beside an element scroller.
- [React events scenario](https://rightxt.github.io/tracker/scenarios/events/react/): callback payloads and synchronization timing.
- [Environments](https://rightxt.github.io/tracker/docs/guides/environments/), [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/), [rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/), and [styling](https://rightxt.github.io/tracker/docs/reference/styling/): supplementary workflow and reference detail.
