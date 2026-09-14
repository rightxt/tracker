# Accessibility and keyboard navigation

This scenario isolates Core's public accessible naming, keyboard selection, and marker activation contract on one unclustered vertical rail.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## Accessible Tracker naming

The scenario explicitly configures `a11y.label` as `Demo section navigation`. With `a11y.enabled: true`, Core exposes that string as the Tracker root's `aria-label`. Core does not assign a landmark or widget role to the root, so the browser validation checks the confirmed root label rather than inventing role semantics.

## Focus, selection, and activation

With both `a11y.enabled` and `a11y.keyboard` true, Core adds `tabindex="0"` to the Tracker root. The root receives DOM focus. Individual rendered markers do not become separate tab stops.

Logical selection is independent of DOM focus. It initially points to the first render record and is exposed through the public snapshot plus `data-rxtt-selected="true"`. Arrow navigation updates selection while DOM focus remains on the root.

Activation is a third state. Enter or Space activates the selected record. This demo rule enables focus behavior on each source, so Core scrolls to the source and then focuses it before publishing `marker:activate`.

## Keyboard controls

For this vertical Tracker, Arrow Up and Arrow Down move to adjacent records. Home and End select the first and last records. Enter and Space activate the selected record. Horizontal arrow keys are intentionally not part of this vertical rail's navigation contract.

The two outside buttons and Tracker host are ordered so a user can Tab from the first control to the Tracker root and then to the second control without a mouse or focus trap.

## `selection:change`

The event reports committed key transitions as `previousKey` and `selectedKey`. It is emitted for the initial default selection at mount and for later real changes, but not when navigation remains at a list boundary or activation keeps the same key.

## Marker activation

The public `marker:activate` payload identifies the represented source, label, selector, rule index, stable key, and source keyboard event. Application code only reflects that payload in status; it does not implement Tracker keyboard behavior.

## Application responsibility

This scenario demonstrates a public interaction contract, not complete WCAG conformance. A production application's semantics, focus order, contrast, motion, content, validation, and assistive-technology testing remain application responsibilities.

## What to try

1. Focus the button before Tracker and press Tab once.
2. Press Arrow Down and observe selection change while focus remains on the Tracker root.
3. Press End, then Enter or Space. Core navigates to and focuses Cleanup.
4. Shift+Tab or use ordinary page controls to continue through native focus order.

## Debug profile

Scenario policy selects the public development package condition. The lesson uses public options, events, snapshots, and stable standard-renderer attributes only.

## Important files

- `index.html` presents the real keyboard model, state output, native tab path, and five-source fixture.
- `src/main.js` configures accessible naming and reflects focus, selection, and activation without duplicating keyboard logic.
- `src/styles.css` supplies visible non-color-only state and a responsive reading order.
- `vite.config.js` selects the development package condition required by Scenario policy.
