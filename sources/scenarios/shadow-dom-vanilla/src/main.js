import Tracker from '@rightxt/tracker-vanilla';
import trackerCss from '@rightxt/tracker-vanilla/style.css?inline';
import './shared/base.css';
import shadowApplicationCss from './shadow.css?inline';
import './styles.css';

/** Number of matching sources present when the scenario starts. */
const INITIAL_TARGET_COUNT = 3;

/** Control that adds another matching source to the user-managed ShadowRoot. */
const addTargetButton = document.querySelector('#add-shadow-target');
/** Document element that owns the user-managed ShadowRoot. */
const host = document.querySelector('#shadow-host');
/** Live text describing the latest user action. */
const status = document.querySelector('#shadow-vanilla-status');
/** Static initial fixture cloned into the user-managed ShadowRoot. */
const sourceTemplate = document.querySelector('#shadow-source-template');

if (
  !(addTargetButton instanceof HTMLButtonElement) ||
  !(host instanceof HTMLElement) ||
  !(status instanceof HTMLElement) ||
  !(sourceTemplate instanceof HTMLTemplateElement)
) {
  throw new Error('Shadow Vanilla scenario markup is incomplete.');
}

/** Actual source/query root supplied to Tracker. */
const shadowRoot = host.attachShadow({ mode: 'open' });
/** ShadowRoot-local copy of the public Tracker package stylesheet. */
const trackerStyle = document.createElement('style');
/** Application presentation for the user-managed shadow tree. */
const applicationStyle = document.createElement('style');
/** Positioned component that contains both source content and the separate renderer host. */
const shell = document.createElement('section');
/** Container for the deterministic tracked-source fixture. */
const sourceContent = document.createElement('div');
/** Consumer-provided rendering destination inside the source ShadowRoot. */
const renderHost = document.createElement('div');

trackerStyle.dataset.trackerStyles = 'shadow-root';
trackerStyle.textContent = trackerCss;
applicationStyle.textContent = shadowApplicationCss;
shell.className = 'shadow-shell';
sourceContent.className = 'shadow-content';
renderHost.className = 'tracker-render-host';
renderHost.dataset.rendererOwner = 'consumer';
sourceContent.append(sourceTemplate.content.cloneNode(true));
shell.append(sourceContent, renderHost);
shadowRoot.append(trackerStyle, applicationStyle, shell);

/**
 * Creates one matching source with enough height to make its marker position visible.
 *
 * @param {number} targetNumber - One-based target number shown to the user.
 * @returns {HTMLElement} New tracked source.
 */
function createShadowTarget(targetNumber) {
  const target = document.createElement('article');
  const heading = document.createElement('h3');
  const description = document.createElement('p');

  target.className = 'shadow-target';
  heading.textContent = `Shadow target ${String(targetNumber)}`;
  description.textContent = 'This matching element belongs to the source/query scope of the user-managed ShadowRoot.';
  target.append(heading, description);

  return target;
}

/**
 * Resolves a useful native marker title from a tracked source.
 *
 * @param {Element} element - Matching source element.
 * @returns {string | null} Human-readable marker label.
 */
function resolveTargetLabel(element) {
  return element.querySelector('h3')?.textContent?.trim() ?? null;
}

/** Vanilla Tracker whose source and rendering destinations are intentionally distinct. */
const tracker = new Tracker({
  options: {
    clustering: { enabled: false },
  },
  rules: [{ selector: '.shadow-target', label: resolveTargetLabel }],
});

tracker.mount({ sourceRoot: shadowRoot, renderHost });
host.dataset.sourceRoot = 'shadow-root';
status.textContent = `Tracking ${String(INITIAL_TARGET_COUNT)} targets from the open ShadowRoot.`;

/** Number assigned to the next dynamically added source. */
let targetCount = INITIAL_TARGET_COUNT;
/** Owns all page-level event listeners for deterministic cleanup. */
const lifecycle = new AbortController();

/** Adds one source for the active ShadowRoot observer to discover. */
function addShadowTarget() {
  targetCount += 1;
  sourceContent.append(createShadowTarget(targetCount));
  status.textContent = `Added Shadow target ${String(targetCount)}. Tracker will observe the mutation automatically.`;
}

/** Releases listeners and the Vanilla runtime when the page is discarded. */
function destroyScenario() {
  lifecycle.abort();
  tracker.destroy();
}

addTargetButton.addEventListener('click', addShadowTarget, { signal: lifecycle.signal });
window.addEventListener('pagehide', destroyScenario, { once: true });
