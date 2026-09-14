# Container — Vue

## Purpose

This scenario demonstrates a framework-owned Tracker component representing an external `HTMLElement` in element scroll mode.

## External element scroll roots

Container A has five `.container-target` sources and Container B has three. Clustering is disabled, so every source produces exactly one marker. The selected external element is passed as both `sourceRoot` and `scrollRoot`.

Marker activation uses `behavior: 'auto'`. It scrolls only the selected element, not the inactive container or browser window.

## Renderer location vs represented container

The Tracker component remains mounted in the dedicated framework-owned renderer panel. The roots configure what the runtime represents; they do not portal or relocate the renderer into either external container.

Changing the DOM-reference props/inputs changes the mounted runtime context while the framework component and its render location remain in place.

## Framework DOM-reference wiring

Vue callback template refs populate `shallowRef` values without deep-proxying DOM state. A `computed` value selects the real DOM element passed through the public `sourceRoot` and `scrollRoot` props.

## Initial null refs

Framework DOM references may initially be unavailable. The adapter tolerates this null/non-mounted state until the actual `HTMLElement` is available.

## Supported element-scroll profile

The fixture uses a block-like scroll container with `overflow-y: auto`, no scroll snap, and an ordinary physical-axis origin. Public drag interaction is enabled as a secondary illustration that renderer location and represented scroll root are independent.

## Compare framework variants

These scenarios intentionally have the same fixture, options, rule, controls, and results so their DOM-reference wiring is easy to compare:

- [React — callback refs and state](../react/)
- [Vue — shallow reactive refs and computed state](../vue/)
- [Angular — signal queries and computed state](../angular/)

## Debug profile

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## Install

`npm install`

## Build

`npm run build`

## Important files

- `package.json`
- `index.html`
- `src/main.js`
- `src/styles.css`
