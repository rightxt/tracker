# Benchmarks

The benchmark suite contains six specialized profiles. They intentionally measure different boundaries and remain independently executable, while the normal workflow has one complete command.

## Normal workflow

```sh
pnpm packages:build
pnpm benchmarks:run
```

The package build is an explicit prerequisite. `benchmarks:run` fails fast with the missing artifact list instead of building packages implicitly. It builds benchmark-owned adapter bridges and then runs every profile from [`profiles.mjs`](./profiles.mjs) sequentially. Sequential execution avoids CPU and browser contention. Each profile must produce one timestamped JSON/CSV pair before orchestration continues.

The full suite is intentionally expensive. For a structural check of every profile without timing budgets, run:

```sh
pnpm benchmarks:run -- --smoke
```

Smoke mode reduces workload sizes, samples, and retention cycles but exercises every profile and report path. It is not a performance gate and its numbers should not be used as a baseline.

Use a phase label for before/after runs:

```sh
pnpm benchmarks:run -- --phase=before
pnpm benchmarks:run -- --phase=after
```

## Individual profiles

Every standalone runner accepts `--phase=<label>` or `--phase <label>`, `--output=<path>` or `--output <path>`, and `--smoke`. `--output` writes an additional JSON copy at the requested path; the normal timestamped JSON/CSV pair is still written under [`reports/`](./reports/).

| Profile                   | Direct command                                     | Provenance               | Prerequisite outside the aggregate runner                             |
| ------------------------- | -------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Projection boundary       | `node benchmarks/projection-boundary.mjs`          | `source-production-mode` | Installed dependencies; the runner creates its Vite SSR source bundle |
| Core render pipeline      | `node benchmarks/core-render-pipeline.mjs`         | `source-production-mode` | Installed dependencies; the runner creates its Vite SSR source bundle |
| Styled Light DOM browser  | `node benchmarks/styled-light-dom-browser.mjs`     | `production-dist`        | `pnpm packages:build`                                                 |
| Core/Vanilla browser      | `node benchmarks/core-render-browser.mjs`          | `production-dist`        | `pnpm packages:build`                                                 |
| Retention/memory          | `node --expose-gc benchmarks/retention-memory.mjs` | `production-dist`        | `pnpm packages:build`; Node must expose `globalThis.gc`               |
| Adapter/framework browser | `node benchmarks/adapter-browser.mjs`              | `production-dist`        | `pnpm packages:build`, then `node benchmarks/adapters/build.mjs`      |

The source-level profiles intentionally exercise white-box production boundaries that are not necessarily package exports. Their bundles use production compile-time flags, but they are not package `dist` and are reported accordingly. Browser, adapter, style, and memory profiles consume production package artifacts. Adapter bridges resolve both framework adapters and Core from package `dist`; they do not mix adapter `dist` with Core source.

## What the profiles measure

- `projection-boundary` isolates the projection renderer transaction across the current scenario matrix. Production already builds renderer-ready item views inside that transaction, so no separate post-transaction materialization phase is measured.
- `core-render-pipeline` exercises the real Query/Marker/Layout/Cluster pipeline through a benchmark-owned no-op Direct Renderer. It excludes meaningful DOM-write cost without importing unit-test support.
- `styled-light-dom-browser` measures Vanilla rendering and style-realization work for the supported style scenarios. Each cell runs repeatable independent cycles that rebuild their own source DOM and Tracker, and collects instrumentation in one separate trailing cycle so the timed cycles never execute against patched prototypes or an active observer.
- `core-render-browser` measures production Vanilla browser scenarios and scheduler coalescing.
- `retention-memory` reports repeated-cycle heap trends and WeakRef canary evidence. The retention stage of `pnpm packages:verify:dist` remains the pass/fail correctness gate.
- `adapter-browser` measures React, Vue, Angular, and Element update work against one already-mounted runtime per cell. Each work kind is repeated from an equivalent precondition, times only the production trigger and its settle wait, and collects instrumentation in one separate repetition afterwards. Framework bootstrap and teardown stay untimed preparation, since bootstrapping a runtime per sample would dominate the profile.

The exact profile registry, including stable IDs, runners, build targets, preparation, browser use, Node arguments, and smoke support, is in [`profiles.mjs`](./profiles.mjs). Workload implementation remains local to each runner rather than hidden behind a generic framework.

## Reports and comparison

Reports use schema version 2. Every result has a stable `caseId` and separate `dimensions`, performance `metrics`, correctness `assertions`, and optional `diagnostics`. `assertions` holds only semantic invariants — expected rendered state, topology, selection outcome, proof the measured path executed, node release after teardown — while work counters, allocation churn, render-call counts, and other instrumentation live in `diagnostics`, which no comparison gate reads. A work-volume regression therefore stays a visible comparable number instead of turning the sample into an incomparable one. Shared source, runtime, build, and browser provenance is collected asynchronously. See [`reports/README.md`](./reports/README.md) for the exact contract.

Compare two explicit reports:

```sh
node benchmarks/compare-reports.mjs benchmarks/reports/before.json benchmarks/reports/after.json
```

Or select the latest reports by family and phase:

```sh
node benchmarks/compare-reports.mjs --benchmark=core-render-browser
node benchmarks/compare-reports.mjs --benchmark core-render-browser --before before --after after
```

The comparator matches `caseId`, compares only numeric leaves under `metrics`, and blocks a case when its dimensions, assertions, or `measurementVersion` differ. A `measurementVersion` mismatch means the metric's semantic boundary changed between the two reports (for example, a fixed measurement defect), so the case is never treated as a like-for-like before/after even though its name is unchanged. Known incompatible provenance fails by default, and so does any difference in the recorded execution environment - browser version, Node version, platform, architecture, or CPU model - because such numbers are not like-for-like; `--force` is available for an explicitly acknowledged exploratory comparison. Family and schema mismatches cannot be overridden.

## Generated artifacts

`benchmarks/adapters/dist/` and generated report JSON/CSV files are gitignored outputs. Source runners rebuild their temporary bundles, and `pnpm clean` removes benchmark build artifacts. [`reports/README.md`](./reports/README.md) is maintained documentation, not generated data.

The suite is informational: it deliberately has no absolute duration budgets. Repeated runs on the same machine and compatible provenance are required before interpreting small changes.
