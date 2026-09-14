# Diagnostics and failure boundaries

This Vanilla scenario isolates shared Core diagnostics from adapter-specific consumer-handler failures.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## Build

The demo infrastructure installs this minimal consumer project and runs its normal Vite build.

## What to try

- Trigger an empty MutationObserver-target warning with sink output enabled or temporarily removed.
- Run a one-shot function-valued label that throws and observe the retained marker with a null label.
- Submit an invalid placement and compare committed configuration and synchronization counts before and after rejection.
- Destroy a disposable secondary Tracker and call `getOptions()` across its terminal lifecycle boundary.

Every experiment restores its own temporary state automatically and can be repeated in any order. The main Tracker is never destroyed and no manual restore action is required.

## Diagnostic channels

The recoverable warning appears through the public `warning` event, the configured `diagnostics.output.warn()` sink, and `getStats().warnings`. These channels are independent. `diagnostics.warnings = false` suppresses the console fallback but does not suppress a configured output sink, so the muted experiment temporarily sets both `warnings: false` and `output: null`. The sink panel reports calls for the current experiment separately from its retained historical total, then the demo restores the normal sink, warning option, and observer targets.

The warning event's `details` is a borrowed live diagnostic value. `getStats().warnings.last.details` is a retention-safe sanitized snapshot.

## Tracker-managed failures

The intentionally failing label resolver is installed for exactly one synchronous render and then replaced without another render. Core catches the resolver exception, `diagnostics.output.error()` receives `rule-label-error`, error stats increment exactly once, and the marker remains tracked with `label: null` (therefore no native title). Later scrolling or synchronization uses the restored normal rule and cannot repeat the failure.

This is Tracker-managed because Tracker invokes the resolver itself. By contrast, the Runtime Events scenarios demonstrate consumer handlers that fail after Tracker has delivered `sync:end`; those remain application/framework failures and do not increment Tracker error stats.

## Public exceptions

Invalid configuration throws `TrackerConfigurationError` with `ERR_TRACKER_INVALID_CONFIGURATION` synchronously and atomically. Calling `getOptions()` on the destroyed secondary runtime throws `TrackerLifecycleError` with `ERR_TRACKER_DESTROYED`. These are neither warning events nor sink-owned internal failures.

`destroy()` remains idempotent after terminal cleanup, and final lifecycle state and diagnostics remain readable through the documented terminal APIs. Configuration and rules accessors reject after destruction.

## Debug build

The debug build adds runtime tracing and debug stats. The public diagnostics and event APIs demonstrated here and by the related event scenarios are also available in production builds.

## Important files

- `index.html` contains the static educational dashboard in reading order.
- `src/main.js` begins with the real diagnostics sink, Tracker configuration, subscriptions, and one-shot experiments.
- `src/styles.css` styles the dashboard and fixture.
- `vite.config.js` selects the development package condition.
