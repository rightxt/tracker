# Vue playground

## Purpose

Run the shared deterministic workbench through the declarative `@rightxt/tracker-vue` component contract.

## Where to start

Read `src/main.js`. A `shallowRef` replaces the complete options/rules configuration, the component receives actual `options`, `rules`, and `sourceRoot` props, events remain Vue emits/listeners, and only the exposed `refresh()`, `requestRefresh()`, stats, and reset methods are imperative.

The materialized `src/playground/workbench.js` preflights demo-edited candidates with Core. Normal Vue applications do not need that direct Core import and should not copy the framework-neutral DOM workbench architecture.

This playground uses Tracker's `development` package condition for debug diagnostics. Applications should use the default production export unless they need the debug build. Vite's condition does not imply a non-production application bundle.

## Build

```sh
npm install
npm run build
```
