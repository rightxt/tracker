/**
 * Builds inline `style` text that isolates an internal probe element from
 * author CSS.
 *
 * `all: initial !important` resets nearly every CSS property to its initial
 * value regardless of any author rule (`div { display: none }`, `* {
 * box-sizing: border-box; min-width: 200px }`, forced flex/grid
 * participation, etc.) — an inline `!important` declaration wins the cascade
 * over any selector-based author `!important` rule. `direction` and
 * `unicode-bidi` are the two properties the `all` shorthand does not reset
 * (per spec), so callers that depend on a concrete `direction` must still
 * declare it explicitly. Every declaration in `declarations` is applied
 * after the reset, also as `!important`, so it always wins.
 *
 * @param declarations - Probe-specific property/value pairs applied after the reset.
 * @returns Inline `style` text with every declaration marked `!important`.
 */
function createIsolatedProbeStyle(declarations: Readonly<Record<string, string>>): string {
  const overrides = Object.entries(declarations).map(([property, value]) => `${property}: ${value} !important`);

  return ['all: initial !important', ...overrides].join('; ');
}

export { createIsolatedProbeStyle };
