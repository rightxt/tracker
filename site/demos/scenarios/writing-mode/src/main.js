import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import '../../../../shared/application/base.css';
import './styles.css';

/** @typedef {{ direction: 'ltr' | 'rtl', label: string, purpose: string, writingMode: string }} WritingModeProfile */
/** @typedef {{ orientation: 'horizontal' | 'vertical', placement: 'bottom' | 'right', physicalAxis: 'X' | 'Y' }} AxisOptions */
/** @typedef {{ axisState: HTMLElement, placementState: HTMLElement, tracker: Tracker }} ComparisonTrackerRecord */

/** @type {readonly Readonly<WritingModeProfile>[]} Representative CSS logical-flow profiles shared by both experiments. */
const WRITING_MODE_PROFILES = Object.freeze([
  Object.freeze({
    direction: 'ltr',
    label: 'Horizontal · LTR',
    purpose: 'Common horizontal-flow baseline.',
    writingMode: 'horizontal-tb',
  }),
  Object.freeze({
    direction: 'rtl',
    label: 'Horizontal · RTL',
    purpose: 'Direction changes while horizontal writing remains fixed.',
    writingMode: 'horizontal-tb',
  }),
  Object.freeze({
    direction: 'rtl',
    label: 'Vertical RL · RTL',
    purpose: 'Reversed vertical flow with a right-to-left block progression.',
    writingMode: 'vertical-rl',
  }),
  Object.freeze({
    direction: 'ltr',
    label: 'Vertical LR · LTR',
    purpose: 'Forward vertical flow with a left-to-right block progression.',
    writingMode: 'vertical-lr',
  }),
]);

/** @type {Readonly<Record<'horizontal' | 'vertical', Readonly<AxisOptions>>>} Explicit placement paired with each physical Tracker orientation. */
const AXIS_OPTIONS = Object.freeze({
  horizontal: Object.freeze({ orientation: 'horizontal', physicalAxis: 'X', placement: 'bottom' }),
  vertical: Object.freeze({ orientation: 'vertical', physicalAxis: 'Y', placement: 'right' }),
});

/** Update profile that makes the fifth Tracker's invalidation entirely host-owned. */
const DISABLED_UPDATE_OPTIONS = Object.freeze({
  interval: Object.freeze({ enabled: false }),
  mutation: Object.freeze({ enabled: false }),
  resize: Object.freeze({ enabled: false }),
  scroll: Object.freeze({ enabled: false }),
});

/** Shared source rule whose labels remain unique and inspectable. */
const TARGET_RULE = Object.freeze({ selector: '.wm-target', label: resolveTargetLabel });

/** Shared axis controls for the four comparison Trackers. */
const axisControls = document.querySelectorAll('input[name="comparison-axis"]');
/** Live summary of the comparison group's synchronized physical axis. */
const comparisonAxisStatus = document.querySelector('#comparison-axis-status');
/** Destination for the four generated comparison panels. */
const comparisonGrid = document.querySelector('#wm-grid');
/** Reusable static structure for one comparison fixture. */
const comparisonPanelTemplate = document.querySelector('#wm-panel-template');
/** Runtime experiment's current CSS direction output. */
const runtimeDirection = document.querySelector('#runtime-direction');
/** Positioned host for the isolated fifth Tracker. */
const runtimeHost = document.querySelector('#wm-runtime-host');
/** Element source and scroll root for the isolated fifth Tracker. */
const runtimeScroller = document.querySelector('#wm-runtime-scroller');
/** Live result of explicit host-owned invalidation. */
const runtimeStatus = document.querySelector('#wm-runtime-status');
/** Destination for runtime profile controls. */
const runtimeToolbar = document.querySelector('#wm-runtime-toolbar');
/** Runtime experiment's current CSS writing-mode output. */
const runtimeWritingMode = document.querySelector('#runtime-writing-mode');

if (
  axisControls.length !== 2 ||
  !(comparisonAxisStatus instanceof HTMLElement) ||
  !(comparisonGrid instanceof HTMLElement) ||
  !(comparisonPanelTemplate instanceof HTMLTemplateElement) ||
  !(runtimeDirection instanceof HTMLElement) ||
  !(runtimeHost instanceof HTMLElement) ||
  !(runtimeScroller instanceof HTMLElement) ||
  !(runtimeStatus instanceof HTMLElement) ||
  !(runtimeToolbar instanceof HTMLElement) ||
  !(runtimeWritingMode instanceof HTMLElement)
) {
  throw new Error('Writing-mode scenario markup is incomplete.');
}

/** Owns page-level listeners and releases them together. */
const lifecycle = new AbortController();
/** Shared options for scenario control listeners. */
const listenerOptions = { signal: lifecycle.signal };

/**
 * Derives a native marker title from the visible source label.
 *
 * @param {Element} element - Matching physical target.
 * @returns {string | null} Trimmed target label.
 */
function resolveTargetLabel(element) {
  return element.textContent?.trim() ?? null;
}

/**
 * Applies one logical CSS flow without changing physical fixture dimensions.
 *
 * @param {HTMLElement} scroller - Element whose logical flow changes.
 * @param {WritingModeProfile} profile - Representative flow profile.
 */
function applyWritingModeProfile(scroller, profile) {
  scroller.style.direction = profile.direction;
  scroller.style.writingMode = profile.writingMode;
  scroller.dataset.direction = profile.direction;
  scroller.dataset.writingMode = profile.writingMode;
}

/**
 * Materializes one physically equivalent comparison panel and mounts its Tracker.
 *
 * @param {WritingModeProfile} profile - The panel's only intentional CSS-flow difference.
 * @param {number} profileIndex - Stable zero-based profile identity.
 * @returns {ComparisonTrackerRecord} Tracker and state outputs updated by the global axis control.
 */
function createComparisonTracker(profile, profileIndex) {
  const fragment = comparisonPanelTemplate.content.cloneNode(true);
  const panel = fragment.querySelector('.wm-panel');
  const heading = fragment.querySelector('[data-profile-label]');
  const purpose = fragment.querySelector('[data-profile-purpose]');
  const writingMode = fragment.querySelector('[data-writing-mode]');
  const direction = fragment.querySelector('[data-direction]');
  const axisState = fragment.querySelector('[data-axis-state]');
  const placementState = fragment.querySelector('[data-placement-state]');
  const host = fragment.querySelector('.wm-host');
  const scroller = fragment.querySelector('.wm-scroller');

  if (
    !(panel instanceof HTMLElement) ||
    !(heading instanceof HTMLElement) ||
    !(purpose instanceof HTMLElement) ||
    !(writingMode instanceof HTMLElement) ||
    !(direction instanceof HTMLElement) ||
    !(axisState instanceof HTMLElement) ||
    !(placementState instanceof HTMLElement) ||
    !(host instanceof HTMLElement) ||
    !(scroller instanceof HTMLElement)
  ) {
    throw new Error(`Writing-mode profile ${String(profileIndex + 1)} template is incomplete.`);
  }

  panel.dataset.profileIndex = String(profileIndex);
  heading.textContent = profile.label;
  purpose.textContent = profile.purpose;
  writingMode.textContent = profile.writingMode;
  direction.textContent = profile.direction;
  scroller.setAttribute('aria-label', `${profile.label} physical scrolling fixture`);
  applyWritingModeProfile(scroller, profile);
  comparisonGrid.append(fragment);

  const tracker = new Tracker({
    options: {
      a11y: { enabled: true, keyboard: true, label: 'Writing-mode physical axis Tracker' },
      clustering: { enabled: false },
      interaction: { drag: true },
      orientation: AXIS_OPTIONS.vertical.orientation,
      placement: AXIS_OPTIONS.vertical.placement,
      track: { className: 'wm-profile-track' },
    },
    rules: [TARGET_RULE],
  });
  tracker.mount({ renderHost: host, scrollRoot: scroller, sourceRoot: scroller });

  return { axisState, placementState, tracker };
}

/** @type {ComparisonTrackerRecord[]} Four synchronized comparison Trackers, one for each representative CSS flow. */
const comparisonTrackers = WRITING_MODE_PROFILES.map(createComparisonTracker);

/**
 * Reconfigures every comparison Tracker to the same physical axis and explicit rail edge.
 *
 * @param {'horizontal' | 'vertical'} orientation - Public Tracker orientation.
 */
function setComparisonAxis(orientation) {
  const nextAxis = AXIS_OPTIONS[orientation];

  for (const { axisState, placementState, tracker } of comparisonTrackers) {
    tracker.patchOptions({ orientation: nextAxis.orientation, placement: nextAxis.placement }, { render: false });
    tracker.render();
    axisState.textContent = `physical ${nextAxis.physicalAxis}`;
    placementState.textContent = nextAxis.placement;
  }

  comparisonAxisStatus.dataset.orientation = nextAxis.orientation;
  comparisonAxisStatus.textContent = `All four comparison Trackers use physical ${nextAxis.physicalAxis} with a ${nextAxis.placement} rail.`;
}

/**
 * Handles the shared comparison-axis radio group.
 *
 * @param {Event} event - Change event from a checked orientation control.
 */
function handleComparisonAxisChange(event) {
  const control = event.currentTarget;

  if (!(control instanceof HTMLInputElement) || !control.checked) {
    return;
  }

  if (control.value !== 'horizontal' && control.value !== 'vertical') {
    throw new Error(`Unsupported comparison orientation "${control.value}".`);
  }

  setComparisonAxis(control.value);
}

for (const axisControl of axisControls) {
  axisControl.addEventListener('change', handleComparisonAxisChange, listenerOptions);
}

applyWritingModeProfile(runtimeScroller, WRITING_MODE_PROFILES[0]);

/** Fifth Tracker with deliberately disabled automatic invalidation. */
const runtimeTracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'Runtime writing-mode physical Y Tracker' },
    clustering: { enabled: false },
    orientation: AXIS_OPTIONS.vertical.orientation,
    placement: AXIS_OPTIONS.vertical.placement,
    track: { className: 'wm-runtime-track' },
    updates: DISABLED_UPDATE_OPTIONS,
  },
  rules: [TARGET_RULE],
});
runtimeTracker.mount({ renderHost: runtimeHost, scrollRoot: runtimeScroller, sourceRoot: runtimeScroller });

/** @type {HTMLButtonElement[]} Runtime controls generated from the same authoritative profile data as the comparison. */
const runtimeProfileButtons = WRITING_MODE_PROFILES.map((profile, profileIndex) => {
  const button = document.createElement('button');

  button.type = 'button';
  button.dataset.profileIndex = String(profileIndex);
  button.textContent = `${profile.writingMode} / ${profile.direction}`;
  button.setAttribute('aria-pressed', String(profileIndex === 0));
  button.addEventListener('click', handleRuntimeProfileSelection, listenerOptions);
  runtimeToolbar.append(button);

  return button;
});

/**
 * Applies a CSS profile and then performs the fifth Tracker's explicit host-owned invalidation.
 *
 * @param {number} profileIndex - Index into the shared representative profile list.
 */
function applyRuntimeFlowProfile(profileIndex) {
  const profile = WRITING_MODE_PROFILES[profileIndex];

  if (profile === undefined) {
    throw new Error(`Writing-mode runtime profile ${String(profileIndex)} does not exist.`);
  }

  applyWritingModeProfile(runtimeScroller, profile);
  runtimeTracker.render();
  runtimeDirection.textContent = profile.direction;
  runtimeWritingMode.textContent = profile.writingMode;

  for (const [buttonIndex, button] of runtimeProfileButtons.entries()) {
    button.setAttribute('aria-pressed', String(buttonIndex === profileIndex));
  }

  const renderCount = Number(runtimeStatus.dataset.renderCount ?? '0') + 1;
  runtimeStatus.dataset.profileIndex = String(profileIndex);
  runtimeStatus.dataset.renderCount = String(renderCount);
  runtimeStatus.textContent = `Applied: ${profile.writingMode} / ${profile.direction}\nHost invalidation: tracker.render()\nGeometry synchronized.`;
}

/**
 * Resolves and applies a runtime-flow profile from its generated button.
 *
 * @param {Event} event - Activation event from a runtime profile button.
 */
function handleRuntimeProfileSelection(event) {
  const button = event.currentTarget;

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  applyRuntimeFlowProfile(Number(button.dataset.profileIndex));
}

/** @type {Tracker[]} All five Tracker instances owned by this scenario. */
const trackers = [...comparisonTrackers.map(({ tracker }) => tracker), runtimeTracker];

/** Releases listeners and every Tracker instance when the page is discarded. */
function destroyScenario() {
  lifecycle.abort();

  for (const tracker of trackers) {
    tracker.destroy();
  }
}

window.addEventListener('pagehide', destroyScenario, { once: true });
