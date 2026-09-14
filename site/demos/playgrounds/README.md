# RXT Tracker playgrounds

## Purpose

The five playgrounds run one deterministic, progressively disclosed workbench through Vanilla, Custom Element, React, Vue, and Angular. The fixture, controls, mutations, rule model, CSS-variable editor, observers, and runtime presentation are intentionally identical.

The framework-neutral DOM workbench in `../../shared/playground/` owns complete configuration candidates and preflights them with Core's public validator. It is demo infrastructure, not a new Tracker abstraction and not a recommended application architecture for React, Vue, or Angular.

## Integration boundaries

Each `src/main.*` remains the starting point. It shows the real integration construction, configuration mechanism, event transport, public imperative commands, and cleanup. Shared code must not emulate framework APIs or reach into private runtime state.

All playgrounds deliberately select Tracker's `development` package condition for debug diagnostics. Normal consumers use the default production export unless they intentionally choose the debug build; this condition is independent of whether the application bundle itself is minified.

## Maintenance

Keep one canonical workbench and stylesheet, preserve equivalent page hosts, and materialize shared sources only into standalone publication snapshots. Integration-specific files should stay small and educational.
