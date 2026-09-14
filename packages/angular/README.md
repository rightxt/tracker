# @rightxt/tracker-angular

[![npm version](https://img.shields.io/npm/v/%40rightxt%2Ftracker-angular)](https://www.npmjs.com/package/@rightxt/tracker-angular) [![Angular](https://img.shields.io/npm/dependency-version/%40rightxt%2Ftracker-angular/peer/%40angular%2Fcore?label=Angular&logo=angular)](https://angular.dev/) [![TypeScript declarations](https://img.shields.io/npm/types/%40rightxt%2Ftracker-angular)](https://www.npmjs.com/package/@rightxt/tracker-angular)

## Overview

RXT Tracker adds a track with markers for source elements matched by ordered CSS selector rules. `TrackerComponent` is a standalone Angular 22 component. Angular owns the rendered track; a private Core Projection integration measures content, groups markers, handles activation, and observes changes.

Use signal inputs for configuration, Angular outputs for notifications, and component instance methods for runtime state and explicit synchronization.

## Installation, artifacts and debug model

```sh
pnpm add @rightxt/tracker-angular
```

`@angular/core` and `@angular/common` are external peers, each with range `>=22 <23`. Core is a regular dependency and remains external in the built adapter.

| Import path                             | Contents                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `@rightxt/tracker-angular`              | `TrackerComponent`, the sole runtime export and exported class type. No default alias. |
| `@rightxt/tracker-angular/style.css`    | Canonical stylesheet; load it explicitly.                                              |
| `@rightxt/tracker-angular/package.json` | Package metadata resource.                                                             |

The package is ESM-only and partial-compiled for Angular's linker. The root resolves to `dist/rxt-tracker-angular.mjs` with `dist/public-api.d.ts` declarations. There is one normal ESM adapter entry, no package-local `/debug` ESM path, and no standalone/global browser bundle or standalone debug JavaScript. Debug behavior comes from neutral external Core condition selection; see [Debug, diagnostics and zones](#debug-diagnostics-and-zones).

## Quick start

`TrackerComponent` is a normal standalone Angular component. It can be imported directly by standalone components or through the `imports` of an NgModule-based application. The same inputs, outputs, update-identity, lifecycle, and imperative-method contracts apply in either application style.

Load the package stylesheet in your application's global styles entry:

```css
@import '@rightxt/tracker-angular/style.css';
```

For a build that handles CSS imports from JavaScript, the equivalent entry import is `import '@rightxt/tracker-angular/style.css';`. The standalone application component can then bind the public inputs and outputs:

```ts
import { Component, signal } from '@angular/core';
import { TrackerComponent } from '@rightxt/tracker-angular';

@Component({
  selector: 'app-article',
  imports: [TrackerComponent],
  template: `
    <button type="button" (click)="showIndividualMarkers()">Show individual markers</button>
    <main>
      <h1>Article</h1>
      <h2 class="article-section">Introduction</h2>
      <p>Your article content goes here.</p>
      <h2 class="article-section">Details</h2>
    </main>
    <rxt-tracker-angular [options]="options()" [rules]="rules" (markerActivate)="handleMarkerActivate($event)" />
  `,
})
export class ArticleComponent {
  readonly options = signal({
    a11y: { enabled: true, keyboard: true },
    clustering: { enabled: true },
  });
  readonly rules = [{ selector: '.article-section', label: (element: Element) => element.textContent }];

  showIndividualMarkers(): void {
    this.options.update((options) => ({
      ...options,
      clustering: { enabled: false },
    }));
  }

  handleMarkerActivate(payload: { selector: string }): void {
    console.log(payload.selector);
  }
}
```

The button creates a new options identity. Source content lives outside `rxt-tracker-angular`; default source scope finds it in the internal render root's document body. Angular owns teardown. Normal use needs no Tracker NgModule, separate internal directive, service, or Tracker-specific provider.

## NgModule-based applications

`TrackerComponent` remains standalone when consumed from an NgModule-based application. Import it through the NgModule's `imports`; do not add it to `declarations`:

```ts
import { NgModule } from '@angular/core';
import { TrackerComponent } from '@rightxt/tracker-angular';

@NgModule({
  imports: [TrackerComponent],
})
export class ArticleModule {}
```

Components declared by that NgModule can then use `<rxt-tracker-angular>` in their templates with the same inputs, outputs, update-identity, lifecycle, and imperative-method contracts shown throughout this README. No Tracker-specific NgModule is required.

## Component model and concepts

A **source element** is a matched DOM element. A **rule** selects sources and configures labels, presentation, scrolling, and focus. A **marker** represents one source position; a **cluster** groups nearby markers with a primary marker. The **track** represents a scroll range and its **viewport indicator** represents the visible portion. Logical selection is distinct from browser focus.

The selector is `rxt-tracker-angular`. The component uses OnPush change detection with signal inputs and effect-driven reconciliation. Its host contains the Angular template-owned `.rxtt` root, with `.rxtt__viewport`, `.rxtt__markers`, and `.rxtt__marker` descendants. The host and internal Core render root are different elements.

All four signal inputs are:

| Input        | Type / default                                                            | Contract                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`    | Partial options object; omitted/`undefined` means `{}`                    | Complete non-rule configuration; new identity replaces the value.                                                                                                           |
| `rules`      | Readonly ordered rule array; omitted/`undefined` means `[]`               | Only rule channel; new array identity replaces the complete list. Null rejects.                                                                                             |
| `sourceRoot` | Document, Element, open ShadowRoot, null, or undefined; default undefined | Selector scope. Omission resolves to the internal render root's ownerDocument body in window mode, or the scroll element in element mode. Null keeps the runtime unmounted. |
| `scrollRoot` | Window, HTMLElement, null, or undefined; default undefined                | Undefined, active Window, and page-scroller element aliases use window mode; other HTMLElements use element mode. Null keeps the runtime unmounted.                         |

The seven [outputs](#events) are separate from these inputs. Projected content/template children do not define Tracker source scope; tracked content can be elsewhere within the explicit `sourceRoot`. Root inputs select source and scrolling context, not output placement. There is no render-target, portal, or `renderHost` input.

## Configuration

Supply whole `options` and whole `rules` values through their signal inputs. There is no patch-style options API, incremental rule API, or declarative `{ render: false }` escape. An own `options.rules` key throws native TypeError; rules belong only to the separate input.

Top-level identity is the declarative update boundary. Mutating `options.a11y.label` on the same options object or changing the same rules array in place is not a supported update signal. Provide a new object or new rules array through the binding. Omitted option leaves reset to replacement defaults; omitted rules resolve to the empty list.

The tables cover all **36 option leaves**. Every field is optional; structural containers are not additional leaves. Known own undefined values inside configuration and unknown fields reject. Null is valid only where explicitly listed. Computed configuration validation rejects any diagnostic, including warnings, without partially accepting that candidate.

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

| Option                 | Type / values                                               | Default                 | Meaning and constraints                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnostics.warnings` | `boolean`                                                   | `true`                  | Gate fallback `console.warn` only; configured `output.warn`, warning stats, and the warning event remain active.                                                                       |
| `diagnostics.metrics`  | `boolean`                                                   | `false`                 | Collect render timing when a clock is available. Counters update independently of this flag.                                                                                           |
| `diagnostics.output`   | Sink object with optional `warn`/`error` functions, or null | Omitted; no custom sink | Replace console fallback per implemented severity. Null clears the sink. It is caller-owned and callbacks are best-effort; see [Diagnostics and errors](#debug-diagnostics-and-zones). |

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

Build the desired complete list and bind a new `rules` array; `[]` clears it. Function-valued labels and targets remain synchronous JavaScript callbacks. There is no separate rule mutation method on the component instance.

## Lifecycle and reconciliation

### Construction, server rendering, and view initialization

One Core Projection runtime is created during component construction outside Angular's zone with initial empty configuration. Runtime creation is independent of DOM mounting. Current inputs are validated and reflected by computed chrome even on the server; the server shell has unavailable geometry and no projected items. Browser gating prevents server DOM mounting.

In the browser, `ngAfterViewInit()` runs after the internal render root exists. It installs seven event mappings, applies current configuration while unmounted, and mounts when both root inputs are non-null. Initial synchronization completes synchronously inside Core mount. Angular change detection owns application of the resulting signal changes to the view.

### Effect-driven reconciliation and recovery

After view initialization, a browser-gated effect compares options/rules/root identities. With stable roots, valid new configuration replaces the complete runtime configuration and flushes pending Projection work while mounted, outside Angular's zone. Core flush completion is not an Angular view-commit or browser-paint guarantee.

For changed roots, the current mount unmounts first, changed configuration is committed, and a new mount is attempted against the internal render root. Either null root keeps that component-generation integration alive but unmounted, with the shell hidden and non-interactive. Later valid root inputs can mount it again. Same-instance stats and marker-key history survive reversible root remounts; current mounted records are rebuilt.

A failed new mount does not restore the old mount. A valid configuration replacement can remain committed before the subsequent root mount fails. The adapter does not roll the old configuration and roots back as one atomic transaction. Static validation runs before side effects for that reconciliation, so invalid static configuration does not partially replace the runtime configuration.

A failed root remount may leave the same component-generation runtime unmounted and recoverable. Supply corrected roots with new identities to attempt mounting that generation again.

### Destruction

`ngOnDestroy()` terminally destroys the runtime and releases event subscriptions. Cleanup errors can propagate from the lifecycle hook as one error or AggregateError. A later component instance owns a fresh runtime.

Capture the instance or `whenRuntimeDestroyed()` Promise before Angular teardown when terminal observation is needed. The Promise is stable for the captured generation and resolves after terminal cleanup attempts even if cleanup throws. Consumers do not call an underlying integration's destroy method; Angular owns teardown.

## Events

Exactly seven Angular outputs synchronously forward unchanged runtime payloads through `NgZone.run(() => output.emit(payload))`:

| Output            | Semantic event     | Payload meaning and notification timing                                                                                                                        |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markerActivate`  | `marker:activate`  | After scroll then focus attempts: key, source element, ruleIndex, selector, nullable label and sourceEvent.                                                    |
| `clusterActivate` | `cluster:activate` | After primary-marker activation: key, count, markers, nullable primaryMarker and sourceEvent. Member descriptors contain key/element/ruleIndex/selector/label. |
| `trackActivate`   | `track:activate`   | After discrete track scrolling: nullable percentage position and sourceEvent. Continuous drag movement is excluded.                                            |
| `selectionChange` | `selection:change` | Committed logical selection transition: nullable previousKey and selectedKey; separate from browser focus.                                                     |
| `syncStart`       | `sync:start`       | Synchronization starts: reason, scheduled flag, nullable timestamp. Initial mount notifications are staged.                                                    |
| `syncEnd`         | `sync:end`         | Successful synchronization: markersCount, clustersCount, nullable duration and timestamp.                                                                      |
| `warning`         | `warning`          | After warning stats/output: code, message, open nullable details.                                                                                              |

Activation outputs notify after Core behavior; subscriber return values cannot cancel scrolling, focus, or activation. Disabling activation suppresses those semantic actions/notifications; drag capability is independent. Sync outputs describe a Core transaction, not an Angular view commit, browser layout, or paint. Metrics-dependent timing can be null.

Tracker-owned payload containers are frozen; source Elements and native Events are borrowed. Warning details is a borrowed live graph, not a deeply frozen retained diagnostic copy. Copy values needed for application history.

Angular owns normal output subscriber error routing. The adapter adds **no catch around `output.emit()`**. If an exception escapes Angular/framework/application output handling, it may propagate through the adapter's Core integration event callback and then enter Core handler-failure containment and error accounting. This is a possible path, not a claim that every subscriber exception reaches Core.

Core, this adapter, and Angular's `output()` channel do not await or inspect subscriber return values. A returned rejected Promise can reach the application's unhandled-rejection channel; asynchronous subscribers should catch their own rejections.

There is no `destroy` output, generic error output, mount output, or unmount output. Observe terminal completion through `whenRuntimeDestroyed()` on the captured component instance.

## Imperative methods

The recommended high-level consumer API consists of the four inputs, seven outputs, and these six normal component instance methods. Obtain the instance through an Angular view query or component reference.

| Method                   | Result and lifecycle                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `getState()`             | `'unmounted' \| 'mounted' \| 'destroyed'`; readable before view initialization and on a retained destroyed instance.               |
| `getStats()`             | Detached, unfrozen stats clone, including retained terminal stats; external debug Core may add debug metadata.                     |
| `refresh()`              | Immediate Core synchronization; mounted-only, returns void. Unmounted/destroyed calls throw a lifecycle error.                     |
| `requestRefresh()`       | Scheduled/coalesced Core synchronization; mounted-only, returns void.                                                              |
| `resetStats()`           | Alive-only counter/diagnostic/timing reset, returns void; no synchronization request. Usable before mount; destroyed calls reject. |
| `whenRuntimeDestroyed()` | Stable `Promise<void>` for the captured runtime generation, including before mount and after teardown.                             |

Stats include render/rule/marker/cluster/observer counters, warning/error totals and last entries, timing, and optional debug metadata. `diagnostics.metrics` gates timing only. Reset zeros current counters without clearing rendered records or configuration. The [underlying stats reference](https://rightxt.github.io/tracker/docs/reference/core-runtime/#stats) gives field detail.

There are no snapshots (`getSnapshot()`/`subscribeSnapshot()`), options/rules getters (`getOptions()`/`getRules()`), Core event subscription methods (`on()`/`off()`), DOM render-root getter, boolean lifecycle getters, `render()`/`requestRender()` aliases, or consumer `destroy()`. The Core integration, Projection facade, and advanced trace are not exposed as a normal consumer API. The declaration-visible members below are a separate class-surface fact.

## Declaration-visible public surface

### Recommended high-level API

Use the four signal inputs, seven outputs, and six methods above for ordinary integration. Angular owns lifecycle hook invocation.

### Current exported class declaration

The current class declaration also exposes these members publicly. They primarily serve the component's Projection/template implementation:

| Property           | Current role                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `rootView`         | Reactive root chrome/view DTO derived from configuration and Projection state; not a DOM render-root getter. |
| `markersLayerView` | Reactive marker-layer view state.                                                                            |
| `viewport`         | Reactive viewport view state.                                                                                |
| `items`            | Reactive projected marker/cluster item views.                                                                |
| `itemRegistry`     | Template selection registry that tracks item elements and can update selected attributes.                    |

The first four are Angular signal/computed view values. They are not `TrackerSnapshot`, do not expose a complete snapshot graph, and have framework reactive lifetime rather than stable snapshot read/publication semantics. `itemRegistry` is template machinery, not a snapshot subscription API. These five names are public by declaration; they are not private fields or separate package exports.

| Lifecycle method    | Ownership                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `ngAfterViewInit()` | Public by class/interface; Angular invokes it after view initialization to establish browser mounting. |
| `ngOnDestroy()`     | Public by class/interface; Angular invokes it for terminal component teardown.                         |

Manual consumer invocation of these lifecycle hooks is not a supported integration pattern. Their visibility and the five properties are acknowledged here without promoting them as the normal integration interface or declaring them deprecated.

## Observation and manual refresh

Normal Angular change detection with unchanged options/rules/root identities is not a generic Core synchronization request. External source DOM/layout changes remain governed by configured mutation, resize, scroll, and interval sources or explicit `refresh()`. Use `requestRefresh()` for scheduled/coalesced work while mounted.

CSS/CSSOM-only geometry changes may need explicit refresh. Disabling automatic sources shifts their synchronization responsibility to the caller; disabling scroll updates also stops automatic viewport synchronization. Initial mount and accepted declarative configuration updates still synchronize. See [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/) for targets and scheduler behavior.

## Environments

### Documents and containers

The internal Angular template-owned `.rxtt` ownerDocument/Window defines the active realm. With roots omitted, source scope is that document's body and scrolling uses its Window. The component host itself is not the Core render root. Page-scroller element aliases select window mode.

An HTMLElement `scrollRoot` selects one authoritative element scroll range; omitted sourceRoot then resolves to that element. Explicit sources must satisfy same-document and scroll-subtree constraints. Relevant descendant scrolling is separately observed for invalidation without representing extra scroll ranges. Internal output stays beneath the component host; arrange the host alongside the container and follow the supported geometry/CSS profile in [environments](https://rightxt.github.io/tracker/docs/guides/environments/).

Null root inputs are useful while application DOM references are unavailable: the shell remains hidden/non-interactive and the runtime stays unmounted until both inputs are valid or undefined.

Use a connected scroll container in a standards-mode document with a positive client extent along the represented axis. Supported container displays are block, flow-root, flex, inline-flex, grid, inline-grid, and inline-block; represented-axis overflow must be auto, scroll, or hidden. Active scroll snap, reverse flex/wrap that reverses that axis, and replaced/form-control elements are outside the supported profile. A zero current scroll range is valid. Overlay alignment, transforms, zoom, and surrounding layout remain application responsibilities.

### Shadow DOM

Open ShadowRoot source scope is supported; selectors do not automatically pierce shadow boundaries. Place the component host in the intended valid shadow/document scope when output belongs there. The internal Light DOM root remains in that shadow tree, and package/theme CSS must reach it in that style scope.

### Same-origin iframes and navigation

There is no render-target input. The safe child-document form requires the Angular component host and internal render root themselves to be created in the child document, typically by bootstrapping the application there. Use child-document source/scroll roots and load package CSS there.

A parent-document host/render root cannot target child-iframe source/scroll roots; mixed roots reject with `ERR_TRACKER_REALM_MISMATCH`. No cross-origin bridge exists.

Navigation requires fresh document/root identities and component/realm lifecycle. Recreate/bootstrap in the new child document; do not retain stale roots. The adapter has no render-root ownerDocument watcher/adoption hook. Default-root relocation alone is not detected; a real host relocation still requires an explicit valid root-identity reconciliation if reusing that component is otherwise appropriate.

## Styling

Load `@rightxt/tracker-angular/style.css` through global application styles before theme CSS, as shown in Quick start. JavaScript does not inject it. Service styling targets the actual internal `.rxtt`, not just the `rxt-tracker-angular` host. View encapsulation does not guarantee that arbitrary component-local selectors reach the internal service tree.

| Service class     | Role                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `.rxtt`           | Internal track root; use `track.className` for application classes.    |
| `.rxtt__viewport` | Viewport indicator; use `viewport.className`.                          |
| `.rxtt__markers`  | Marker layer; use `markerLayer.className`.                             |
| `.rxtt__marker`   | Marker/cluster item; global and rule marker presentation compose here. |

Use root `options.cssVariables`, rule `marker.cssVariables`, supported attributes, and reachable CSS. Committed root option strings remain unchanged; standard Projection root output trims nonblank strings and omits blank/whitespace-only values. Angular adds no second normalization layer. Item/rule style variables follow the item path; the root trim/drop rule is not a guarantee about every item map.

Renderer-owned geometry and `data-rxtt-*` metadata are not application configuration or business identifiers. `data-rxtt-drag="true"` means drag capability enabled, not an active drag session. Preserve visible focus and selected-item styling. Install CSS in the actual shadow or child-document scope when applicable.

The [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/) gives the full 33-root-variable/17-rule-variable and metadata contract. Use the [Theme Builder source entry](https://rightxt.github.io/tracker/tools/theme-builder/) for theme exploration.

## Debug, diagnostics and zones

The adapter imports neutral external Core entries. A resolver selecting Core's `development` condition composes the same Angular API with debug Core; `getStats()` may include `debug` metadata. Angular development mode alone does not replace external Core resolution. No Angular-local debug JavaScript artifact exists. `getTrackerDebugTrace()` is not adapter API; the underlying Projection integration remains private.

Use `options.diagnostics.output` for diagnostic sinks and `warning` for warning notifications. `diagnostics.warnings` gates fallback `console.warn` only; the configured sink, warning stats/events, and errors remain active. `diagnostics.metrics` controls timing, not counters.

Core configuration/lifecycle errors may propagate through validation, effects, lifecycle hooks, and instance methods. Classes/codes are preserved but not re-exported by this package. Examples include `TrackerConfigurationError`, `TrackerLifecycleError`, `ERR_TRACKER_INVALID_CONTEXT`, `ERR_TRACKER_DESTROYED`, and `ERR_TRACKER_REALM_MISMATCH` where applicable. Native TypeError for `options.rules` and cleanup AggregateError are additional boundaries; no Angular-local stable error-code family is exposed.

Output subscriber handling remains Angular/application-owned. Because the adapter has no catch around output emission, an escaping exception can reach Core integration-handler containment and its error statistics. This possibility is distinct from a guarantee about Angular's global error handling. See [Events](#events) for return-value and asynchronous failure behavior.

Core runtime creation and mount/unmount/configuration/refresh/request work run through `NgZone.runOutsideAngular()`. Outputs explicitly re-enter through `NgZone.run()`. Projection signal writes/view-state updates are **not separately wrapped in adapter NgZone re-entry**; Angular owns view application/change detection. The [runtime diagnostics reference](https://rightxt.github.io/tracker/docs/reference/core-runtime/#diagnostic-channels) adds channel detail without exposing snapshots or advanced trace.

## Demos and further documentation

These links open repository source documentation:

- [Angular playground](https://rightxt.github.io/tracker/playgrounds/angular/): standalone component setup and interactive inputs.
- [Angular container scenario](https://rightxt.github.io/tracker/scenarios/container/angular/): host placement and element-scroll bindings.
- [Angular events scenario](https://rightxt.github.io/tracker/scenarios/events/angular/): outputs and synchronization timing.
- [Environments](https://rightxt.github.io/tracker/docs/guides/environments/), [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/), [rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/), and [styling](https://rightxt.github.io/tracker/docs/reference/styling/): supplementary workflow and reference detail.
