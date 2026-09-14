# Angular playground

## Purpose

Run the shared deterministic workbench through the declarative `@rightxt/tracker-angular` component contract and normal Angular tooling.

## Where to start

Read `src/main.ts`. One signal owns the immutable options/rules configuration bound through `[options]`, `[rules]`, and `[sourceRoot]`. Runtime events use component outputs. The queried public component is used only for `refresh()`, `requestRefresh()`, stats, and reset commands.

The materialized `src/playground/workbench.js` preflights demo-edited candidates with Core. Normal Angular applications do not need that direct Core import and should not copy the framework-neutral DOM workbench architecture.

This playground uses Tracker's `development` package condition for debug diagnostics. Applications should use the default production export unless they need the debug build. Angular's `conditions: ['development']` selects the Tracker debug package and does not change the application's bundle mode.

## Build

```sh
npm install
npm run build
```
