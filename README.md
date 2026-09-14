# Tracker

Tracker gives people a visual overview of a scrolling page or container. A track shows where content of interest appears, a viewport indicator shows the visible region, and markers help users navigate to relevant content. Ordered rules control what becomes a marker, how it looks, and how activation behaves; nearby markers can form clusters to keep the overview readable.

## Where Tracker is useful

Use Tracker when the location of content matters as much as the content itself:

- Long documents, documentation, and readers: navigate sections and annotations without losing the overall structure. The [long document recipe](site/demos/recipes/document/README.md) demonstrates a structured report.
- Extended forms: locate validation errors and completion states with the [form recipe](site/demos/recipes/form/README.md).
- Feeds and dashboards: find unresolved attention and critical events in the [activity stream recipe](site/demos/recipes/activity-stream/README.md).
- Review tools and editors: locate items needing attention along a scrollable surface, as in the [audio caption review recipe](site/demos/recipes/audio-review/README.md).

Search matches, comments, and issues can also become markers when the application represents them as source elements matched by rules.

## How Tracker works

Rules match source elements, Tracker measures their positions within a scrolling context, and the resulting markers show their relative locations on the track. The viewport indicator follows the visible region. Configurable interaction can scroll to or focus relevant content, while automatic updates and explicit synchronization keep the overview aligned with changing content.

| Term                   | Meaning                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| **Tracker**            | The complete integration coordinating tracked content, visual output, and interaction.             |
| **track**              | The visual strip representing the scrolling range; one part of Tracker.                            |
| **viewport**           | The currently visible region of the scrolling context.                                             |
| **viewport indicator** | The visual representation of that region on the track.                                             |
| **marker**             | A representation of a matched source element's position.                                           |
| **cluster**            | One group representing nearby markers.                                                             |
| **rule**               | An ordered selector with label, presentation, scrolling, and focus behavior for matching elements. |
| **source root**        | The scope in which Tracker searches for matching source elements.                                  |
| **scroll root**        | The page/window or element scrolling context represented by Tracker.                               |

The source root selects what to search; the scroll root selects the scrolling context. An integration also has a rendering host/root that determines where its output lives. The package documentation explains who owns that output and how to place it.

## Choose a package

Choose the adapter that matches your application's integration model. Use Core when building your own Tracker integration or rendering adapter.

| Package and documentation                                | Choose it when                                                  | Integration style                                                 | Distribution/debug distinction                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`@rightxt/tracker-core`](packages/core/README.md)       | Building a custom integration or renderer                       | Runtime and rendering contracts for your own binding              | Conditional production/debug ESM and explicit debug ESM paths; no standalone bundle.                   |
| [`@rightxt/tracker-vanilla`](packages/vanilla/README.md) | Using imperative JavaScript without a framework component model | Tracker class with explicit mount and cleanup                     | ESM composes neutral Core; standalone production/debug browser bundles are available.                  |
| [`@rightxt/tracker-element`](packages/element/README.md) | Integrating a standards-based Custom Element                    | DOM connection lifecycle, JavaScript configuration, native events | Side-effect-free root ESM; `/register` entry and auto-registering standalone production/debug bundles. |
| [`@rightxt/tracker-react`](packages/react/README.md)     | Using React 19                                                  | Component, callback props, ref handle                             | No package-local debug JavaScript; debug behavior comes from the external Core condition.              |
| [`@rightxt/tracker-vue`](packages/vue/README.md)         | Using Vue 3.5+                                                  | Component, emits, exposed handle                                  | No package-local debug JavaScript; debug behavior comes from the external Core condition.              |
| [`@rightxt/tracker-angular`](packages/angular/README.md) | Using Angular 22                                                | Standalone component, inputs, outputs, instance methods           | No package-local debug JavaScript; debug behavior comes from the external Core condition.              |

Choose Vanilla when your code should explicitly create and mount an instance; choose Element when a Custom Element's DOM lifecycle should manage the integration. Element options and rules use JavaScript configuration, not HTML configuration attributes. The framework packages have no standalone browser bundles; exact entry points and debug setup remain package-specific.

The Vanilla and Element standalone builds are also available directly from a CDN; see the [CDN guide](docs/guides/cdn.md).

**Each official adapter README is self-contained for the API exposed by that package**, including options, rules, lifecycle, events, styling, and environment restrictions. Start with the adapter you install. Core documentation primarily serves custom integration authors.

## Quick-start orientation

Install `@rightxt/tracker-vanilla` with your package manager. With a bundler that supports CSS imports, run this after the document body and headings exist:

```js
import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';

const tracker = new Tracker({
  options: { a11y: { enabled: true, keyboard: true } },
  rules: [{ selector: 'h2', label: (element) => element.textContent }],
});
tracker.mount();

const disposeTracker = () => tracker.destroy();
```

Call `disposeTracker()` when the owning view is removed. This example uses page tracking. In Vanilla, an omitted `renderHost` resolves to the inferred mount/request document's body; explicit source/scroll identities can establish a same-origin child-document request context. See the Vanilla quick start for the complete package setup.

Package-specific starts: [Core](packages/core/README.md#quick-starts), [Vanilla](packages/vanilla/README.md#quick-start), [Element](packages/element/README.md#quick-start), [React](packages/react/README.md#quick-start), [Vue](packages/vue/README.md#quick-start), and [Angular](packages/angular/README.md#quick-start).

Options cover presentation, clustering, updates, interaction, accessibility, and diagnostics. Ordered rules choose and present markers. Configuration and lifecycle details belong to the package you use.

## Environments at a glance

Tracker supports these environment categories. Exact setup and restrictions depend on the adapter and its rendering model. The renderer target/render root determines the active DOM realm; source and scroll roots must be compatible with it.

| Environment                 | Orientation and next step                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page / document             | Represent page scrolling and matching document content. See [page tracking](docs/guides/environments.md#pagedocument-tracking).                                                                                              |
| Element scroll container    | Represent one authoritative container's scroll range, with output positioned to correspond to it. See [element containers](docs/guides/environments.md#element-scroll-containers).                                           |
| Shadow DOM                  | Track supported shadow content or place output in a shadow tree, with styles reaching its actual scope. See [Shadow DOM](docs/guides/environments.md#shadow-dom).                                                            |
| iframe / multiple documents | Use compatible roots and output in a same-origin document according to the adapter's model; there is no cross-origin bridge. See [iframe and multiple documents](docs/guides/environments.md#iframe-and-multiple-documents). |

Document replacement or navigation requires the package's appropriate remount/recreation lifecycle. Use the [environment guide](docs/guides/environments.md) and your package's environment section for the actual setup.

## Demos and Theme Builder

The example links below open repository source documentation.

- **Recipes** show application workflows using the production Tracker profile. Start with the document, form, activity stream, and audio review recipes under [Where Tracker is useful](#where-tracker-is-useful).
- **Scenarios** isolate a behavior or environment. Explore [styling](site/demos/scenarios/styling/README.md), [clustering](site/demos/scenarios/clustering/README.md), [observation](site/demos/scenarios/observation/README.md), [rule resolution](site/demos/scenarios/rule-resolution/README.md), [accessibility](site/demos/scenarios/accessibility/README.md), or [diagnostics](site/demos/scenarios/diagnostics/README.md).
- **Playgrounds** provide package-oriented interactive experimentation: [Vanilla](site/demos/playgrounds/vanilla/README.md), [Element](site/demos/playgrounds/element/README.md), [React](site/demos/playgrounds/react/README.md), [Vue](site/demos/playgrounds/vue/README.md), and [Angular](site/demos/playgrounds/angular/README.md).

[Theme Builder](site/tools/theme-builder/index.html) is an interactive helper for Tracker's public styling contract, with theme preview and application override export. Load your package's stylesheet and use the [styling reference](docs/reference/styling.md) for the supported customization surface.

## Documentation

### Packages

For installation and normal adapter use, the package README is the primary API reference: [Vanilla](packages/vanilla/README.md), [Element](packages/element/README.md), [React](packages/react/README.md), [Vue](packages/vue/README.md), or [Angular](packages/angular/README.md).

For a custom integration, begin with [Core](packages/core/README.md), then follow the custom integration guide and the Core references below.

### Guides

| Guide                                                                 | Purpose                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Environments](docs/guides/environments.md)                           | Page, container, Shadow DOM, iframe, and root/realm setup.             |
| [Updates and manual refresh](docs/guides/updates-and-refresh.md)      | Automatic observation and when explicit synchronization is needed.     |
| [Rules and marker behavior](docs/guides/rules-and-marker-behavior.md) | Rule order, labels, marker presentation, clustering, and activation.   |
| [Building a custom integration](docs/guides/custom-integration.md)    | Workflow for implementing a Projection or Direct Renderer integration. |

### Reference

The styling reference applies broadly across packages. The three Core references primarily serve Core/custom integration authors; adapter users can rely on their package README and follow these references when supplementary detail is useful.

| Reference                                          | Purpose                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [Styling Tracker](docs/reference/styling.md)       | Public styles, variables, classes, attributes, and stylesheet scope.      |
| [Core API](docs/reference/core-api.md)             | Core public entry points, methods, configuration validation, and helpers. |
| [Core rendering](docs/reference/core-rendering.md) | Projection and Direct Renderer protocols and output ownership.            |
| [Core runtime](docs/reference/core-runtime.md)     | Core runtime state, stats, diagnostics, errors, and debug behavior.       |
