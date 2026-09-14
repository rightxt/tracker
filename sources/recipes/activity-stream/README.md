# Activity stream recipe

This recipe presents a realistic engineering activity feed whose content changes continuously while users may be reading older history. Vanilla Tracker is deliberately a sparse unresolved-work overview, not a second representation of every activity row.

## Build

```sh
npm install
npm run build
```

The standalone consumer imports only the public `@rightxt/tracker-vanilla` package and its stylesheet.

## What this recipe demonstrates

- a vertical, element-mode Tracker beside a fixed application-owned scroller;
- batched live insertion and a 40-event manual burst;
- bounded DOM-backed history with safe prefix pruning;
- follow-latest behavior that does not steal the viewport while history is being read;
- a separate pending-new-events control;
- unresolved Attention and Critical work as the only Tracker sources;
- source rows remaining in the feed after acknowledgement;
- clustering, a viewport indicator, and keyboard-accessible marker navigation;
- host-owned invalidation through one `requestRender()` call per completed application transaction.

## What to try

1. Stay at the bottom and watch a normal live batch arrive every five seconds.
2. Scroll into older history and observe that incoming activity does not move the viewport.
3. Use `↓ N new events` to return to the latest retained row.
4. Acknowledge an Attention or Critical event. Its source remains, but its Tracker marker disappears.
5. Use `Mark all read`. The unread count becomes zero, while unresolved Tracker markers remain.
6. Use `Simulate burst (+40)` to see dense activity form useful clusters.
7. Trigger several bursts, then read mid-history while retention removes an old prefix without moving the visible anchor.

## Synthetic data

`src/activity-generator.js` owns a fixed-seed pseudo-random sequence. It uses stable people, projects, services, environments, and explicit product/engineering templates rather than Faker or arbitrary prose. IDs are monotonic application-owned numbers. The approximate distribution is 78% ordinary activity, 15% Attention, and 7% Critical activity.

## Tracker scope

```text
Main feed: all retained activity
Unread: application state only
Tracker: unacknowledged Attention and Critical events only
```

Unread is intentionally not a Tracker rule: it can be numerous without being useful global navigation information.

## Element-mode architecture

```text
sourceRoot = fixed activity scroller
scrollRoot = same activity scroller
renderHost = neighboring Tracker host
```

The Tracker has explicit vertical/right placement, enabled viewport and accessibility/keyboard interaction, and two attribute-based rules. Rule labels include each event’s message, and activation scrolls the source row into view and focuses it.

## Application-owned invalidation

Mutation observation and interval polling are disabled:

```text
mutation = disabled
interval = disabled
resize = enabled
scroll = enabled
```

Initial DOM is complete before Tracker mounts. Each live batch, burst, acknowledgement, single read action, and mark-all-read action performs all application work first and then invokes exactly one scheduled `tracker.requestRender()`. Scroll updates remain enabled to keep the viewport projection current.

## Follow latest and retention

The application follows latest only when the stream is within 96 CSS pixels of its bottom. Otherwise it preserves the reader’s scroll position and increments the separate `N new events` count. Returning near the bottom clears that count.

Retention uses high/low-water pruning:

```text
initial history: 300
soft maximum: 600
trim target: 450
hard safety ceiling: 900
```

When a reader is in history, pruning records the first visible event’s position, retains a 12-row safety buffer before it, removes only a safe prefix, and compensates `scrollTop` from the measured post-removal position. If a safe prefix cannot be removed and growth reaches 900 rows, automatic generation is suspended independently of the user’s Pause preference. Returning to the tail allows safe pruning and resumes generation; manual burst is disabled at that ceiling. This prevents unbounded DOM growth.

## Clustering

Clustering is enabled with an explicit threshold of `1.25` track percentage points. The threshold keeps isolated unresolved events individually activatable while merging dense live-history regions without turning the rail into one large cluster.

## Project structure

- `index.html` — semantic application shell and dedicated Tracker host.
- `src/activity-generator.js` — deterministic synthetic domain and event generation.
- `src/main.js` — application state, rendering, lifecycle, retention, and public Tracker integration.
- `src/styles.css` — responsive application, event, and Tracker-host presentation.

The feed is intentionally DOM-backed and bounded. This recipe does not claim support for virtualized or infinite lists.
