# @rightxt/tracker-core

[![npm version](https://img.shields.io/npm/v/%40rightxt%2Ftracker-core)](https://www.npmjs.com/package/@rightxt/tracker-core) [![TypeScript declarations](https://img.shields.io/npm/types/%40rightxt%2Ftracker-core)](https://www.npmjs.com/package/@rightxt/tracker-core)

The shared RXT Tracker runtime for frontend developers building a custom integration. Core queries source elements, measures scroll geometry, groups markers into clusters, handles semantic interaction, and coordinates updates. Your integration owns how that state becomes visual output.

Use Core when writing a renderer or binding projected views to your application's DOM. Applications using an official adapter can start with that package's documentation; Core is not a prerequisite.

## Installation, entry points and debug builds

```sh
pnpm add @rightxt/tracker-core
```

Core provides public ESM entry points and TypeScript declarations:

| Normal semantic entry              | Explicit debug entry                     | Purpose                                                                        |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `@rightxt/tracker-core`            | `@rightxt/tracker-core/debug`            | Shared configuration/rule helpers, constants, types, and error classes.        |
| `@rightxt/tracker-core/projection` | `@rightxt/tracker-core/projection/debug` | Projection integration factory and immutable rendering views.                  |
| `@rightxt/tracker-core/renderer`   | `@rightxt/tracker-core/renderer/debug`   | Direct Renderer factory, renderer protocol, records, and presentation helpers. |
| `@rightxt/tracker-core/advanced`   | `@rightxt/tracker-core/advanced/debug`   | Debug trace retrieval for supported Core facades.                              |

Neutral JavaScript entries use package conditions: `development` selects debug behavior; production/default resolution selects production behavior. Explicit `/debug` entries bypass that choice. Static exports and declarations match within each normal/debug family, while debug runtime instrumentation differs. This is Core's package model, not a promise that every Tracker package has the same artifacts.

`@rightxt/tracker-core/style.css` exports the canonical stylesheet, and `@rightxt/tracker-core/package.json` exposes package metadata. JavaScript does not inject CSS. In a browser application whose bundler supports CSS imports:

```js
import '@rightxt/tracker-core/style.css';
```

## Choose Projection or Direct Renderer

| Decision                | Projection                                                             | Direct Renderer                                                 |
| ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Best fit                | Application/framework owns DOM and consumes immutable view state.      | Your renderer implements synchronous visual-output hooks.       |
| Factory                 | `createTrackerProjectionIntegration(configuration?)`                   | `createTrackerRendererIntegration(configuration, { renderer })` |
| Rendering               | Read `getProjection()` and subscribe with `subscribeProjection()`.     | Implement the render hooks needed by your UI.                   |
| Mount input             | Exact `renderRoot: HTMLElement`.                                       | `rendererTarget`, discriminated as host or exact root.          |
| Configuration           | Complete `replaceConfiguration({ options, rules })`.                   | Complete replacement plus options/rule-specific mutations.      |
| Additional capabilities | Preflight, adapter coordination, and `flushRender()` for pending work. | Root/options/rules reads and keyed `activateItem()`.            |

Both facades provide lifecycle, Core events, manual synchronization, snapshots, and stats. They do not have identical method sets. See the [custom integration guide](https://rightxt.github.io/tracker/docs/guides/custom-integration/) for the workflow and the [rendering reference](https://rightxt.github.io/tracker/docs/reference/core-rendering/) for exact protocols.

## Quick starts

These independent browser examples run after a connected `<article>` containing headings exists. They use page scrolling; the application chooses the output location. Call the returned cleanup function when the owning view is removed.

### Projection: bind a rail to DOM

This binding owns its output nodes, applies projected presentation, and preserves keyed items. Core supplies interaction and geometry; the binding supplies DOM reconciliation.

```js
import { createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection';
import '@rightxt/tracker-core/style.css';

function mountProjection(sourceRoot) {
  const document = sourceRoot.ownerDocument;
  const root = document.createElement('div');
  const layer = document.createElement('div');
  const viewport = document.createElement('div');
  root.append(layer, viewport);
  document.body.append(root);

  const previousViews = new WeakMap();
  const items = new Map();
  const integration = createTrackerProjectionIntegration({
    options: { placement: 'right', a11y: { enabled: true, keyboard: true } },
    rules: [{ selector: 'h2', label: (element) => element.textContent }],
  });

  function applyView(node, view) {
    const previous = previousViews.get(node);
    for (const name of Object.keys(previous?.attributes ?? {})) {
      if (!(name in view.attributes)) node.removeAttribute(name);
    }
    for (const name of Object.keys(previous?.styleVars ?? {})) {
      if (!(name in view.styleVars)) node.style.removeProperty(name);
    }
    node.className = view.className;
    for (const [name, value] of Object.entries(view.attributes)) node.setAttribute(name, value);
    for (const [name, value] of Object.entries(view.styleVars)) node.style.setProperty(name, value);
    previousViews.set(node, view);
  }

  function renderView(state) {
    applyView(root, state.chrome.root);
    applyView(layer, state.chrome.markersLayer);
    layer.hidden = state.chrome.markersLayer.hidden;
    applyView(viewport, state.viewport);
    viewport.hidden = state.viewport.hidden;
    const currentKeys = new Set(state.items.map((item) => item.key));
    for (const [key, node] of items) {
      if (!currentKeys.has(key)) {
        node.remove();
        items.delete(key);
      }
    }
    for (const item of state.items) {
      const node = items.get(item.key) ?? document.createElement('div');
      applyView(node, item);
      node.setAttribute('data-rxtt-key', item.key);
      if (item.key === state.selection.selectedKey) node.setAttribute('data-rxtt-selected', 'true');
      else node.removeAttribute('data-rxtt-selected');
      items.set(item.key, node);
      layer.append(node);
    }
  }

  renderView(integration.getProjection());
  const unsubscribe = integration.subscribeProjection(({ state }) => renderView(state));
  function cleanup() {
    try {
      integration.destroy();
    } finally {
      unsubscribe();
      items.clear();
      root.remove();
    }
  }
  try {
    integration.mount({ renderRoot: root, sourceRoot });
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}

const stopTracker = mountProjection(document.querySelector('article'));
// Call stopTracker() when the application removes this view.
```

Only attributes/styles previously applied by this binding are removed during reconciliation. The root identity stays fixed for the mount. Larger bindings can use changed Projection domains to limit DOM work; the [Projection protocol](https://rightxt.github.io/tracker/docs/reference/core-rendering/#projection-protocol) explains coherent commits and listener recovery.

### Direct Renderer: custom marker navigation

This renderer presents measured markers as native navigation buttons, with clustering and the viewport indicator disabled. It owns hit testing and forwards marker keys through `activateItem()`. The custom list uses native button styling; a renderer implementing the standard rail should also import `@rightxt/tracker-core/style.css` and apply the standard presentation contract.

```js
import { createTrackerRendererIntegration, getPrimaryMarkerRecord } from '@rightxt/tracker-core/renderer';

function mountMarkerList(sourceRoot, host) {
  let root = null;
  const renderer = {
    mount({ target, document }) {
      root = document.createElement('nav');
      root.setAttribute('aria-label', 'Content sections');
      target.host.append(root);
      return root;
    },
    renderMarkers(records) {
      const buttons = records.map((record) => {
        const key = record.key;
        const marker = getPrimaryMarkerRecord(record);
        const button = root.ownerDocument.createElement('button');
        button.type = 'button';
        button.textContent = marker.label || marker.selector;
        button.onclick = (sourceEvent) => {
          sourceEvent.stopPropagation();
          integration.activateItem(key, { sourceEvent });
        };
        return button;
      });
      root.replaceChildren(...buttons);
    },
    unmount() {
      root?.remove();
      root = null;
    },
  };
  const integration = createTrackerRendererIntegration(
    {
      options: { viewport: { enabled: false }, clustering: { enabled: false } },
      rules: [{ selector: 'h2', label: (element) => element.textContent }],
    },
    { renderer },
  );

  try {
    integration.mount({ rendererTarget: { kind: 'host', host }, sourceRoot });
  } catch (error) {
    integration.destroy();
    throw error;
  }
  return () => integration.destroy();
}

const host = document.createElement('div');
document.body.append(host);
const stopTracker = mountMarkerList(document.querySelector('article'), host);
// On view removal: stopTracker(); host.remove();
```

The host is caller-owned; the returned strict descendant is renderer-owned. The button handler stops propagation before forwarding activation, so the same click is not also delivered to root-level track handling. This minimal renderer uses fixed presentation; a configurable rail additionally implements track, marker-presentation, viewport, and selection hooks as needed. Hooks are synchronous, and a Promise is not a valid mount root. The [renderer reference](https://rightxt.github.io/tracker/docs/reference/core-rendering/#direct-renderer-protocol) defines inputs, ownership, and failure behavior.

## Core concepts

| Concept                       | Meaning                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tracker                       | One integration coordinating the represented content, rendering, interaction, and lifecycle.                       |
| Track                         | The visual rail along the represented physical axis; one part of a Tracker.                                        |
| Viewport                      | The currently visible portion of the represented scroll area.                                                      |
| Viewport indicator            | The visual item showing that viewport on the track. Disabling it does not disable observation.                     |
| Marker                        | A representation of a matched source element and its rule behavior.                                                |
| Cluster                       | A spatial group rendered as one item, with a primary marker.                                                       |
| Rule                          | An ordered selector plus label, presentation, scroll, and focus behavior.                                          |
| Source root                   | The scope queried for source elements.                                                                             |
| Scroll root                   | The authoritative page/window or element whose scrolling is represented.                                           |
| Render root / renderer target | The actual output HTMLElement, or Direct Renderer's host/root ownership request. It also selects the active realm. |

Configuration has separate `options` and `rules` channels. Options control the integration; rules select and describe source elements. The source scope and scroll context can differ subject to their environment constraints.

## Configuration reference

Creation accepts `{ options?, rules? }`; both default to empty input resolved against defaults. All option fields are optional. The grouped tables below cover all **36 configurable leaves**. Containers such as `updates.mutation.options` are not additional leaf values.

### Track geometry and placement

| Option        | Type / values                            | Default                                 | Meaning and constraints                                                                                                                                                                                           |
| ------------- | ---------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orientation` | `'vertical' \| 'horizontal'`             | `'vertical'`                            | Physical Y or X axis. Changing orientation while mounted in element mode revalidates that scroll root for the requested axis and can reject before commit.                                                        |
| `placement`   | `'left' \| 'right' \| 'top' \| 'bottom'` | Vertical: `'left'`; horizontal: `'top'` | Vertical accepts left/right; horizontal accepts top/bottom. An explicitly incompatible pair rejects. An omitted/inherited incompatible placement falls back to the new axis default. No scrollbar-side inference. |

### Presentation

| Option                  | Type / values                                      | Default | Meaning and constraints                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cssVariables`          | Plain map of string or null values                 | `{}`    | Root custom-property input. Supported Tracker names and valid application names are accepted; renderer geometry/unknown `--rxtt-*` names reject. Strings remain unchanged in committed reads; null deletes a configured entry in a patch. Replacement removes omitted entries. See [Styling](#styling) for output normalization. |
| `track.className`       | `string`                                           | `''`    | Application classes appended to the standard `.rxtt` root. Whitespace normalized and tokens deduplicated; reserved Tracker service classes reject.                                                                                                                                                                               |
| `viewport.enabled`      | `boolean`                                          | `true`  | Show the viewport indicator when geometry is available. Does not enable/disable update sources.                                                                                                                                                                                                                                  |
| `viewport.className`    | `string`                                           | `''`    | Application classes on `.rxtt__viewport`; same class normalization/reservation rules.                                                                                                                                                                                                                                            |
| `markerLayer.className` | `string`                                           | `''`    | Application classes on `.rxtt__markers`; same class rules.                                                                                                                                                                                                                                                                       |
| `marker.attributes`     | Plain map: string, finite number, boolean, or null | `{}`    | Global application attributes for marker/cluster items. Names lowercased; collisions/reserved names reject. Global patch null deletes an entry; rule null suppresses inheritance. See the name constraints below.                                                                                                                |
| `marker.className`      | `string`                                           | `''`    | Application classes for every marker/cluster, combined with its owning rule's classes. Same class rules.                                                                                                                                                                                                                         |
| `marker.title`          | `boolean`                                          | `true`  | Use a nonempty resolved label as native title; an explicit rule boolean overrides the global policy.                                                                                                                                                                                                                             |

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

Patch validation includes inherited values: disabling `a11y.enabled` while an inherited `a11y.keyboard` remains true rejects. Change both together when disabling keyboard accessibility. Logical selection is separate from browser focus; preserve visible focus and selected-item styling in custom output.

### Diagnostics

| Option                 | Type / values                                               | Default                 | Meaning and constraints                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnostics.warnings` | `boolean`                                                   | `true`                  | Gate fallback `console.warn` only; configured `output.warn`, warning stats, and the warning event remain active.                                                                  |
| `diagnostics.metrics`  | `boolean`                                                   | `false`                 | Collect render timing when a clock is available. Counters update independently of this flag.                                                                                      |
| `diagnostics.output`   | Sink object with optional `warn`/`error` functions, or null | Omitted; no custom sink | Replace console fallback per implemented severity. Null clears the sink. It is caller-owned and callbacks are best-effort; see [Diagnostics and errors](#diagnostics-and-errors). |

### Configuration changes and validation

Normal construction and configuration/rule mutations are strict and atomic: **any validation diagnostic, including a warning, rejects the candidate without a partial commit**. Unknown keys, invalid values, and duplicate selectors reject. A known own property set to `undefined` is invalid; omission is different. Null is accepted only where the field permits it.

| Operation                                                                                                | Facade          | Behavior                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `replaceConfiguration({ options, rules }, params?)`                                                      | Both            | Replace both channels atomically; both own fields are required. Omitted option leaves resolve from defaults.              |
| `replaceOptions(options, params?)`                                                                       | Direct Renderer | Replace options from defaults and preserve separate rules.                                                                |
| `patchOptions(options, params?)`                                                                         | Direct Renderer | Deep patch from committed options; omitted fields remain, with field-specific null deletion.                              |
| `replaceRules(rules, params?)`                                                                           | Direct Renderer | Replace the complete ordered list.                                                                                        |
| `addRule(rule, params?)`, `removeRuleByIndex(index, params?)`, `removeRuleBySelector(selector, params?)` | Direct Renderer | Incremental rule changes; `addRule` supports an insertion `params.index`. Selectors are normalized and indices validated. |

Optional `params.render` defaults to true. `render: false` leaves required work dirty for later synchronization. Alive unmounted integrations accept configuration changes; mounted ones normally schedule required work. Projection exposes complete replacement rather than options/rule-specific mutators, so keep the desired envelope in application state.

Pure `validateOptions()`, `validateRule()`, and `validateRules()` are non-committing tooling helpers returning candidates and diagnostic arrays. Recovered output is not a normal partial mutation. The [Core API reference](https://rightxt.github.io/tracker/docs/reference/core-api/#configuration-and-rule-validation) owns exact recovery, helper, and failure contracts.

## Rules reference

Rules are processed in priority order. `selector` is required, trimmed, nonempty, and unique after normalization. The first matching rule owns an overlapping source element. Selector queries follow the source scope; DOM-dependent syntax is validated against the actual source at mount/mounted update boundaries.

The tables cover all **12 rule leaves**. `marker`, `scroll`, and `focus` are containers; `scroll` and `focus` also accept boolean shorthands.

### Selection, labels, and presentation

| Field                 | Type / values                                      | Default               | Meaning and constraints                                                                                                                                                                                |
| --------------------- | -------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `selector`            | Nonempty CSS selector string                       | Required              | Trimmed unique selector; rule order determines overlapping element ownership.                                                                                                                          |
| `label`               | String, null, or `(element) => string \| null`     | `null`                | Static or synchronous source-Element label. Throw is diagnosed; non-string callback output gives no label. Promises are not awaited. Nonempty labels can supply native title.                          |
| `marker.className`    | `string`                                           | `''`                  | Normalized application classes combined with global marker classes. Reserved service classes reject.                                                                                                   |
| `marker.title`        | `boolean`                                          | Inherit global policy | Explicit true/false overrides global `marker.title`; title still needs a nonempty label. Omit to inherit, rather than supplying own `undefined`.                                                       |
| `marker.attributes`   | Plain map: string, finite number, boolean, or null | `{}`                  | Same supported names/serialization as global attributes. Rule values override globals; rule null persistently suppresses the matching inherited attribute.                                             |
| `marker.cssVariables` | Plain string map                                   | `{}`                  | Complete item map, not a patch. Accepts 17 marker/cluster Tracker variables and valid application custom properties; null rejects. Inline item values override inherited values; strings may be blank. |

For a cluster, the primary spatial marker supplies rule presentation. Global/rule classes combine, attributes override or suppress, and rule title policy overrides the global flag. See [rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/).

### Scroll and focus

| Field             | Type / values                                                  | Default   | Meaning and constraints                                                                                                                    |
| ----------------- | -------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `scroll.enabled`  | `boolean`                                                      | `true`    | Attempt scrolling during accepted activation, before focus. `scroll: false` disables just this phase.                                      |
| `scroll.target`   | `'self'`, nonempty selector, or `(element) => Element \| null` | `'self'`  | Resolve the navigation target synchronously. It must belong to the active document and, in element mode, the authoritative scroll subtree. |
| `scroll.behavior` | `'auto' \| 'smooth'`                                           | `'auto'`  | Requested scrolling behavior.                                                                                                              |
| `scroll.align`    | `'start' \| 'center' \| 'end' \| 'nearest'`                    | `'start'` | Alignment along the represented physical axis.                                                                                             |
| `focus.enabled`   | `boolean`                                                      | `false`   | Attempt focus after scrolling. `focus: true` enables it with the default target.                                                           |
| `focus.target`    | Same target forms as `scroll.target`                           | `'self'`  | Same realm/subtree constraints; final target must be an HTMLElement.                                                                       |

Boolean `scroll`/`focus` shorthands toggle their enabled value while retaining other defaults. Target selectors search source descendants, then the containing ShadowRoot when present, then the owner document. Invalid targets, selector failures, or throwing target callbacks yield no usable target for that phase and diagnostics. Callbacks must return synchronously and must not mutate the same Tracker while resolving.

Strict normal mutations reject diagnostic-bearing rules. Pure rule validation removes invalid rule-marker CSS names/entries from its recovered candidate, keeps valid entries, and reports diagnostics. This sanitation does not allow a normal mutation to silently accept only the valid portion. [Validation depth](https://rightxt.github.io/tracker/docs/reference/core-api/#context-and-recovery) and [activation behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/#activation) provide the detailed contracts.

## Mounting and roots

Mount after the supplied roots/host are connected. Projection takes:

```js
integration.mount({ renderRoot, sourceRoot, scrollRoot });
```

Direct Renderer instead takes one ownership target:

```js
integration.mount({ rendererTarget: { kind: 'host', host }, sourceRoot, scrollRoot });
// Or: rendererTarget: { kind: 'root', root }
```

`sourceRoot` and `scrollRoot` are optional in both shapes; omit their properties to use defaults. The Projection root or Direct Renderer target selects the active Document/Window, and the other roots must be valid in that realm.

- Source roots can be Document, Element, or a directly supplied open ShadowRoot. Queries do not automatically enter nested shadow trees or iframe documents. Element sources match descendants, not themselves.
- Omitted scroll root, the active Window, and active-document body/documentElement/scrollingElement aliases select window mode. An omitted source then uses that document's body.
- A supported other HTMLElement selects element mode; its client/scroll geometry is represented and the omitted source defaults to that element. Element mode requires the supported CSS/geometry profile, not just any scrollable node.
- Source, scroll, and output cannot mix documents. For same-origin iframes use current child-document identities and unmount before remounting after navigation. A ShadowRoot source does not relocate output or install CSS there.

Projection owns no application root removal. A Direct Renderer exact-root mount must return that exact root; a host mount must return a connected strict HTMLElement descendant of the host. Actual roots must satisfy source isolation, same-realm validity, unique active registration, and fixed mount-generation identity. Core may remove abandoned renderer-owned host output as cleanup fallback, while caller-owned roots remain externally owned.

See [environments](https://rightxt.github.io/tracker/docs/guides/environments/) for defaults, container profiles, shadow scopes, and navigation, and [root ownership](https://rightxt.github.io/tracker/docs/reference/core-rendering/#active-realm-and-root-ownership) for the renderer contract.

## Lifecycle

Creation commits initial options/rules and starts **unmounted**. A successful `mount()` establishes one active generation and commits **mounted** state after required setup and initial synchronization. A second mount while mounted rejects: unmount before changing context identities.

`unmount()` is reversible and effectively idempotent at the public lifecycle boundary. It releases active runtime context, pending generation work, observers/listeners, and renderer mount resources. The same integration, configuration, and ordered rules survive; it can mount again with valid current roots. Renderer-owned output follows its cleanup protocol; application-owned output stays under application control.

`destroy()` commits **destroyed** state, is terminal and idempotent, and permits no remount. Failed mount rolls back to valid unmounted state. Cleanup can throw after unmounted/destroyed settlement; an exception does not make a destroyed integration reusable.

| Method                          | Normal use                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `getState()`                    | Read `'unmounted'`, `'mounted'`, or `'destroyed'`.                                                             |
| `isMounted()` / `isDestroyed()` | Query committed lifecycle state.                                                                               |
| `whenDestroyed()`               | Get the integration's shared completion Promise; resolves on terminal destroy even if cleanup reports failure. |

Manual rendering requires mounted state. Configuration changes and stats reset require an alive integration. Lifecycle/snapshot/stats reads remain available after destroy; Direct Renderer options/rules reads reject there. For complete capability and cleanup settlement rules, see [Core lifecycle](https://rightxt.github.io/tracker/docs/reference/core-api/#lifecycle-capability-matrix).

## Events

Both facades expose `on(name, handler)` and `off(name, handler)`. `on()` returns an idempotent unsubscribe for that registration. Registering the same handler identity twice delivers once per event but creates two ownership registrations; one unsubscribe releases only its owner. `off()` removes all current registrations for that pair.

| Event              | When                                                                   | Primary payload meaning                                                              |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `marker:activate`  | After accepted marker scroll/focus attempts.                           | Marker key, source Element, owning rule/selector, label, nullable source Event.      |
| `cluster:activate` | After primary-marker activation attempts.                              | Cluster key/count, member and primary-marker descriptors, nullable source Event.     |
| `track:activate`   | After discrete track activation; drag movement is excluded.            | Nullable track percentage position and source Event.                                 |
| `selection:change` | A committed logical selected-key transition.                           | Previous and selected keys, each nullable; selection is distinct from browser focus. |
| `sync:start`       | A Core synchronization starts; initial mount notifications are staged. | Reason, scheduled flag, nullable timing.                                             |
| `sync:end`         | Successful Core synchronization.                                       | Marker/cluster counts and nullable duration/timestamp.                               |
| `warning`          | After warning stats and output.                                        | Stable diagnostic code, human message, contextual details.                           |
| `destroy`          | After terminal state/cleanup attempts, before subscription teardown.   | Empty payload.                                                                       |

Delivery is synchronous. Activation behavior occurs before notification, and listener return values cannot cancel it. `sync:end` confirms successful Core synchronization, not browser paint or a framework DOM commit. There is no generic Core `error`, mount, or unmount event.

Core contains handler throws and observes rejected returned thenables without rolling back the emitting operation. State-changing calls during public event/snapshot dispatch defer until the boundary exits; renderer/lifecycle callbacks have different transition restrictions. New `on()` subscriptions reject after destroy; `off()` then returns false. The [event reference](https://rightxt.github.io/tracker/docs/reference/core-api/#events) owns exact payloads, ordering, and failure semantics.

## Synchronization and automatic updates

`render()` performs full synchronization immediately through the scheduler/flush path. `requestRender()` schedules and coalesces full synchronization. Both require mounted state and take no target argument. Core has no public `refresh()` method. Projection additionally exposes `flushRender()`, which only drains already-pending work and does not request new work.

The four update families are mutation, resize, scroll, and interval. Mutation reacts to relevant external DOM changes, excluding Tracker renderer feedback. Resize combines ResizeObserver and Window resize; `updates.resize.targets` configures only ResizeObserver. Scroll updates include marker geometry and viewport synchronization, not just a viewport-only write. Interval polls independently.

Automatic observation cannot detect every visual change. CSS/CSSOM-only updates, external stylesheets, and application layout changes outside observed signals may need `requestRender()` or `render()`. If the application owns all invalidation, disable each family separately and schedule explicitly. A framework render by itself is not a Core invalidation API.

See [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/) for target selection, coalescing, manual synchronization, and geometry recovery.

## Styling

For output implementing the standard rail, import/use `@rightxt/tracker-core/style.css`. Core JavaScript does not inject that stylesheet. Install canonical CSS and application themes in the scope containing the actual `.rxtt` tree, including its document or user-managed ShadowRoot.

Options and rule presentation add application classes, supported attributes, title policy, and custom-property values. The public styling contract includes **33 root Tracker variables**, of which **17 are supported at rule-marker scope**, plus service classes and data attributes. Valid application-owned custom properties outside the reserved Tracker namespace are also supported. Keep the required service hooks when implementing standard output.

`data-rxtt-drag="true"` means drag capability is enabled; it is not a current-dragging flag. Committed root CSS strings remain unchanged in options/read state, including whitespace. Standard Projection root output trims nonblank strings and omits blank/whitespace-only values. A custom Direct Renderer defines its own output handling; do not assume it applies that normalization unless it uses the corresponding helper. Rule/item CSS is a separate scope.

The [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/) defines the complete variable/class/attribute contract. The [Theme Builder source entry](https://rightxt.github.io/tracker/tools/theme-builder/) provides the tool for editing/previewing themes and exporting application overrides; this link opens repository source. Exported overrides supplement canonical CSS. The styling reference remains authoritative for accepted names and semantics.

## Snapshots and stats

Both Core facades expose `getSnapshot()`, `subscribeSnapshot(listener)`, `getStats()`, and `resetStats()`.

Snapshots are deeply frozen Tracker-owned runtime read graphs with DOM-free marker/cluster records, useful for integration state observation and safe retention. Snapshot subscriptions deliver future publications synchronously, without replaying initial state: read `getSnapshot()` explicitly. They observe publication/settlement, not every internal write. Projection rendering state and observation snapshots are distinct representations.

`getStats()` returns a detached, unfrozen clone of counters, diagnostic totals, and last-render data. Counters update independently of `diagnostics.metrics`; the flag gates timing only. `resetStats()` is available while alive and clears counters/retained diagnostics/last render without requesting rendering or clearing the rendered records. Reads remain available after destroy.

See [runtime state](https://rightxt.github.io/tracker/docs/reference/core-runtime/) for full structures, snapshot keys and identity, subscription failure behavior, timing, reset, and retained terminal state.

## Diagnostics and errors

The root entry exports `TrackerError`, `TrackerConfigurationError`, and `TrackerLifecycleError`. Known Tracker errors expose stable codes; inspect those instead of human message text. Not every thrown value is a TrackerError: native errors, aggregates, and renderer failures can cross public boundaries.

`diagnostics.output` accepts optional `warn(code, message, details?)` and `error(code, message, details?)` methods. Each replaces console fallback only for its severity. The sink stays caller-owned; `output: null` clears it. Core does not flush/dispose it, awaits no sink Promise, and contains sink throws/rejections.

Warnings update retained stats, call configured output or console fallback, then emit `warning`. **`diagnostics.warnings: false` gates only fallback `console.warn`**; configured `output.warn`, warning stats, and the warning event remain active. Errors and `console.error` are unaffected. There is no generic Core `error` event.

Runtime diagnostics need not throw, and strict validation rejection does not automatically emit its pure diagnostic arrays through runtime channels. Stats/snapshots retain sanitized diagnostic copies; immediate output/event details may be borrowed live objects. See [diagnostic channels and errors](https://rightxt.github.io/tracker/docs/reference/core-runtime/#diagnostic-channels) for codes, sink ownership, and retention.

## Debug and advanced

Use the `development` condition for neutral Core entries or explicit `/debug` paths when selecting debug instrumentation deliberately. Debug is more than an unminified artifact: debug-capable integrations can materialize `TrackerStats.debug` and retain selected execution traces.

`getTrackerDebugTrace()` from `@rightxt/tracker-core/advanced` (or `/advanced/debug`) retrieves trace through a compatible debug accessor and an original debug-capable Core facade. Production or incompatible composition returns null. An adapter handle is not that original Core facade. Exact trace shape, retention, timestamp interpretation, and reset/destroy behavior belong to [debug and advanced runtime](https://rightxt.github.io/tracker/docs/reference/core-runtime/#debug-builds).

## API and integration references

| Document                                                                                                     | Use it for                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [Custom integration guide](https://rightxt.github.io/tracker/docs/guides/custom-integration/)                | End-to-end integration workflow and output ownership.                         |
| [Environment guide](https://rightxt.github.io/tracker/docs/guides/environments/)                             | Page/container scrolling, source scope, Shadow DOM, and iframe navigation.    |
| [Updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/)                    | Observation families, scheduling, and explicit synchronization.               |
| [Rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/)        | Ownership, presentation composition, activation, selection, and clustering.   |
| [Styling reference](https://rightxt.github.io/tracker/docs/reference/styling/)                               | Complete CSS variables, service hooks, style scopes, and themes.              |
| [Core API reference](https://rightxt.github.io/tracker/docs/reference/core-api/)                             | Complete facade methods, tooling helpers, lifecycle capabilities, and events. |
| [Projection and Direct Renderer reference](https://rightxt.github.io/tracker/docs/reference/core-rendering/) | Exact view/renderer protocols, roots, hooks, DTOs, and cleanup.               |
| [Runtime, diagnostics, and debug](https://rightxt.github.io/tracker/docs/reference/core-runtime/)            | Snapshots, stats, error/diagnostic codes, sinks, and advanced trace.          |
