# Mutation observation scope

This scenario compares two Tracker instances that query the same content with the same rules but listen for invalidating DOM mutations in different regions.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## The two Tracker instances

The scoped Tracker uses the default mutation target. Its source/query scope and mutation observation scope are both `#tracked-region`.

The broad Tracker has the same `sourceRoot`, rules, fixture, and behavior, but `updates.mutation.targets` resolves to `document.body`. Its query scope remains `#tracked-region` while its mutation observation scope becomes the complete body.

Styling and accessible labels distinguish the two rails without changing the observation lesson.

## What `sourceRoot` controls

`sourceRoot` has two related default responsibilities:

1. It scopes where Tracker rules query for source elements.
2. It supplies the default MutationObserver target when custom mutation targets are not provided.

These responsibilities are not inseparable. Both Trackers in this scenario continue to find the same six marker sources inside `#tracked-region`.

## What `updates.mutation.targets` controls

`updates.mutation.targets` changes where Tracker listens for invalidating DOM mutations. It does not change where Tracker rules query for source elements.

The live comparison uses `getStats().observers.mutation` as its primary metric. This counter records processed MutationObserver callback batches containing external mutations. Render requests remain a secondary metric because mutation callbacks can be debounced or coalesced before a render transaction.

Normal scroll and resize behavior remains enabled.

## What to try

1. Add and remove a node inside `sourceRoot`. Both mutation counters increase.
2. Add and remove a node outside `sourceRoot` but inside `document.body`. Only the broad counter increases.
3. Compare the marker counts after every action. Both Trackers retain the same six-marker set.

Removal controls are disabled when their corresponding region contains no experiment node, so the sequence can be repeated without reloading.

## Expected results

| Mutation location                            | Scoped observer  | Broad observer |
| -------------------------------------------- | ---------------- | -------------- |
| Inside `sourceRoot`                          | Observes         | Observes       |
| Outside `sourceRoot`, inside `document.body` | Does not observe | Observes       |

## Why the inserted nodes do not become markers

Experiment nodes intentionally match neither `.demo-error` nor `.demo-note`. Mutation observation depends on an external mutation occurring within an observed target; Core does not require the mutated node itself to match a Tracker rule before invalidating marker data.

Consequently, the broad Tracker can react to an outside mutation without discovering any outside marker source.

## Tracker-owned mutations

The broad observer also covers the DOM containing both rendered rails. Core identifies and filters Tracker-owned renderer mutations before recording mutation activity or requesting another render, preventing the normal renderer from recursively invalidating itself.

The statistics UI writes through readonly input `value` properties. Those updates do not create the child-list records used by this experiment.

## Debug profile

Scenario policy selects the public development package condition. The debug build adds richer tracing and diagnostic metadata, but the lesson uses only public stats that directly describe mutation observation scope.

## Important files

- `index.html` presents the source/query and mutation-scope comparison before the experiment controls.
- `src/main.js` keeps the shared rules and `sourceRoot` visible while showing the one meaningful `mutation.targets` difference.
- `src/styles.css` distinguishes the two profiles and preserves a focused responsive reading order.
- `vite.config.js` selects the development package condition required by Scenario policy.
