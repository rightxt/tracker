import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import './shared/base.css';
import './styles.css';

/** Selector for the rule that must claim overlapping priority cards first. */
const PRIORITY_SELECTOR = '.rule-card[data-priority="high"]';

/** Selector for the fallback rule that also matches priority cards. */
const FALLBACK_SELECTOR = '.rule-card';

/** Source root shared by both ordered rules. */
const fixture = document.querySelector('#rule-fixture');

/** Control that demonstrates automatic computed-label refresh. */
const renameButton = document.querySelector('#rename-normal-item');

/** Heading changed by the computed-label demonstration. */
const renamedTitle = document.querySelector('#accessibility-review [data-rule-title]');

/** Visible status for the rename demonstration. */
const renameStatus = document.querySelector('#rename-status');

/** Radio controls that select the activation-time focus destination. */
const focusModeInputs = document.querySelectorAll('input[name="focus-mode"]');

/** Visible status for the current focus destination. */
const focusModeStatus = document.querySelector('#focus-mode-status');

/** Application-owned activation summary outside the Tracker source root. */
const activationResult = document.querySelector('#activation-result');

/** Human-readable summary updated from the public activation event. */
const activationSummary = document.querySelector('#activation-summary');

/** Public payload fields and completed focus state rendered by the application. */
const activationOutputs = Object.freeze({
  title: document.querySelector('#activation-title'),
  selector: document.querySelector('#activation-selector'),
  ruleIndex: document.querySelector('#activation-rule-index'),
  label: document.querySelector('#activation-label'),
  focus: document.querySelector('#activation-focus'),
});

if (
  !(fixture instanceof HTMLElement) ||
  !(renameButton instanceof HTMLButtonElement) ||
  !(renamedTitle instanceof HTMLElement) ||
  !(renameStatus instanceof HTMLElement) ||
  focusModeInputs.length !== 2 ||
  !(focusModeStatus instanceof HTMLElement) ||
  !(activationResult instanceof HTMLElement) ||
  !(activationSummary instanceof HTMLElement) ||
  !Object.values(activationOutputs).every((output) => output instanceof HTMLOutputElement)
) {
  throw new Error('Rule-resolution markup is incomplete.');
}

/** @type {'primary' | 'secondary'} Focus destination read synchronously during activation. */
let focusMode = 'primary';

/**
 * Reads the current card heading synchronously while Tracker resolves a label.
 *
 * @param {Element} element Matched source element.
 * @returns {string | null} Normalized heading text, or null when unavailable.
 */
function resolveCardTitle(element) {
  const title = element.querySelector('[data-rule-title]')?.textContent?.trim();
  return title === undefined || title.length === 0 ? null : title;
}

/**
 * Computes the higher-priority label synchronously without application side effects.
 *
 * @param {Element} element Matched priority card.
 * @returns {string | null} Prefixed current heading.
 */
function resolvePriorityLabel(element) {
  const title = resolveCardTitle(element);
  return title === null ? null : `Priority · ${title}`;
}

/**
 * Resolves the nested element synchronously when built-in activation scrolling begins.
 *
 * @param {Element} element Matched source card.
 * @returns {HTMLElement | null} Nested scroll destination.
 */
function resolveScrollTarget(element) {
  const target = element.querySelector('[data-scroll-target]');
  return target instanceof HTMLElement ? target : null;
}

/**
 * Resolves the current application-selected button synchronously during activation without mutating state.
 *
 * @param {Element} element Matched source card.
 * @returns {HTMLButtonElement | null} Nested focus destination.
 */
function resolveFocusTarget(element) {
  const target = element.querySelector(`[data-focus-target="${focusMode}"]`);
  return target instanceof HTMLButtonElement ? target : null;
}

/** Ordered rules; the first matching rule owns each source element. */
const rules = [
  {
    selector: PRIORITY_SELECTOR,
    label: resolvePriorityLabel,
    scroll: {
      align: 'center',
      behavior: 'auto',
      enabled: true,
      target: resolveScrollTarget,
    },
    focus: {
      enabled: true,
      target: resolveFocusTarget,
    },
  },
  {
    selector: FALLBACK_SELECTOR,
    label: resolveCardTitle,
    scroll: {
      align: 'center',
      behavior: 'auto',
      enabled: true,
      target: resolveScrollTarget,
    },
    focus: {
      enabled: true,
      target: resolveFocusTarget,
    },
  },
];

/** Page-level Tracker configured for deterministic, unclustered rule inspection. */
const tracker = new Tracker({
  options: {
    clustering: { enabled: false },
    track: { className: 'rule-resolution-track' },
  },
  rules,
});

/**
 * Applies application-owned state after Core completes scroll and focus behavior.
 *
 * @param {{element: Element, label: string | null, ruleIndex: number, selector: string}} payload Public event payload.
 * @returns {void}
 */
function handleMarkerActivation({ element, label, ruleIndex, selector }) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  fixture.querySelectorAll('.rule-card.is-active').forEach((card) => {
    card.classList.remove('is-active');
  });
  element.classList.add('is-active');

  const title = resolveCardTitle(element) ?? 'Untitled card';
  const focusTarget = resolveFocusTarget(element);
  const focusCompleted = focusTarget !== null && document.activeElement === focusTarget;
  const focusLabel = focusTarget?.textContent?.trim() ?? 'No focus target';

  activationOutputs.title.value = title;
  activationOutputs.selector.value = selector;
  activationOutputs.ruleIndex.value = String(ruleIndex);
  activationOutputs.label.value = label ?? 'None';
  activationOutputs.focus.value = `${focusLabel} · completed before marker:activate: ${focusCompleted ? 'yes' : 'no'}`;
  activationSummary.textContent = `Activated ${title}. The application reaction ran after the built-in behaviors.`;
  activationResult.dataset.focusCompleted = String(focusCompleted);
  activationResult.dataset.sourceId = element.id;
}

/**
 * Changes a normal card title and lets the default mutation observer synchronize its label.
 *
 * @returns {void}
 */
function renameNormalItem() {
  renamedTitle.textContent = 'Accessibility review — updated';
  renameButton.disabled = true;
  renameStatus.textContent = 'Heading changed. Normal mutation observation is recomputing the marker label.';
}

/**
 * Updates only application state read later by the focus target resolver.
 *
 * @param {Event} event Radio-group change event.
 * @returns {void}
 */
function handleFocusModeChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || (input.value !== 'primary' && input.value !== 'secondary')) {
    return;
  }

  focusMode = input.value;
  focusModeStatus.textContent = `${input.value === 'primary' ? 'Primary' : 'Secondary'} action selected.`;
}

/** Unsubscribes the application reaction from the public event. */
const unsubscribeActivation = tracker.on('marker:activate', handleMarkerActivation);

tracker.mount({ sourceRoot: fixture });

/** Owns application DOM listeners for deterministic cleanup. */
const controls = new AbortController();

/**
 * Releases application listeners and the mounted Tracker when the page is discarded.
 *
 * @returns {void}
 */
function destroyScenario() {
  controls.abort();
  unsubscribeActivation();
  tracker.destroy();
}

renameButton.addEventListener('click', renameNormalItem, { signal: controls.signal });
focusModeInputs.forEach((input) =>
  input.addEventListener('change', handleFocusModeChange, { signal: controls.signal }),
);

window.addEventListener('pagehide', destroyScenario, { once: true });
