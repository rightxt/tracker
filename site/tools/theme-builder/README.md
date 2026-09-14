# Theme Builder

Theme Builder is a dependency-free static site tool for editing and exporting the public RXT Tracker CSS custom-property contract.

The live preview is intentionally synthetic: it presents deterministic track, viewport, marker, cluster, hover, selected, and focus states without importing or mounting an `@rightxt/tracker-*` package. All current public root `--rxtt-*` variables are grouped into validated controls. The generated stylesheet contains only explicit overrides and can be copied or downloaded.

The canonical source is this directory. Build and serve it through the repository site commands:

```sh
pnpm site:build:dev
pnpm site:serve:dev
```

The public route is `/tools/theme-builder/`. It uses the site's `static` build strategy, so it performs no package install and produces no demo publication source snapshot.
