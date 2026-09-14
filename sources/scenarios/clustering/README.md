# Marker clustering

This scenario isolates how Core converts six tracked source ranges into standalone marker and cluster render records.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## From source positions to rendered clusters

The Vanilla Tracker uses element mode with a fixed 50rem content plane. Six explicitly positioned source elements produce deterministic physical ranges independent of text wrapping. Core normalizes those ranges to the track's 0-100 coordinate space before clustering.

A cluster is a rendered representation of multiple nearby tracked sources. It adds no source element and does not change the `.cluster-target` rule matches.

## What the threshold controls

`clustering.threshold` is a finite non-negative number measured in track percentage points, not pixels or another CSS length. A candidate joins the current group when its normalized range begins at or before the group's end plus the threshold. The boundary is inclusive.

Core defaults to clustering enabled with threshold `2`. This scenario sets both fields explicitly so its initial grouping remains part of the fixture contract rather than depending implicitly on defaults.

Core uses consecutive-neighbor chaining: every accepted candidate extends the active group bounds. Consequently, a chain of nearby ranges can form one cluster even when its first and last members are farther apart than the threshold.

Compact mode uses `1`; Expanded mode uses `20`. The same Tracker instance receives the change through `patchOptions()`.

## Cluster membership

Compact mode produces one standalone marker for A, a two-source cluster for B+C, and a three-source cluster for D+E+F. Expanded mode keeps A standalone and chains B+C+D+E+F into one five-source cluster.

The result panel reads immutable public snapshots. Rendered clusters also expose `data-rxtt-count`; membership labels shown by activation come from the public `cluster:activate.markers` payload.

## Marker vs cluster activation

A standalone representation publishes `marker:activate`. A cluster publishes `cluster:activate` with its stable key, count, ordered member records, and primary marker. Core uses the first positional member as the cluster's built-in navigation target, performing scroll and configured focus behavior before publishing the event.

## Dynamic threshold changes

Changing the radio selection patches only `clustering.threshold`. It does not recreate the Tracker, change its rules, or modify the source fixture.

## What to try

1. Confirm the initial `1, 2, 2, 3, 6` result values.
2. Activate A, then activate each cluster and compare the event status.
3. Select Expanded and observe B through F merge into a cluster of five.
4. Return to Compact and confirm the original two clusters return.

## Debug profile

Scenario policy selects the public development package condition. The lesson itself relies only on public options, snapshots, rendered data attributes, and events.

## Important files

- `index.html` presents the clustering model, deterministic expectations, controls, status, and fixture.
- `src/main.js` owns the public Tracker configuration, snapshot projection, threshold patch, and activation handlers.
- `src/styles.css` supplies explicit physical fixture geometry and a responsive teaching layout.
- `vite.config.js` selects the development package condition required by Scenario policy.
