import '@rightxt/tracker-element/register';
import '@rightxt/tracker-element/style.css';
import './shared/base.css';
import shadowApplicationCss from './shadow.css?inline';
import './styles.css';

/** Initial number of matching sources inside the user-managed ShadowRoot. */
const INITIAL_SHADOW_TARGET_COUNT = 3;
/** Number of matching sources in the alternative Light DOM source. */
const LIGHT_TARGET_COUNT = 2;

/** Control that mutates the active ShadowRoot source. */
const addTargetButton = document.querySelector('#add-shadow-target');
/** Text that identifies the currently selected source/query context. */
const activeSourceContext = document.querySelector('#active-source-context');
/** Alternative source/query root in document Light DOM. */
const lightRegion = document.querySelector('#light-region');
/** Document element that owns the user-managed ShadowRoot. */
const shadowHost = document.querySelector('#source-shadow-host');
/** Static initial fixture cloned into the user-managed ShadowRoot. */
const shadowSourceTemplate = document.querySelector('#shadow-source-template');
/** Live text describing configuration and user actions. */
const status = document.querySelector('#shadow-status');
/** Empty Light DOM destination for the configured custom element. */
const trackerMountPoint = document.querySelector('#tracker-mount-point');
/** Controls that replace the connected element's source/query root. */
const sourceControls = document.querySelectorAll('input[name="shadow-source"]');

if (
  !(addTargetButton instanceof HTMLButtonElement) ||
  !(activeSourceContext instanceof HTMLElement) ||
  !(lightRegion instanceof HTMLElement) ||
  !(shadowHost instanceof HTMLElement) ||
  !(shadowSourceTemplate instanceof HTMLTemplateElement) ||
  !(status instanceof HTMLElement) ||
  !(trackerMountPoint instanceof HTMLElement) ||
  sourceControls.length !== 2
) {
  throw new Error('Shadow Element scenario markup is incomplete.');
}

/** Actual user-managed ShadowRoot used as the initial source/query context. */
const sourceShadowRoot = shadowHost.attachShadow({ mode: 'open' });
/** Application-only styling for content inside the user-managed ShadowRoot. */
const shadowStyle = document.createElement('style');
/** Fixture container inside the source ShadowRoot. */
const shadowRegion = document.createElement('section');
/** Heading for the ShadowRoot fixture. */
const shadowHeading = document.createElement('h2');

shadowStyle.textContent = shadowApplicationCss;
shadowRegion.id = 'shadow-region';
shadowRegion.className = 'source-region';
shadowHeading.textContent = 'ShadowRoot source';
shadowRegion.append(shadowHeading, shadowSourceTemplate.content.cloneNode(true));
sourceShadowRoot.append(shadowStyle, shadowRegion);

/**
 * Creates one source matching the shared rule used for both root types.
 *
 * @param {string} sourceName - Human-readable source context.
 * @param {number} targetNumber - One-based target number.
 * @returns {HTMLElement} New matching source.
 */
function createSourceTarget(sourceName, targetNumber) {
  const target = document.createElement('article');
  const heading = document.createElement('h3');
  const description = document.createElement('p');

  target.className = 'source-target';
  heading.textContent = `${sourceName} target ${String(targetNumber)}`;
  description.textContent = 'The same selector and rule are used regardless of which source/query context is active.';
  target.append(heading, description);

  return target;
}

/**
 * Uses source content to distinguish marker titles without source-specific rules or styling.
 *
 * @param {Element} element - Matching source element.
 * @returns {string | null} Human-readable marker label.
 */
function resolveTargetLabel(element) {
  return element.querySelector('h3')?.textContent?.trim() ?? null;
}

/** Custom Element configured completely before its first DOM connection. */
const tracker = document.createElement('rxt-tracker');
tracker.id = 'shadow-tracker';
tracker.dataset.initialSource = 'shadow-root';
tracker.dataset.activeSource = 'shadow-root';
tracker.replaceOptions({
  clustering: { enabled: false },
  orientation: 'vertical',
});
tracker.replaceRules([{ selector: '.source-target', label: resolveTargetLabel }]);
tracker.sourceRoot = sourceShadowRoot;
trackerMountPoint.append(tracker);

status.textContent = `The first connected runtime is tracking ${String(INITIAL_SHADOW_TARGET_COUNT)} ShadowRoot targets.`;

/** Current source identity used to constrain the mutation action. */
let activeSource = 'shadow';
/** Number assigned to the next dynamically added shadow source. */
let shadowTargetCount = INITIAL_SHADOW_TARGET_COUNT;
/** Owns all page-level event listeners for deterministic cleanup. */
const lifecycle = new AbortController();
/** Shared listener options for the scenario controls. */
const listenerOptions = { signal: lifecycle.signal };

/**
 * Replaces only the connected element's source/query context.
 *
 * @param {Event} event - Change event from a source-selection radio.
 * @returns {void}
 */
function handleSourceSelection(event) {
  const control = event.currentTarget;

  if (!(control instanceof HTMLInputElement) || !control.checked) {
    return;
  }

  activeSource = control.value;
  const tracksShadowRoot = activeSource === 'shadow';
  tracker.sourceRoot = tracksShadowRoot ? sourceShadowRoot : lightRegion;
  tracker.dataset.activeSource = tracksShadowRoot ? 'shadow-root' : 'light-dom';
  addTargetButton.disabled = !tracksShadowRoot;
  activeSourceContext.textContent = tracksShadowRoot ? 'open ShadowRoot' : 'Light DOM region';
  status.textContent = tracksShadowRoot
    ? `The same Tracker element is tracking ${String(shadowTargetCount)} ShadowRoot targets.`
    : `The same Tracker element is tracking ${String(LIGHT_TARGET_COUNT)} Light DOM targets.`;
}

/** Adds one matching source while the ShadowRoot is active. */
function addShadowTarget() {
  if (activeSource !== 'shadow') {
    return;
  }

  shadowTargetCount += 1;
  shadowRegion.append(createSourceTarget('Shadow', shadowTargetCount));
  status.textContent = `Added Shadow target ${String(shadowTargetCount)}. Tracker will observe the mutation automatically.`;
}

/** Releases the scenario's page-level listeners. */
function destroyScenario() {
  lifecycle.abort();
}

for (const sourceControl of sourceControls) {
  sourceControl.addEventListener('change', handleSourceSelection, listenerOptions);
}
addTargetButton.addEventListener('click', addShadowTarget, listenerOptions);
window.addEventListener('pagehide', destroyScenario, { once: true });
