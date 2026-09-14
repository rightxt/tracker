# Benchmark report contract

Benchmark reports are generated diagnostics. Timestamped JSON and CSV files in this directory are gitignored; this README is maintained source documentation.

## Files

Each successful runner invocation writes exactly one pair:

```text
<benchmark-family>-<ISO-timestamp>.json
<benchmark-family>-<ISO-timestamp>.csv
```

When a standalone runner receives `--output <path>`, it also writes the same JSON document at that explicit path. The timestamped pair remains the authoritative output of the invocation.

## JSON schema version 2

The shared writer owns `benchmark`, `generatedAt`, `phase`, `reportSchemaVersion`, and `smoke`; a profile cannot override them. The structural contract is:

```js
{
  benchmark: 'core-render-browser',
  generatedAt: '2026-08-22T09:23:43.279Z',
  phase: 'before',
  reportSchemaVersion: 2,
  smoke: false,

  environment: {
    source: {
      gitCommit: '<40-character commit or unknown>',
      workingTreeDirty: true, // false or "unknown" are also possible
      workingTreeHash: '<sha256>', // "clean" or "unknown" are also possible
      lockfileHash: '<sha256 or unknown>',
    },
    runtime: {
      nodeVersion: 'v24.15.0',
      platform: 'win32',
      architecture: 'x64',
      cpuModel: '<CPU model or unknown>',
    },
    build: {
      provenance: 'production-dist',
      mode: 'production',
      target: '@rightxt/tracker-vanilla production dist',
    },
    browser: { // browser profiles only
      engine: 'chromium',
      version: '<actual browser version>',
      headless: true,
      viewport: { width: 1280, height: 720 },
    },
  },

  methodology: {
    // Profile-owned workload, sampling, warm-up, and timing-scope metadata.
  },

  results: [
    {
      caseId: 'initial-full/1000',
      measurementVersion: 1,
      dimensions: {
        scenario: 'initial-full',
        itemCount: 1000,
      },
      metrics: {
        durationMs: {
          mean: 4.2,
          median: 4.1,
          min: 4.0,
          max: 4.5,
        },
      },
      assertions: {
        itemCount: 1000,
      },
      diagnostics: {
        // Optional. Instrumentation and work evidence; never a comparison gate.
        renders: { requested: 1, completed: 1 },
      },
    },
  ],
}
```

Profiles may add top-level explanatory fields such as `notes`, but the fields above have shared semantics:

- `caseId` is mandatory, non-empty, stable, and unique within the report. It is the only before/after matching key.
- `measurementVersion` is a mandatory positive integer identifying the semantic meaning of a case's `metrics`, independent of `reportSchemaVersion` (which only describes the JSON envelope's structure). A runner bumps it whenever it changes what a case's metric actually measures — for example, narrowing a timing boundary to remove benchmark-owned setup work, or moving previously gating values out of `assertions` so that comparability itself now means something different — even though the metric's name and `reportSchemaVersion` stay the same. A profile whose fix changes the boundary for every case bumps the same version across all of them; a profile where only some cases changed bumps just those. Unaffected cases keep their prior value.
- `dimensions` describes the workload cell. It must be an object and must compare deeply equal before timings are compared.
- `metrics` contains only intended performance/comparison values. It must be a non-empty object containing at least one finite number. Numeric leaves can be nested; nonnumeric evidence is ignored by metric comparison.
- `assertions` contains only correctness or semantic invariants: expected rendered state, result topology, the outcome of a selection, proof that the intended path executed, node release after `destroy`. A changed assertion means the before/after workloads were not semantically equivalent or the scenario executed incorrectly. It must be an object and must compare deeply equal before timings are compared.
- `diagnostics` is optional. When present it must be an object. It holds instrumentation and implementation evidence — allocation/reference churn, work counters, render and DOM-mutation counts, framework render-call counts, scheduler requested/completed tallies, lookup and geometry-read tallies — including where the expected value is zero. No comparison gate reads it, so a work-volume regression stays visible and comparable instead of invalidating the sample. `assertions` is therefore never used as a generic container for counters.
- `methodology` describes the sampling and measurement boundary. `methodology.smoke` mirrors the runner mode for local readability; the shared top-level `smoke` flag is canonical.

Classification is per field, not per counter object: a helper that mixes a semantic outcome with a work counter splits its responsibilities rather than keeping the counter as a hidden hard gate.

The writer rejects malformed envelopes, empty result arrays, missing or duplicate IDs, a missing or non-positive-integer `measurementVersion`, invalid dimensions/metrics/assertions objects, a non-object `diagnostics`, and results without a finite metric before any files are written.

## Provenance semantics

`environment.source.gitCommit` does not claim to identify dirty content. When the worktree is dirty, `workingTreeHash` hashes the tracked diff plus sorted untracked paths and their contents. When Git is unavailable, identity fields explicitly become `"unknown"` rather than aborting the benchmark. `lockfileHash` is the SHA-256 identity of `pnpm-lock.yaml`.

`environment.build.provenance` is one of:

- `source-production-mode`: production-configured source/white-box bundle, not package `dist`;
- `production-dist`: built package output intended to represent shipped artifacts.

The profile registry supplies the stable build target. Browser profiles additionally record the actual launched browser version, execution mode, and viewport.

## Result fields by profile

The exact nested statistics are generated by the current runner, but each family assigns them consistently:

| Family                     | `caseId` dimensions                      | Performance metrics                                                                                  | Assertions (semantic gates)                                                                                                         | Diagnostics (evidence only)                                                                                                                                            |
| -------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projection-boundary`      | scenario, item count                     | Core transaction and optional direct-construction duration summaries                                 | changed projection domains, frozen items array, projected item count                                                                | allocation proxy: items-array reissue and item-reference churn                                                                                                         |
| `core-render-pipeline`     | scenario, item count                     | duration summary                                                                                     | published record count, marker records in the last render pass, cluster count                                                       | marker record churn (created/removed) and scheduler render counters                                                                                                    |
| `styled-light-dom-browser` | style scenario, clustering, record count | setup, style realization, update, selection, and teardown duration summaries across the timed cycles | Light-DOM topology, Core render target per styling update, selection outcome, rendered/snapshot counts, node release after teardown | instrumented cycle: source queries, geometry reads, node add/remove/reuse tallies, DOM mutation summaries, render passes, keyed lookups, and selected-attribute writes |
| `core-render-browser`      | scenario, item count                     | duration summary, optional median coalescing ratio                                                   | rendered item count                                                                                                                 | per-sample scheduler render counters and coalescing trigger/completion tallies                                                                                         |
| `retention-memory`         | scenario, cycle and element counts       | retained-delta heap bytes                                                                            | first/last WeakRef canary collection                                                                                                | baseline, peak, and post-GC heap bytes                                                                                                                                 |
| `adapter-browser`          | framework, variant, item count           | per-work-kind completion and Core render duration summaries across the timed samples                 | per-work-kind rendered item count                                                                                                   | per-work-kind instrumented pass: DOM mutation count, scheduler render delta, React/Vue render-call counts; plus per-sample completion times and render deltas          |

Correctness assertions are deliberately outside `metrics`: a lower duration is not presented as comparable when the run performed different work. Work counters are deliberately outside `assertions`: a benchmark that gates on them reports a performance regression as an invalid sample instead of as a comparable number.

## CSV

CSV is a flattened representation of `results`. Every row repeats the report envelope, complete environment, and methodology context, using dotted column names for nested objects. Arrays are JSON-encoded in one cell. `diagnostics` flattens the same way, so each evidence leaf becomes its own `diagnostics.*` column. This makes an isolated CSV row attributable without reopening the JSON report.

## Comparison policy

[`../compare-reports.mjs`](../compare-reports.mjs) validates both reports as schema version 2 and matches rows by `caseId`.

The following incompatibilities fail by default:

- build provenance, mode, or target;
- lockfile identity when both hashes are known;
- browser engine, version, headed/headless mode, or viewport;
- Node version, platform, architecture, or CPU model.

Every recorded identity of the execution environment is therefore a hard incompatibility, not a warning: durations produced on a different machine, platform, Node runtime, or browser build are not like-for-like, so the comparison refuses to print them as a before/after. An unknown lockfile identity still only warns. `--force` can override these provenance incompatibilities for an explicitly acknowledged exploratory comparison, but family and schema mismatches are always fatal.

Source commit and dirty-worktree identities are recorded rather than required to match: changing source is normally the purpose of a before/after comparison. The CLI prints abbreviated source identities with both report paths and phases, and the JSON retains their full values.

Within a matched case, a `measurementVersion`, dimension, or assertion mismatch blocks metric output and makes the comparison command fail. `diagnostics` is read by no gate: it is carried through the reports for investigation only. A `measurementVersion` mismatch means the metric's semantic boundary changed between the two reports, so it is checked first and reported as its own status (`measurement-version-mismatch`), distinct from a dimension or assertion mismatch. Only finite numeric leaves under `metrics` are compared. Cases present only before or only after are reported explicitly.

Schema version 1 and older bespoke projection reports are intentionally unsupported. Regenerate both sides with the current runners rather than mixing structural contracts.
