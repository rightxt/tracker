# RXT Tracker site infrastructure

`site/**` is the source and build workspace for the public RXT Tracker GitHub Pages site. Demos, tools, and documentation are distinct content families with build behavior appropriate to each family.

The directory is intentionally outside `pnpm-workspace.yaml`. Every demo remains an independent, private npm consumer project with its own manifest and build configuration. Site tools may use a different build strategy when they are not package consumers.

## Source model

`catalog.mjs` separates content, build, location, and navigation concerns:

- `kind` describes site content, currently `demo`, `tool`, and `documentation`;
- `demoKind` describes a demo's learning purpose: `recipe`, `scenario`, or `playground`;
- `buildKind` describes how the page is produced, currently `consumer`, `static`, and `markdown`;
- `source` is the canonical directory below `site/**` for demos/tools or the authoritative repository Markdown file for documentation, while `route` is the stable public URL path;
- `showSource: false` explicitly suppresses a code-oriented Source action for entries such as Theme Builder.

For example, the Long document demo has source `demos/recipes/document` and route `recipes/document`. Public demo routes therefore remain unchanged even though their canonical sources live below `site/demos/**`.

The source tree is organized as follows:

```text
site/
├── catalog.mjs
├── config.mjs
├── demos/
│   ├── recipes/
│   ├── scenarios/
│   └── playgrounds/
├── tools/
├── shared/
│   ├── application/
│   ├── events/
│   ├── navigation/
│   └── playground/
├── shell/
└── scripts/
```

Theme Builder is the first site-owned tool. Its canonical source is `tools/theme-builder`, while its public route is `tools/theme-builder`. It uses the `static` strategy because the current synthetic preview does not import a Tracker package.

Recipes present realistic application workflows and use the production Tracker profile. Scenarios isolate focused behavior and use the debug profile. Playgrounds expose broad integration surfaces and also use the debug profile. The profile is derived centrally from `demoKind`; catalog leaves cannot override it.

Site build mode and Tracker profile are independent axes. A development site build uses local package tarballs, but recipes still select production exports. A production site build uses exact npm packages, but scenarios and playgrounds still select the packages' public `development` condition.

Shared application resources live under `site/shared/**`. Canonical demos reference those files directly. Consumer builds copy only the required resources into temporary `src/shared/**` or `src/playground/**` locations and rewrite the temporary imports. Canonical demo sources never contain generated shared copies.

## Consumer and source publication boundaries

### Development

`site:build:dev` owns actual consumer viability by preparing and using current local package tarballs, copying each consumer independently, installing each consumer independently, building each consumer, and assembling and verifying the resulting dev artifact. There is no separate canonical source-policy preflight gate ahead of this.

### Production

`site:build` owns exact workspace package version availability on npm; each consumer installs and builds against those exact published packages. Source snapshots are generated from the resulting installed consumer projects, and the final snapshots are validated by `verifyPublishedProjectSource()`. Broad source-tree conventions are not independently preflighted before either build; consumer viability is proven by the real install/build itself.

`pnpm site:test` owns fast deterministic source and unit contracts: catalog validation, owned-path and documentation-source containment, Markdown IDs and navigation data, link rewriting and public URL helpers, Source/navigation policy, and the Theme Builder/Core public CSS-variable relationship. It does not assemble a synthetic full-site candidate.

`site:build:dev` verifies the complete real candidate after every consumer, static tool, and documentation route has been built. Artifact verification owns registered routes, local assets, internal links and fragments, non-root deployment safety, build metadata, and publication boundaries.

`pnpm site:test:browser:chromium` owns a compact real-browser smoke against that verified artifact under `/tracker/`: catalog visibility, one complete Theme Builder edit/reset flow, mobile overflow across every registered documentation route, representative no-JavaScript documentation keyboard behavior, documentation scrollspy, and one real consumer initialization signal. Every navigation uses a fresh page and failure collector. Firefox and WebKit remain mandatory for package Browser Mode, not for the site runner; Tracker semantics remain package-browser-test responsibilities.

The permanent development-site verification sequence is:

```sh
pnpm site:test
pnpm packages:build
pnpm site:build:dev
pnpm site:test:browser:chromium
```

There is no separate documentation browser gate. The artifact and Chromium stages consume the complete development build produced by the preceding commands.

## Development site

```sh
pnpm packages:build
pnpm site:build:dev
pnpm site:serve:dev
```

`site:build:dev` validates already-built `packages/*/dist` outputs, creates the required real tarballs through the same `pnpm pack` mechanism as publication verification, rewrites only temporary consumer manifests to `file:` URLs, installs each demo independently with npm, copies static pages without an install step, and builds the complete site. It never builds the library packages. Site-owned child processes set `NG_CLI_ANALYTICS=false`, so Angular consumers remain non-interactive without requiring one exact metadata shape in every project.

The disposable development artifact is:

```text
site/.work/dev-site/
```

`site:serve:dev` serves only that existing verified artifact on an operating-system-assigned loopback port and prints the resulting URL. The development build records a SHA-256 identity of relevant site source/configuration, packing logic, package manifests, and local package dist files. Serving and browser commands recompute that identity and request `pnpm site:build:dev` when the artifact is missing or stale; they never rebuild it implicitly.

Development Source links, when enabled by a catalog entry, point to canonical repository sources under `site/**`. Set `SITE_SOURCE_REF` to select the Git ref; the default is `main`.

## Production site

```sh
pnpm site:build
```

The production build reads the exact root workspace version, preflights every required `@rightxt/tracker-*` package at that exact version in npm, and fails before consumer builds if any version is unavailable. There is deliberately no local fallback. Only temporary consumer manifests are pinned; canonical manifests continue to use `latest`.

The atomic production candidate is committed to:

```text
site-dist/
```

Set `SITE_PUBLISHED_SOURCES_BRANCH` to select the generated publication branch used by production demo Source links; the default is `published-sources`. The deployment workflow copies only the verified `site-dist/sources/**` snapshots to this branch and separately deploys the complete `site-dist/` artifact through GitHub Pages. `SITE_SOURCE_REF` is also retained because repository-backed tools use canonical source links in production.

Production builds preserve independently installable demo source snapshots:

```text
site-dist/sources/<public-demo-route>/
```

Each snapshot contains the exact npm dependency version, generated `package-lock.json`, and materialized shared resources. It excludes dependencies, caches, build output, repository-private paths, and aggregate site navigation. Demo Source links point to these snapshots. Site-owned tools do not receive consumer source snapshots and may opt out of a Source link when their learning contract is not code-oriented; Theme Builder intentionally does so.

## Static tools

Static entries are copied directly from their canonical site source into the candidate artifact and receive the same generic navigation descriptor and assets as consumer pages. The descriptor may omit its optional Source destination. Static entries do not receive local tarballs, run `npm install`, execute a package build, or produce publication source snapshots.

Theme Builder is available at `/tools/theme-builder/`. It exposes all current public root Tracker CSS variables through grouped, browser-validated controls, applies overrides to a deterministic synthetic preview, and exports override-only CSS. The preview intentionally remains synthetic in this stage; the tool has no runtime dependency on `@rightxt/tracker-*`.

## Generated metadata and navigation

`build-info.json` records the artifact layout, timestamp, site mode, Tracker dependency source and version, Tracker profiles by demo kind, source revision, source ref, the development input fingerprint, and the production published-sources branch when applicable.

Aggregate navigation is owned by `site/shared/navigation/**`. The build injects a generic `RXT_SITE_PAGE` descriptor and navigation assets into each live route. Canonical demo HTML is unaware of aggregate route depth, and publication source snapshots do not contain the navigation layer.

The build uses candidate-to-final replacement so an incomplete build cannot partially replace the last valid artifact.

Package builds, library tests, benchmarks, and site builds remain independent workflows. A site development build consumes existing package distributions; it is not a substitute for building or testing the packages.
