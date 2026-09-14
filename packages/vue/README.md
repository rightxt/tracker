# @rightxt/tracker-vue

[![npm version](https://img.shields.io/npm/v/%40rightxt%2Ftracker-vue)](https://www.npmjs.com/package/@rightxt/tracker-vue) [![Vue](https://img.shields.io/npm/dependency-version/%40rightxt%2Ftracker-vue/peer/vue?label=Vue&logo=vuedotjs)](https://vuejs.org/) [![TypeScript declarations](https://img.shields.io/npm/types/%40rightxt%2Ftracker-vue)](https://www.npmjs.com/package/@rightxt/tracker-vue)

## Overview

RXT Tracker adds a track with markers for source elements matched by ordered CSS selector rules. The Vue 3.5+ component owns the rendered track; a private Core Projection integration measures source content, groups markers, handles activation, and observes changes.

Configure the component through props, receive notifications through Vue emits, and use an exposed template-ref handle for runtime state and explicit synchronization.

## Installation, artifacts and debug model

```sh
pnpm add @rightxt/tracker-vue
```

Vue is an external peer with range `>=3.5 <4`. Core is a regular dependency and remains external in the built adapter.

| Import path                         | Contents                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@rightxt/tracker-vue`              | Normal ESM component `Tracker` and its `default` alias; types `TrackerProps` and `TrackerHandle`. |
| `@rightxt/tracker-vue/style.css`    | Canonical stylesheet; load it explicitly.                                                         |
| `@rightxt/tracker-vue/package.json` | Package metadata resource.                                                                        |

The root resolves to `dist/rxt-tracker-vue.mjs` with `dist/index.d.ts` declarations. There is one normal ESM adapter entry, no package-local `/debug` ESM path, and no standalone/global browser bundle or standalone debug JavaScript. Debug behavior comes from neutral external Core condition selection; see [Debug and diagnostics](#debug-and-diagnostics).

## Quick start

Tracker is a normal Vue component. The same props, emits, update-identity, and exposed-handle contracts apply when using <script setup>, the Options API, or another standard Vue component authoring style.

```vue
<script lang="ts">
import { defineComponent, shallowRef } from 'vue';
import { Tracker, type TrackerProps } from '@rightxt/tracker-vue';
import '@rightxt/tracker-vue/style.css';

export default defineComponent({
  name: 'ArticleTracker',
  components: { Tracker },
  setup() {
    const options = shallowRef<TrackerProps['options']>({
      a11y: { enabled: true, keyboard: true },
    });
    const rules = shallowRef<TrackerProps['rules']>([{ selector: '.article-section', label: (element) => element.textContent }]);

    function showIndividualMarkers() {
      options.value = { ...options.value, clustering: { enabled: false } };
    }

    function handleMarkerActivate(payload: { selector: string }) {
      console.log(payload.selector);
    }

    return { options, rules, showIndividualMarkers, handleMarkerActivate };
  },
});
</script>

<template>
  <button type="button" @click="showIndividualMarkers">Show individual markers</button>
  <main>
    <h1>Article</h1>
    <h2 class="article-section">Introduction</h2>
    <p>Your article content goes here.</p>
    <h2 class="article-section">Details</h2>
  </main>
  <Tracker :options="options" :rules="rules" @marker-activate="handleMarkerActivate" />
</template>
```

The shallow refs preserve top-level identities until replacement. The article is outside `Tracker`; default source scope finds it in the component root's document body. Vue owns teardown.

## Component model and concepts

A **source element** is a matched DOM element. A **rule** selects sources and defines labels, presentation, scrolling, and focus. A **marker** represents one source position; a **cluster** groups nearby markers with a primary marker. The **track** represents the scroll range; its **viewport indicator** represents the visible portion. Logical selection is distinct from browser focus.

`Tracker` is the `RxtTracker` Vue component. It renders a `.rxtt` root without an extra wrapper, with `.rxtt__viewport`, `.rxtt__markers`, and `.rxtt__marker` descendants. Vue owns this DOM. Source and scroll roots select what is tracked; they do not move the component's output.

The complete prop surface is:

| Prop         | Type / default                                                            | Contract                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`    | Partial options object; omitted/`undefined` means `{}`                    | Whole non-rule configuration; replace object identity to update.                                                                                                          |
| `rules`      | Readonly ordered rule array; omitted/`undefined` means `[]`               | Only rule channel; replace the complete list identity. Null rejects.                                                                                                      |
| `sourceRoot` | Document, Element, open ShadowRoot, null, or undefined; default undefined | Selector scope. Omission resolves to the actual render root's ownerDocument body in window mode, or the scroll element in element mode. Null keeps the runtime unmounted. |
| `scrollRoot` | Window, HTMLElement, null, or undefined; default undefined                | Undefined, active Window, and page-scroller element aliases use window mode; other HTMLElements use element mode. Null keeps the runtime unmounted.                       |

The seven [emits](#events) are separate from these four props. Default slots/content do not define `sourceRoot`; default and named slots are not forwarded as tracked content. The component uses `inheritAttrs: false` and does not forward fallthrough attributes or classes to `.rxtt`. Use options/rules and reachable CSS. There is no Tracker render-target or `renderHost` prop; Vue Teleport is not a substitute for the package's realm requirements.

## Configuration

Supply whole `options` and whole `rules` values. There is no patch-style options API, incremental rule API, or declarative `{ render: false }` escape. An own `options.rules` key throws native TypeError; rules belong only to the separate prop.

Vue's adapter uses shallow/reference identity gating, not deep watch semantics. Mutating `options.a11y.label` inside the same options object or editing the same rules array in place is not a supported declarative update signal. Assign a new object or new rules array. Omitted option leaves reset to replacement defaults; omitted rules resolve to the empty list.

The tables below cover all **36 option leaves**. Every field is optional; structural containers are not additional leaves. Known own undefined values inside configuration and unknown fields reject. Null is valid only where explicitly listed. Normal configuration rejects any diagnostic, including warnings, without partially accepting that candidate.

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

Build the desired complete list and supply a new `rules` array; `[]` clears it. Function-valued labels and targets remain synchronous JavaScript callbacks. There is no separate rule mutation method on the exposed handle.

## Lifecycle and reconciliation

### Setup and mounting

One Projection runtime is created and initial options/rules are validated during component `setup()`. In `onMounted()`, the adapter installs seven event mappings and mounts if the render root exists and both root props are non-null. Initial Core synchronization is synchronous inside mount; initial synchronization notifications are staged until initial Projection state has committed.

DOM mounting belongs to the browser `onMounted()` lifecycle. Runtime creation in setup is distinct from measured, mounted geometry; do not use handle synchronization before mount.

### Shallow post-flush updates and recovery

A shallow `watch` with `flush: 'post'` observes options, rules, sourceRoot, and scrollRoot identities. With unchanged roots, new configuration identities cause complete configuration replacement and flush pending Projection work while mounted. The flush completes before reconciliation returns, but Vue owns the subsequent DOM patch and browser paint timing.

For a root change, the current mount unmounts first, changed configuration is committed, and the new mount is attempted. Either null root leaves the same integration alive but unmounted, with its shell hidden and non-interactive. Later valid roots can remount it. Stats and marker-key history persist within that same runtime; current mounted records are rebuilt.

A failed root mount does not restore the old mount. A valid replacement configuration can remain committed before the new mount fails. There is no multi-operation adapter rollback restoring the previous configuration and roots together. Static validation precedes side effects, so an invalid static configuration does not partially replace committed runtime configuration.

A failed remount may leave the same integration alive and unmounted. Correct the root props with valid new identities to recover that component generation. This recovery does not require creating a fresh runtime.

### Component teardown

`onBeforeUnmount()` removes event mappings and synchronously destroys the runtime. Cleanup errors can propagate through Vue lifecycle handling as an error or AggregateError. A later component setup creates a fresh runtime.

Capture the handle or `whenRuntimeDestroyed()` Promise before Vue clears the template ref. The Promise is stable for the captured generation and resolves after terminal cleanup attempts even if cleanup throws. The adapter has no special KeepAlive/deactivation lifecycle contract; ordinary rerenders and explicit root changes do not imply support for arbitrary temporary detachment.

## Events

The component declares exactly seven emits. Each forwards the unchanged Core payload synchronously through the current Vue emit channel:

| Emit               | Semantic event     | Payload meaning and notification timing                                                                                                                        |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marker-activate`  | `marker:activate`  | After scroll then focus attempts: key, source element, ruleIndex, selector, nullable label and sourceEvent.                                                    |
| `cluster-activate` | `cluster:activate` | After primary-marker activation: key, count, markers, nullable primaryMarker and sourceEvent. Member descriptors contain key/element/ruleIndex/selector/label. |
| `track-activate`   | `track:activate`   | After discrete track scrolling: nullable percentage position and sourceEvent. Continuous drag movement is excluded.                                            |
| `selection-change` | `selection:change` | Committed logical selection transition: nullable previousKey and selectedKey; separate from browser focus.                                                     |
| `sync-start`       | `sync:start`       | Synchronization starts: reason, scheduled flag, nullable timestamp. Initial mount notifications are staged.                                                    |
| `sync-end`         | `sync:end`         | Successful synchronization: markersCount, clustersCount, nullable duration and timestamp.                                                                      |
| `warning`          | `warning`          | After warning stats/output: code, message, open nullable details.                                                                                              |

Activation emits notify after Core behavior; listener return values cannot cancel scrolling, focus, or activation. Disabling activation suppresses those semantic actions/notifications; drag capability is independent. Sync emits describe a Core transaction, not a Vue DOM patch, browser layout, or paint. Metrics-dependent timing can be null.

Tracker-owned payload containers are frozen; source Elements and native Events are borrowed. Warning details is a borrowed live graph, not a deeply frozen retained diagnostic copy. Copy values needed for application history.

Vue owns listener dispatch, sibling/array ordering, and its listener error handling. The adapter does not cache individual listeners: it uses the current emit channel. If a synchronous failure escapes `emit()`, the adapter catches and host-reports it through `globalThis.reportError()` or a microtask-throw fallback. That escaped failure is kept out of Core `integration-event-handler-error` diagnostics and integration-handler error stats.

The adapter does not await or inspect listener returns. Vue observes rejected listener Promises according to its runtime configuration; catch asynchronous work explicitly when a controlled application reporting path is needed.

There is no `destroy` emit, generic error emit, mount emit, or unmount emit. Use `whenRuntimeDestroyed()` on the captured handle for terminal completion.

## Exposed handle

A normal template ref is populated by Vue's lifecycle. Give `Tracker` a template ref and retain the exposed `TrackerHandle` before unmount when needed:

```vue
<script lang="ts">
import { defineComponent, shallowRef } from 'vue';
import { Tracker, type TrackerHandle } from '@rightxt/tracker-vue';
import '@rightxt/tracker-vue/style.css';

export default defineComponent({
  components: { Tracker },
  setup() {
    const tracker = shallowRef<TrackerHandle | null>(null);

    function refreshTrackedContent() {
      if (tracker.value?.getState() === 'mounted') {
        tracker.value.refresh();
      }
    }

    return { tracker, refreshTrackedContent };
  },
});
</script>

<template>
  <button type="button" @click="refreshTrackedContent">Refresh tracked content</button>
  <Tracker ref="tracker" />
</template>
```

This handle exposes exactly six methods:

| Method                   | Result and lifecycle                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `getState()`             | `'unmounted' \| 'mounted' \| 'destroyed'`; captured handles remain readable after teardown.                    |
| `getStats()`             | Detached, unfrozen stats clone, including retained terminal stats; external debug Core may add debug metadata. |
| `refresh()`              | Immediate Core synchronization; mounted-only, returns void. Unmounted/destroyed calls throw a lifecycle error. |
| `requestRefresh()`       | Scheduled/coalesced Core synchronization; mounted-only, returns void.                                          |
| `resetStats()`           | Alive-only counter/diagnostic/timing reset, returns void; no synchronization request. Destroyed calls reject.  |
| `whenRuntimeDestroyed()` | Stable `Promise<void>` for the captured runtime generation, including after teardown.                          |

Stats include render/rule/marker/cluster/observer counters, warning/error totals and last entries, timing, and optional debug metadata. `diagnostics.metrics` gates timing only. Reset also zeros current counters without clearing rendered records or configuration. The [underlying stats reference](https://rightxt.github.io/tracker/docs/reference/core-runtime/#stats) gives field detail.

There are no snapshots (`getSnapshot()`/`subscribeSnapshot()`), options/rules getters (`getOptions()`/`getRules()`), Core event subscriptions (`on()`/`off()`), render-root getter, boolean lifecycle getters, `render()`/`requestRender()` aliases, or consumer `destroy()`. The exposed handle does not provide the Core integration, Projection facade, or advanced trace. Vue teardown owns terminal destruction; retained handle functions continue to target their original generation.

## Observation and manual refresh

A normal Vue rerender with unchanged options/rules/root identities is not a generic Core synchronization request. External source DOM/layout changes use configured mutation, resize, scroll, and interval updates or explicit `refresh()`. Use `requestRefresh()` for scheduled/coalesced synchronization while mounted.

CSS/CSSOM-only geometry changes may require explicit refresh. Disabling automatic sources shifts their synchronization responsibility to the caller; disabling scroll updates also stops automatic viewport synchronization. Initial mounting and accepted declarative configuration updates still synchronize. See [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/) for observer target resolution and scheduling.

## Environments

### Documents and containers

The actual Vue-owned `.rxtt` ownerDocument/Window defines the active realm. With roots omitted, source scope is that document's body and scrolling uses its Window. Page-scroller element aliases also select window mode.

An HTMLElement `scrollRoot` selects one authoritative element scroll range; omitted sourceRoot then resolves to the scroll element. Explicit sources must satisfy same-document and scroll-subtree constraints. Relevant descendant scrolling is separately observed for invalidation; it does not add independently represented scroll ranges. Output stays at the component's render location. Place the track beside the container and follow the supported geometry/CSS profile in [environments](https://rightxt.github.io/tracker/docs/guides/environments/).

Use null roots while DOM refs are unavailable. The shell remains hidden and non-interactive while the same runtime is unmounted; valid/undefined roots can mount it again.

Use a connected scroll container in a standards-mode document with a positive client extent along the represented axis. Supported container displays are block, flow-root, flex, inline-flex, grid, inline-grid, and inline-block; represented-axis overflow must be auto, scroll, or hidden. Active scroll snap, reverse flex/wrap that reverses that axis, and replaced/form-control elements are outside the supported profile. A zero current scroll range is valid. Overlay alignment, transforms, zoom, and surrounding layout remain application responsibilities.

### Shadow DOM

Open ShadowRoot source scope is supported. Selectors do not automatically pierce shadow boundaries. Output can live in a shadow tree when Vue actually renders Tracker there; install package/theme CSS in that scope and keep all roots in the same active document.

### Same-origin iframes and Teleport

The safe form is a Vue application/render root genuinely created in the child document/realm, with Tracker and source/scroll roots there. Load package CSS in that child document. A parent-document Tracker cannot target child source/scroll roots; mixed roots reject with `ERR_TRACKER_REALM_MISMATCH`.

Parent-realm Vue Teleport into a child iframe is not fully realm-safe for this adapter. Item registration checks ambient-realm `instanceof HTMLElement`; child elements can fail that check, making selection registration/selected-attribute behavior unreliable. There is no custom Tracker render-target prop or cross-origin bridge.

After navigation, recreate the iframe-local component with fresh document/root identities. The adapter does not watch render-root ownerDocument changes, so stale roots or Teleport relocation alone do not establish a fresh realm lifecycle.

## Styling

Import `@rightxt/tracker-vue/style.css` before application theme CSS. JavaScript does not inject the canonical stylesheet. The stylesheet must reach the actual `.rxtt` scope. Global CSS is a reliable default; arbitrary parent scoped CSS does not automatically style all Tracker internals. Use Vue's appropriate deep/global styling reach when using scoped styles. Fallthrough classes/attributes are not forwarded.

| Service class     | Role                                                            |
| ----------------- | --------------------------------------------------------------- |
| `.rxtt`           | Track root; add application classes through `track.className`.  |
| `.rxtt__viewport` | Viewport indicator; use `viewport.className`.                   |
| `.rxtt__markers`  | Marker layer; use `markerLayer.className`.                      |
| `.rxtt__marker`   | Marker/cluster item; global and rule presentation compose here. |

Use `options.cssVariables`, rule `marker.cssVariables`, supported attributes, and reachable CSS. Committed root strings remain unchanged; standard Projection root output trims nonblank strings and omits blank/whitespace-only values. Vue adds no second normalization pass. Item/rule style maps follow the Vue item style path; do not apply the root trim/drop guarantee to every item map.

Renderer-owned geometry and `data-rxtt-*` metadata are not application configuration or business identifiers. `data-rxtt-drag="true"` denotes enabled drag capability, not an active drag session. Preserve focus and selected-item styling. Shadow trees and child documents require CSS in their own scope.

The [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/) documents all 33 root variables, 17 rule variables, and service metadata. The [Theme Builder source entry](https://rightxt.github.io/tracker/tools/theme-builder/) provides theme exploration.

## Debug and diagnostics

Neutral external Core entries keep the Vue API independent of Core build selection. A resolver activating Core's `development` condition composes debug Core, which may add `debug` metadata to `getStats()`. Vue development mode alone does not replace external Core resolution. There is no Vue-local debug JavaScript artifact. `getTrackerDebugTrace()` is not exposed; the underlying Projection integration stays private.

Use `options.diagnostics.output` for diagnostic sinks and the `warning` emit for warning notifications. `diagnostics.warnings` controls only fallback `console.warn`, not the configured sink, warning stats/events, or errors. Metrics controls timing only.

Core configuration/lifecycle errors can propagate through setup, prop reconciliation, lifecycle hooks, and handle methods. Their classes/codes are preserved but not re-exported by this package. Examples include `TrackerConfigurationError`, `TrackerLifecycleError`, `ERR_TRACKER_INVALID_CONTEXT`, `ERR_TRACKER_DESTROYED`, and `ERR_TRACKER_REALM_MISMATCH` where applicable. Native TypeError for `options.rules` and cleanup AggregateError are additional boundaries; no Vue-local stable error-code family is exposed.

Vue dispatch/error handling owns listener failures. Exceptions escaping emits are caught and host-reported by the adapter rather than counted as Core integration-handler failures. This listener boundary is separate from configuration/lifecycle error propagation. The [runtime diagnostics reference](https://rightxt.github.io/tracker/docs/reference/core-runtime/#diagnostic-channels) adds channel detail without exposing snapshots or trace through the Vue handle.

## Demos and further documentation

These links open repository source documentation:

- [Vue playground](https://rightxt.github.io/tracker/playgrounds/vue/): component setup and interactive configuration.
- [Vue container scenario](https://rightxt.github.io/tracker/scenarios/container/vue/): positioning the track beside an element scroller.
- [Vue events scenario](https://rightxt.github.io/tracker/scenarios/events/vue/): emits and synchronization timing.
- [Environments](https://rightxt.github.io/tracker/docs/guides/environments/), [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/), [rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/), and [styling](https://rightxt.github.io/tracker/docs/reference/styling/): supplementary workflow and field detail.
