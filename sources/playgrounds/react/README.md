# React playground

## Purpose

Run the shared deterministic workbench through the declarative `@rightxt/tracker-react` component contract.

## Where to start

Read `src/main.jsx`. One coherent configuration owner replaces immutable `options` and `rules` props while `sourceRoot` remains a real DOM-reference prop. Runtime events use callback props. Only `ref.refresh()`, `ref.requestRefresh()`, `getStats()`, and `resetStats()` are imperative.

The materialized `src/playground/workbench.js` preflights demo-edited candidates with Core. Normal React applications do not need to import Core for configuration and should not copy the framework-neutral DOM workbench architecture.

This playground uses Tracker's `development` package condition for debug diagnostics. Applications should use the default production export unless they need the debug build. Vite's condition does not imply a non-production application bundle.

## Build

```sh
npm install
npm run build
```
