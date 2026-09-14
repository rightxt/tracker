import Tracker from '@rightxt/tracker-vanilla';
import './shared/base.css';
import './styles.css';

/** Selector shared by the parent configuration and activation report. */
const TARGET_SELECTOR = '.frame-target';

/** Button that mutates the active same-origin child source root. */
const addTargetButton = document.querySelector('#add-frame-target');

/** Parent-side summary of the latest child marker activation. */
const activationSummary = document.querySelector('#activation-summary');

/** Public activation payload fields displayed in the parent document. */
const activationOutputs = Object.freeze({
  generation: document.querySelector('#activation-generation'),
  label: document.querySelector('#activation-label'),
  realm: document.querySelector('#activation-realm'),
  selector: document.querySelector('#activation-selector'),
});

/** Parent-owned iframe whose loaded document supplies all active runtime DOM identities. */
const frame = document.querySelector('#demo-frame');

/** Parent-side lifecycle history retained across child document generations. */
const lifecycleLog = document.querySelector('#iframe-lifecycle-log');

/** Table body describing the currently mounted public DOM context. */
const mountContext = document.querySelector('#mount-context');

/** Visible mount identity fields updated after each successful child load. */
const mountOutputs = Object.freeze({
  renderHost: document.querySelector('#context-render-host'),
  scrollRoot: document.querySelector('#context-scroll-root'),
  sourceRoot: document.querySelector('#context-source-root'),
  stylesheet: document.querySelector('#context-stylesheet'),
});

/** Button that starts the explicit unmount-before-navigation sequence. */
const navigateButton = document.querySelector('#navigate-frame');

/** Parent-side status for child document and mutation actions. */
const status = document.querySelector('#frame-status');

if (
  !(addTargetButton instanceof HTMLButtonElement) ||
  !(activationSummary instanceof HTMLElement) ||
  !Object.values(activationOutputs).every((output) => output instanceof HTMLOutputElement) ||
  !(frame instanceof HTMLIFrameElement) ||
  !(lifecycleLog instanceof HTMLOListElement) ||
  !(mountContext instanceof HTMLTableSectionElement) ||
  !Object.values(mountOutputs).every((output) => output instanceof HTMLOutputElement) ||
  !(navigateButton instanceof HTMLButtonElement) ||
  !(status instanceof HTMLElement)
) {
  throw new Error('Iframe document-context markup is incomplete.');
}

/**
 * Computes the public marker label from the current child source heading.
 *
 * @param {Element} element Matched element from the active child document.
 * @returns {string} Current source heading or a stable fallback.
 */
function resolveTargetLabel(element) {
  return element.querySelector('h3')?.textContent?.trim() ?? 'Child target';
}

/** Ordered child-source rules retained by the same parent Tracker across remounts. */
const rules = [
  {
    selector: TARGET_SELECTOR,
    label: resolveTargetLabel,
    scroll: {
      align: 'center',
      behavior: 'auto',
      enabled: true,
      target: 'self',
    },
  },
];

/** The single parent-created Vanilla Tracker reused for every child document generation. */
const tracker = new Tracker({
  options: {
    clustering: { enabled: false },
    track: { className: 'iframe-track' },
  },
  rules,
});

/** @type {Document | null} Child document currently owned by the mounted runtime. */
let activeDocument = null;

/** @type {number | null} Demo-owned generation of the active child document. */
let activeGeneration = null;

/** Deterministic generation assigned to the next iframe navigation. */
let nextDocumentGeneration = 2;

/** Number of tracked sources in the active child fixture. */
let targetCount = 0;

/**
 * Resolves the fully loaded same-origin child context without retaining obsolete identities.
 *
 * @returns {{document: Document, generation: number, renderHost: HTMLElement, sourceRoot: HTMLElement, window: Window} | null} Current child identities or null before a valid load.
 */
function getFrameContext() {
  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument?.body || !frameWindow || frameDocument.location.href === 'about:blank') {
    return null;
  }

  const sourceRoot = frameDocument.querySelector('#tracked-content');
  const generation = Number(new URL(frameDocument.location.href).searchParams.get('generation'));
  if (
    !(sourceRoot instanceof frameWindow.HTMLElement) ||
    !Number.isInteger(generation) ||
    generation < 1 ||
    sourceRoot.ownerDocument !== frameDocument ||
    frameDocument.defaultView !== frameWindow
  ) {
    return null;
  }

  return {
    document: frameDocument,
    generation,
    renderHost: frameDocument.body,
    sourceRoot,
    window: frameWindow,
  };
}

/**
 * Appends one application/iframe lifecycle action to the persistent parent log.
 *
 * @param {string} message Human-readable application action.
 * @param {string} action Stable demo-owned action identifier for validation.
 * @param {number} generation Related child document generation, or zero for parent-only actions.
 * @returns {void}
 */
function recordLifecycle(message, action, generation) {
  const item = document.createElement('li');
  item.dataset.action = action;
  item.dataset.generation = String(generation);
  item.textContent = message;
  lifecycleLog.append(item);
}

/**
 * Enables or disables actions according to whether a child runtime is mounted.
 *
 * @param {boolean} enabled Whether child actions are currently valid.
 * @returns {void}
 */
function setControlsEnabled(enabled) {
  addTargetButton.disabled = !enabled;
  navigateButton.disabled = !enabled;
}

/**
 * Updates the parent teaching table without exposing private Tracker identities.
 *
 * @param {{generation: number} | null} context Active demo context, or null while navigating.
 * @param {number | null} pendingGeneration Replacement generation being loaded.
 * @returns {void}
 */
function updateMountContext(context, pendingGeneration = null) {
  if (context === null) {
    const waitingLabel =
      pendingGeneration === null
        ? 'Waiting for child document'
        : `Waiting for Child document #${String(pendingGeneration)}`;
    mountContext.dataset.generation = 'waiting';
    Object.values(mountOutputs).forEach((output) => {
      output.value = waitingLabel;
    });
    return;
  }

  const generationLabel = `Child document #${String(context.generation)}`;
  mountContext.dataset.generation = String(context.generation);
  mountOutputs.sourceRoot.value = `${generationLabel} · #tracked-content`;
  mountOutputs.scrollRoot.value = `${generationLabel} · iframe Window context`;
  mountOutputs.renderHost.value = `${generationLabel} · document.body`;
  mountOutputs.stylesheet.value = `${generationLabel} · child bundle`;
}

/**
 * Updates parent-owned application state from a public event emitted by the child runtime.
 *
 * @param {{element: Element, label: string | null, selector: string}} payload Public marker activation payload.
 * @returns {void}
 */
function handleMarkerActivation({ element, label, selector }) {
  const currentDocument = frame.contentDocument;
  const belongsToCurrentChild = currentDocument !== null && element.ownerDocument === currentDocument;
  const generationLabel = activeGeneration === null ? 'Unknown' : `Child document #${String(activeGeneration)}`;

  activationOutputs.generation.value = generationLabel;
  activationOutputs.label.value = label ?? 'Unlabeled child target';
  activationOutputs.realm.value = belongsToCurrentChild ? 'Yes' : 'No';
  activationOutputs.selector.value = selector;
  activationSummary.textContent = `Parent application received activation for ${label ?? 'an unlabeled child target'}.`;
  activationSummary.dataset.generation = activeGeneration === null ? 'unknown' : String(activeGeneration);
  activationSummary.dataset.payloadInCurrentChild = String(belongsToCurrentChild);
}

/** Parent subscription retained while the Tracker is unmounted and remounted. */
const unsubscribeActivation = tracker.on('marker:activate', handleMarkerActivation);

/**
 * Mounts the same parent-owned Tracker into the distinct identities of the loaded child document.
 *
 * @returns {void}
 */
function mountCurrentFrame() {
  const context = getFrameContext();
  if (context === null || (tracker.mounted && activeDocument === context.document)) {
    return;
  }

  if (tracker.mounted) {
    status.textContent = 'The current child context must be unmounted before a replacement can mount.';
    return;
  }

  recordLifecycle(
    `Child document #${String(context.generation)} loaded with its active Document and Window realm.`,
    'child-loaded',
    context.generation,
  );
  tracker.mount({
    sourceRoot: context.sourceRoot,
    scrollRoot: context.window,
    renderHost: context.renderHost,
  });

  activeDocument = context.document;
  activeGeneration = context.generation;
  targetCount = context.sourceRoot.querySelectorAll(TARGET_SELECTOR).length;
  updateMountContext(context);
  setControlsEnabled(true);
  status.textContent = `Same parent Tracker mounted in Child document #${String(context.generation)}.`;
  recordLifecycle(
    `Same Tracker instance #1 mounted in Child document #${String(context.generation)}.`,
    'tracker-mounted',
    context.generation,
  );
}

/**
 * Appends one tracked source using constructors and nodes from the active child realm.
 *
 * @returns {void}
 */
function addFrameTarget() {
  const context = getFrameContext();
  if (
    context === null ||
    !tracker.mounted ||
    activeDocument !== context.document ||
    activeGeneration !== context.generation
  ) {
    status.textContent = 'Wait for the child document before adding a tracked item.';
    return;
  }

  targetCount += 1;
  const target = context.document.createElement('article');
  const index = context.document.createElement('p');
  const heading = context.document.createElement('h3');
  const description = context.document.createElement('p');
  target.className = 'frame-target';
  index.className = 'frame-target__index';
  index.textContent = `Target ${String(targetCount)}`;
  heading.textContent = `Dynamic target ${String(targetCount)}`;
  description.textContent = 'The parent added this node to the child source root; its child observer will synchronize.';
  target.append(index, heading, description);
  context.sourceRoot.append(target);
  status.textContent = `Added Dynamic target ${String(targetCount)} to Child document #${String(context.generation)}. Tracker will observe the mutation automatically.`;
}

/**
 * Unmounts the old child context before navigating to the next deterministic generation.
 *
 * @returns {void}
 */
function navigateFrame() {
  if (!tracker.mounted || activeDocument === null || activeGeneration === null) {
    status.textContent = 'Wait for the current child document before navigating.';
    return;
  }

  const previousGeneration = activeGeneration;
  const replacementGeneration = nextDocumentGeneration;
  nextDocumentGeneration += 1;
  recordLifecycle(
    `Navigation requested from Child document #${String(previousGeneration)} to #${String(replacementGeneration)}.`,
    'navigation-requested',
    replacementGeneration,
  );
  tracker.unmount();
  recordLifecycle(
    `Tracker unmounted from Child document #${String(previousGeneration)} before navigation.`,
    'tracker-unmounted',
    previousGeneration,
  );

  activeDocument = null;
  activeGeneration = null;
  targetCount = 0;
  setControlsEnabled(false);
  updateMountContext(null, replacementGeneration);
  status.textContent = `Tracker unmounted. Waiting for Child document #${String(replacementGeneration)}.`;

  const url = new URL('./child.html', window.location.href);
  url.searchParams.set('generation', String(replacementGeneration));
  frame.src = url.href;
  recordLifecycle(
    `Iframe navigation started for Child document #${String(replacementGeneration)} after unmount.`,
    'iframe-navigation-started',
    replacementGeneration,
  );
}

/** Owns parent DOM listeners for deterministic final cleanup. */
const lifecycle = new AbortController();

/**
 * Performs terminal parent-page cleanup after all reusable child mount cycles finish.
 *
 * @returns {void}
 */
function destroyScenario() {
  lifecycle.abort();
  unsubscribeActivation();
  tracker.destroy();
}

recordLifecycle('Parent Tracker instance #1 created.', 'tracker-created', 0);
addTargetButton.addEventListener('click', addFrameTarget, { signal: lifecycle.signal });
frame.addEventListener('load', mountCurrentFrame, { signal: lifecycle.signal });
navigateButton.addEventListener('click', navigateFrame, { signal: lifecycle.signal });

if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.location.href !== 'about:blank') {
  mountCurrentFrame();
}

window.addEventListener('pagehide', destroyScenario, { once: true });
