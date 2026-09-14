# RXT Tracker verification architecture

Each command owns one artifact boundary. Commands do not build their prerequisites implicitly, and orchestration is intentionally outside the current root command surface.

## Package source

```sh
pnpm packages:test
pnpm packages:test:browser:chromium
pnpm packages:test:browser:firefox
pnpm packages:test:browser:webkit
```

`packages:test` runs only the colocated unit/jsdom corpus under `packages/**`; benchmark and site infrastructure tests have separate configurations. The current verified corpus is 82 files / 979 tests.

`pnpm packages:test:coverage` runs the same corpus with V8 coverage collection scoped to publishable `packages/*/src`, excluding pure re-export barrels verified at the dist boundary instead (see `vitest.config.mjs`). It is an optional diagnostic, not an acceptance gate: there are no coverage thresholds.

All three browser commands execute the same `tests/browser/**/*.browser.test.js` corpus. A test may be engine-specific only when it protects a genuine platform semantic; engine skips are not accepted as a workaround for a shared defect. These tests import package source and require no generated site artifact. The current verified corpus is 37 files / 164 cases per engine; Chromium, Firefox, and WebKit are all mandatory. Real platform semantics belong here: realm behavior, native events, observers, CSS/layout/writing modes, scrolling, and Custom Element/framework browser behavior.

These counts describe the verified architecture at this revision; contract ownership is authoritative, not the numeric target.

## Diagnostic policy

There is no repository-global console/error registry and no shared diagnostics helper. Diagnostic ownership is local to the boundary that produces it.

### Unit/jsdom (Vitest)

A test whose subject is diagnostics or error transport observes and asserts the relevant channel locally. Ordinary runtime failures remain owned by Vitest's native failure handling. A test must await the rejections, framework effects, timers, and deferred operations it starts; nothing recreates a global diagnostic allowlist after a test has ended.

### Package Browser Mode

There is no repository-global Browser console/window policing. Tests whose subject is native or framework error/rejection transport install local listeners and handlers for that purpose. Every other Browser test relies on its direct contract assertions and the runner's own failure reporting. Host-error and rejection transport stay locally owned inside the dedicated final Browser suites that test them.

### Playwright boundaries

Playwright-driven boundaries are fail-closed, but the exact policy is boundary-specific:

- **Distribution standalone smoke** (Chromium, Firefox, and WebKit) observes console warnings/errors and structured uncaught `WebError`s. Failures with owned or unknown source provenance are fatal; failures whose structured source is provably foreign may be ignored. There is no request-failure subsystem here.
- **Site Browser** (Chromium only) applies the same structured owned/unknown console/`WebError` fail-closed principle, and additionally owns active-navigation request-failure/lifetime policy.

Site and distribution provenance checks are boundary-local; they do not share one provenance module.

Useful focused commands:

```sh
pnpm exec vitest run packages/core/src/tracker/__tests__/lifecycle.test.ts
pnpm exec vitest run --project angular
pnpm exec vitest run tests/browser/window-mode.browser.test.js --config vitest.browser.config.mjs --browser.name=firefox
```

## Built packages

```sh
pnpm packages:build
pnpm packages:verify:dist
```

`packages:build` only creates `packages/*/dist`. `packages:verify:dist` rejects missing dist and asks for the build prerequisite; it never builds.

Distribution verification owns:

- generic existence of every manifest export target;
- runtime/declaration public-surface equality and the exact intended public surface;
- production/debug condition resolution and debug-code elimination;
- canonical CSS and standalone browser artifacts;
- framework/Core externalization and Angular partial compilation;
- Element explicit registration;
- representative TypeScript consumers against emitted declarations;
- runtime ESM imports, retention behavior, and a three-engine smoke for standalone artifacts.

The standalone browser smoke loads the emitted Vanilla and Element scripts in Chromium, Firefox, and WebKit and verifies they really mount, render, and tear down. The smoke fails closed on any owned or unknown console warning/error or uncaught `WebError` provenance; failures whose structured source is provably foreign may be ignored. Broader cross-browser Tracker semantics remain package source-Browser contracts.

## Publication artifacts

```sh
pnpm packages:verify:pack
```

This requires current package dist, creates real `pnpm pack` tarballs for all public packages, and inspects the packed file lists and manifests. It verifies workspace-protocol rewriting, lockstep versions, Core dependency pinning, export targets, documentation/license inclusion, and exclusion of source/tests/private files. Tarballs are temporary and removed after verification.

## Other owners

```sh
pnpm benchmarks:test
```

Development-site verification runs in this order:

```sh
pnpm site:test
pnpm packages:build
pnpm site:build:dev
pnpm site:test:browser:chromium
```

Production site publication uses:

```sh
pnpm site:build
```

which additionally requires the exact workspace package version to already exist on npm.

`benchmarks:test` is a focused integrity suite for benchmark tooling, not a workload run. `site:test` contains fast deterministic source and unit contracts. `site:build:dev` builds and verifies the complete real site candidate. `site:test:browser:chromium` is a compact, Chromium-only smoke of the assembled shell, Theme Builder, documentation, and one representative consumer initialization. None of these repeat the Tracker specification; package tests remain the Tracker behavioral authority.

## Choosing checks

- Package source behavior: `packages:test` (optionally `packages:test:coverage` as a diagnostic).
- Real browser package/platform semantics: the affected focused test plus all three `packages:test:browser:*` engines.
- Emitted exports, declarations, runtime resolution, or retention: `packages:build`, then `packages:verify:dist`.
- Packed npm contents: `packages:verify:pack`.
- Benchmark tooling: `benchmarks:test`.
- Site deterministic infrastructure: `site:test`.
- Site independent consumer build/dev artifact: `packages:build`, then `site:build:dev`.
- Site-owned shell, Theme Builder, documentation, and representative consumer Browser surface: `site:test:browser:chromium` after `site:build:dev`.
- Production site publication boundary: `site:build`, only once the exact npm-version prerequisite is satisfied.
