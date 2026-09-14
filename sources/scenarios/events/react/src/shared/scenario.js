/** Public runtime events displayed by the integration scenarios. */
const EVENT_NAMES = [
  'marker:activate',
  'cluster:activate',
  'track:activate',
  'selection:change',
  'sync:start',
  'sync:end',
  'warning',
  'destroy',
];
/** Prefix used to isolate intentional demo failures from unexpected page errors. */
const INTENTIONAL_ERROR_PREFIX = 'Intentional demo';

/**
 * Returns a compact readable representation of a structured render reason.
 *
 * @param {unknown} reason Public synchronization reason.
 * @returns {string} Human-readable leaf sources.
 */
function summarizeReason(reason) {
  if (typeof reason === 'string') {
    return reason;
  }
  if (reason === null || typeof reason !== 'object') {
    return String(reason);
  }
  if (Array.isArray(reason.reasons)) {
    return reason.reasons.map(summarizeReason).join(' + ');
  }
  return reason.source ?? reason.type ?? 'structured reason';
}

/**
 * Returns true only when every leaf in a structured reason is a scroll source.
 *
 * @param {unknown} reason Public synchronization reason.
 * @returns {boolean} Whether the reason represents a scroll-only transaction.
 */
function isScrollOnlyReason(reason) {
  if (reason === null || typeof reason !== 'object') {
    return false;
  }
  if (reason.source !== undefined) {
    return reason.source === 'scroll';
  }
  return Array.isArray(reason.reasons) && reason.reasons.length > 0 && reason.reasons.every(isScrollOnlyReason);
}

/**
 * Summarizes diagnostic details without retaining platform object graphs.
 *
 * @param {unknown} details Borrowed diagnostic details.
 * @returns {string} Compact detail fields.
 */
function summarizeDetails(details) {
  if (details === null || details === undefined) {
    return 'none';
  }
  if (typeof details !== 'object') {
    return String(details);
  }
  return Object.entries(details)
    .slice(0, 4)
    .map(
      ([key, value]) => `${key}=${typeof value === 'object' ? (value?.constructor?.name ?? 'object') : String(value)}`,
    )
    .join(', ');
}

/**
 * Returns the educational payload summary for one public runtime event.
 *
 * @param {string} eventName Public event name.
 * @param {any} payload Public event payload.
 * @returns {string} Compact payload summary.
 */
function summarizeEvent(eventName, payload) {
  const sourceType = payload?.sourceEvent?.type ?? 'none';
  switch (eventName) {
    case 'marker:activate':
      return `key=${payload.key}; selector=${payload.selector}; rule=${String(payload.ruleIndex)}; label=${payload.label ?? 'none'}; source=${sourceType}`;
    case 'cluster:activate':
      return `key=${payload.key}; count=${String(payload.count)}; primary=${payload.primaryMarker?.label ?? payload.primaryMarker?.key ?? 'none'}; markers=${payload.markers?.map(({ key }) => key).join(',') ?? 'none'}; source=${sourceType}`;
    case 'track:activate':
      return `position=${payload.position === null ? 'unavailable' : Number(payload.position).toFixed(2)}%; source=${sourceType}`;
    case 'selection:change':
      return `previous=${payload.previousKey ?? 'none'}; selected=${payload.selectedKey ?? 'none'}`;
    case 'sync:start':
      return `reason=${summarizeReason(payload.reason)}; scheduled=${String(payload.scheduled)}; timestamp=${payload.timestamp ?? 'disabled'}`;
    case 'sync:end':
      return `markers=${String(payload.markersCount)}; clusters=${String(payload.clustersCount)}; duration=${payload.duration ?? 'disabled'}`;
    case 'warning':
      return `code=${payload.code}; message=${payload.message}; details=${summarizeDetails(payload.details)}`;
    case 'destroy':
      return 'runtime destroyed';
    default:
      return 'public payload received';
  }
}

/**
 * Escapes a trusted code sample before inserting it into static demo markup.
 *
 * @param {string} value Source snippet.
 * @returns {string} HTML-safe source text.
 */
function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Creates the shared Runtime Events document and integration-neutral UI bridge.
 *
 * @param {object} configuration Scenario presentation.
 * @param {string} configuration.integration Integration name.
 * @param {string} configuration.eventApi Visible integration API snippet.
 * @param {string} configuration.lifecycle Lifecycle explanation.
 * @param {Array<{action: string, label: string}>} configuration.lifecycleActions Lifecycle controls.
 * @param {string} configuration.binding Subscription/binding explanation.
 * @param {boolean} [configuration.bindingExperiment] Whether the integration has an interactive experiment.
 * @returns Shared elements and presentation operations used by one integration. The concrete
 * structure remains inferred so TypeScript framework consumers retain its exact contract.
 */
function createEventScenario({
  integration,
  eventApi,
  lifecycle,
  lifecycleActions,
  binding,
  bindingExperiment = false,
}) {
  const root = document.querySelector('#event-scenario');
  if (!(root instanceof HTMLElement)) {
    throw new Error('Runtime events scenario root is missing.');
  }
  root.classList.add('event-demo');
  const lifecycleButtons = lifecycleActions
    .map(({ action, label }) => `<button type="button" data-event-action="${action}">${label}</button>`)
    .join('');
  const bindingControl = bindingExperiment
    ? '<div class="event-actions"><button type="button" data-event-action="binding-experiment" disabled>Run binding experiment</button></div><ol id="binding-log" class="event-log-list" aria-live="polite"></ol>'
    : '<p class="event-note">This framework deliberately exposes no imperative subscription experiment.</p>';

  root.innerHTML = `
    <header class="demo-page__intro event-demo__intro"><p class="event-demo__eyebrow">Public runtime event model</p><h1>Runtime events — ${integration}</h1><p>Create the integration explicitly, trigger real Tracker behavior, and compare runtime events with application errors.</p></header>
    <section class="event-panel event-panel--lifecycle" aria-labelledby="lifecycle-title"><h2 id="lifecycle-title">Lifecycle</h2><p>${lifecycle}</p><div class="event-actions">${lifecycleButtons}</div><p id="runtime-state" class="event-state" role="status">Runtime absent. The fixture exists, but Tracker has not been created.</p></section>
    <section class="event-panel" aria-labelledby="event-api-title"><h2 id="event-api-title">Integration event API</h2><pre><code>${escapeHtml(eventApi)}</code></pre></section>
    <section class="event-panel" aria-labelledby="trigger-title"><h2 id="trigger-title">What produces each event?</h2><div class="event-table-wrap"><table><thead><tr><th>Event</th><th>Trigger in this scenario</th></tr></thead><tbody>
      <tr><td><code>marker:activate</code></td><td>Activate an individual marker with pointer or keyboard.</td></tr>
      <tr><td><code>cluster:activate</code></td><td>Activate the grouped marker for the adjacent cluster headings.</td></tr>
      <tr><td><code>track:activate</code></td><td>Activate empty rail space.</td></tr>
      <tr><td><code>selection:change</code></td><td>Change the selected marker; selection is not activation.</td></tr>
      <tr><td><code>sync:start</code> / <code>sync:end</code></td><td>Use a synchronization action, mutate the fixture, or scroll.</td></tr>
      <tr><td><code>warning</code></td><td>Temporarily resolve the mutation observer target list to empty; the demo restores the normal target automatically.</td></tr>
      <tr><td><code>destroy</code></td><td>Only integrations that publicly deliver this event show it. Framework adapters expose completion instead.</td></tr>
    </tbody></table></div></section>
    <section class="event-panel" aria-labelledby="actions-title"><h2 id="actions-title">Synchronization and diagnostics</h2><div class="event-experiments">
      <div><h3>Immediate synchronization</h3><p>Calls this integration's immediate API. It requests <code>public-render</code> through the scheduler and flushes it before returning.</p><button type="button" data-event-action="immediate" disabled>Synchronize now</button></div>
      <div><h3>Scheduled synchronization</h3><p>Calls this integration's coalesced API. Expected: a later <code>request-render</code> transaction with <code>scheduled=true</code>.</p><button type="button" data-event-action="scheduled" disabled>Request synchronization</button></div>
      <div><h3>Observer-driven mutation</h3><p>Mutates tracked DOM. MutationObserver requests a <code>sync:start</code> → <code>sync:end</code> transaction.</p><button type="button" data-event-action="mutation" disabled>Mutate tracked DOM</button></div>
    </div><div class="event-actions event-actions--warning"><button type="button" data-event-action="warning" disabled>Trigger observer warning</button></div><div class="event-sync-activity" aria-labelledby="scroll-activity-title"><h3 id="scroll-activity-title">Scroll synchronization</h3><p>Scroll-only transactions are aggregated here. Transactions with any additional reason remain in the detailed timeline.</p><dl><div><dt>Transactions</dt><dd><output id="scroll-sync-count">0</output></dd></div><div><dt>Last reason</dt><dd><output id="scroll-sync-source">none</output></dd></div><div><dt>Last result</dt><dd><output id="scroll-sync-result">none</output></dd></div></dl></div></section>
    <section class="event-panel" aria-labelledby="fixture-title"><h2 id="fixture-title">Interactive tracked content</h2><p>Use the rail with pointer or keyboard after creating the runtime.</p><div id="framework-tracker-host" class="event-demo__tracker-host"></div><div id="event-fixture" class="event-fixture">
      <article class="event-fixture__section event-fixture__section--first"><h3 class="event-target event-target--normal">Independent checkpoint</h3><p>This heading produces a normal unclustered marker.</p></article>
      <article class="event-fixture__section event-fixture__section--cluster"><h3 class="event-target event-target--cluster">Cluster item Alpha</h3><h3 class="event-target event-target--cluster">Cluster item Beta</h3><p>The adjacent headings form a real cluster.</p></article>
      <article class="event-fixture__section event-fixture__section--mutable"><h3 class="event-target event-target--mutable">Mutable observer checkpoint</h3><div id="event-mutation-zone"></div></article>
      <article class="event-fixture__section event-fixture__section--last"><h3 class="event-target event-target--normal">Final checkpoint</h3><p>Blank rail space remains available for track activation.</p></article>
    </div></section>
    <section class="event-panel" aria-labelledby="timeline-title"><h2 id="timeline-title">Chronological timeline</h2><p>One global sequence covers lifecycle actions, real Tracker events, and destruction observation. New records appear at the bottom.</p><div class="event-table-wrap"><table><thead><tr><th>#</th><th>Type</th><th>Record</th><th>Details / source</th></tr></thead><tbody id="event-timeline"></tbody></table></div></section>
    <section class="event-panel" aria-labelledby="failures-title"><h2 id="failures-title">Consumer <code>sync:end</code> failures</h2><p>Each action requests one real immediate synchronization. Its consumer <code>sync:end</code> handler then fails without scrolling the page. The failure belongs to the application or framework, not Tracker diagnostics.</p><div class="event-actions"><button type="button" data-event-action="sync-error" disabled>Trigger synchronous handler error</button><button type="button" data-event-action="async-error" disabled>Trigger asynchronous handler rejection</button></div><p>Experiment state: <output id="failure-state" class="event-state" aria-live="polite">Operational — no failure pending</output></p><p class="event-error-total">Tracker <code>stats.errors.total</code>: <output id="tracker-error-total">unavailable</output></p><ol id="application-error-log" class="event-log-list" aria-live="polite"></ol></section>
    <section class="event-panel" aria-labelledby="binding-title"><h2 id="binding-title">Subscription / binding semantics</h2><p>${binding}</p>${bindingControl}</section>
    <details class="event-panel"><summary>Full runtime statistics</summary><pre id="runtime-stats">Runtime unavailable</pre></details>`;

  let sequence = 0;
  let armedFailure = null;
  let scrollSyncPending = false;
  let scrollSyncCount = 0;
  const actions = new Map();
  const timeline = requireScenarioElement(root, '#event-timeline');
  const applicationErrorLog = requireScenarioElement(root, '#application-error-log');
  const bindingLog = root.querySelector('#binding-log');
  const stats = requireScenarioElement(root, '#runtime-stats');
  const errorTotal = requireScenarioElement(root, '#tracker-error-total');
  const failureState = requireScenarioElement(root, '#failure-state');
  const runtimeState = requireScenarioElement(root, '#runtime-state');
  const scrollCount = requireScenarioElement(root, '#scroll-sync-count');
  const scrollSource = requireScenarioElement(root, '#scroll-sync-source');
  const scrollResult = requireScenarioElement(root, '#scroll-sync-result');
  const fixture = requireScenarioElement(root, '#event-fixture');
  const trackerHost = requireScenarioElement(root, '#framework-tracker-host');
  const mutationZone = requireScenarioElement(root, '#event-mutation-zone');

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-event-action]') : null;
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }
    const action = button.dataset.eventAction;
    actions.get(action)?.();
  });

  /** Appends one typed record to the page-session timeline. */
  function addTimelineRecord(type, record, details = '') {
    sequence += 1;
    const row = document.createElement('tr');
    row.dataset.recordType = type.toLowerCase();
    row.innerHTML = `<td>${String(sequence)}</td><td><strong></strong></td><td></td><td></td>`;
    row.children[1].textContent = type;
    row.children[2].textContent = record;
    row.children[3].textContent = details;
    timeline.append(row);
    return row;
  }

  return {
    EVENT_NAMES,
    fixture,
    mutationZone,
    trackerHost,
    addApplicationError: (message) => addListEntry(applicationErrorLog, message),
    addBindingEntry: (message) => {
      if (bindingLog instanceof HTMLOListElement) {
        addListEntry(bindingLog, message);
      }
    },
    addBoundary: (message) => addTimelineRecord('BOUNDARY', message),
    addCompletion: (message, details) => addTimelineRecord('COMPLETION', message, details),
    addLifecycle: (message, details) => addTimelineRecord('LIFECYCLE', message, details),
    armFailure: (failure) => {
      armedFailure = failure;
      const label = failure === 'sync' ? 'synchronous' : 'asynchronous';
      failureState.textContent = `Running — next sync:end consumer will produce an ${label} failure`;
    },
    consumeArmedFailure: () => {
      const failure = armedFailure;
      armedFailure = null;
      if (failure !== null) {
        const label = failure === 'sync' ? 'synchronous' : 'asynchronous';
        failureState.textContent = `Consumed — ${label} failure delivered; runtime remains operational`;
      }
      return failure;
    },
    logEvent: (eventName, payload, source) => {
      if (eventName === 'sync:start') {
        scrollSyncPending = isScrollOnlyReason(payload?.reason);
        if (scrollSyncPending) {
          scrollSource.textContent = summarizeReason(payload.reason);
          return;
        }
      }
      if (eventName === 'sync:end' && scrollSyncPending) {
        scrollSyncPending = false;
        scrollSyncCount += 1;
        scrollCount.textContent = String(scrollSyncCount);
        scrollResult.textContent = summarizeEvent(eventName, payload);
        return;
      }
      const row = addTimelineRecord('EVENT', eventName, `${summarizeEvent(eventName, payload)}; via ${source}`);
      row.dataset.eventName = eventName;
    },
    onAction: (name, handler) => actions.set(name, handler),
    resetFailureOnTeardown: () => {
      armedFailure = null;
      failureState.textContent = 'Operational — teardown cleared any pending failure';
    },
    setActionEnabled: (name, enabled) => {
      const button = root.querySelector(`[data-event-action="${name}"]`);
      if (button instanceof HTMLButtonElement) {
        button.disabled = !enabled;
      }
    },
    setRuntimeAvailable: (available, message) => {
      runtimeState.textContent = message;
      for (const name of ['immediate', 'scheduled', 'mutation', 'warning', 'sync-error', 'async-error']) {
        const button = root.querySelector(`[data-event-action="${name}"]`);
        if (button instanceof HTMLButtonElement) {
          button.disabled = !available;
        }
      }
      const bindingButton = root.querySelector('[data-event-action="binding-experiment"]');
      if (bindingButton instanceof HTMLButtonElement) {
        bindingButton.disabled = !available;
      }
    },
    updateStats: (value) => {
      if (value === null) {
        stats.textContent = 'Runtime unavailable';
        errorTotal.textContent = 'unavailable';
        return;
      }
      errorTotal.textContent = String(value.errors.total);
      stats.textContent = JSON.stringify(
        {
          clusters: value.clusters,
          errors: value.errors,
          markers: value.markers,
          renders: value.renders,
          warnings: value.warnings,
          debug: value.debug,
        },
        null,
        2,
      );
    },
  };
}

/**
 * Returns one required element owned by the generated Runtime Events document.
 *
 * @param {HTMLElement} root Scenario root.
 * @param {string} selector Required selector.
 * @returns {HTMLElement} Matching element.
 */
function requireScenarioElement(root, selector) {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Runtime events scenario element is missing: ${selector}`);
  }
  return element;
}

/**
 * Appends one chronological text entry to a visible list.
 *
 * @param {HTMLElement} list Destination list.
 * @param {string} message Entry text.
 */
function addListEntry(list, message) {
  const item = document.createElement('li');
  item.textContent = message;
  list.append(item);
}

/**
 * Captures only intentional demo failures from browser-global error channels.
 *
 * @param {(message: string) => void} addError Visible error recorder.
 * @returns {() => void} Listener cleanup operation.
 */
function installIntentionalErrorCapture(addError) {
  const onError = (event) => {
    const error = event.error ?? event.message;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith(INTENTIONAL_ERROR_PREFIX)) {
      return;
    }
    event.preventDefault();
    addError(`window.error: ${message}`);
  };
  const onRejection = (event) => {
    const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
    if (!message.startsWith(INTENTIONAL_ERROR_PREFIX)) {
      return;
    }
    event.preventDefault();
    addError(`unhandledrejection: ${message}`);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * Creates deterministic options shared by all Runtime Events integrations.
 *
 * @param {object} [overrides] Top-level option replacements.
 * @returns {object} Public Tracker options.
 */
function createEventOptions(overrides = {}) {
  return {
    a11y: { enabled: true, keyboard: true, label: 'Runtime events demo tracker' },
    clustering: { enabled: true, threshold: 4 },
    diagnostics: { metrics: true, warnings: true },
    updates: {
      interval: { enabled: false },
      mutation: { debounce: 0, enabled: true },
      resize: { debounce: 0, enabled: true },
      scroll: { enabled: true },
    },
    ...overrides,
  };
}

/**
 * Creates the deterministic rules used by the shared event fixture.
 *
 * @returns {Array<object>} Public Tracker rules.
 */
function createEventRules() {
  return [
    { selector: '.event-target--normal', label: (element) => element.textContent?.trim() ?? null },
    { selector: '.event-target--cluster', label: (element) => element.textContent?.trim() ?? null },
    { selector: '.event-target--mutable', label: (element) => element.textContent?.trim() ?? null },
  ];
}

export { EVENT_NAMES, createEventOptions, createEventRules, createEventScenario, installIntentionalErrorCapture };
