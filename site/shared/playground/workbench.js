import { assertValidTrackerConfiguration } from '@rightxt/tracker-core';

/** Stable number of long-form fixture sections. */
const INITIAL_SECTION_COUNT = 14;

/** One-based sections receiving the initial Rule A textarea targets. */
const INITIAL_RULE_A_SECTIONS = Object.freeze([2, 3, 7, 12]);

/** One-based sections receiving the initial Rule B textarea targets. */
const INITIAL_RULE_B_SECTIONS = Object.freeze([2, 5, 9, 10]);

/** Maximum retained public event telemetry entries. */
const EVENT_LOG_LIMIT = 24;

/** Repeated copy that keeps the fixture long enough for geometry experiments. */
const FILLER_TEXT =
  'Use the workbench to combine content mutations, public rules, Tracker options, styling, and update sources. ' +
  'The rail should remain consistent after every operation.';

/** Browser-native selector suggestions backed by the real fixture DOM. */
const SELECTOR_SUGGESTIONS = Object.freeze([
  '.demo-primary',
  '.demo-secondary',
  'textarea',
  'textarea[required]',
  'textarea:not([required])',
  'textarea:required',
  'textarea:optional',
  'textarea:invalid',
  'textarea:valid',
  'textarea[data-state="active"]',
  'textarea[data-state="inactive"]',
  '.demo-primary:invalid',
  '.demo-primary:valid',
  '.demo-secondary:invalid',
  '.demo-secondary:valid',
  'input:checked',
  '.demo-text-probe',
]);

/** Stable visible identity prefixes for application-owned target categories. */
const TARGET_CATEGORY_PREFIXES = Object.freeze({ primary: 'P', secondary: 'S' });

/** User-facing category names for generated textarea sources. */
const TARGET_CATEGORY_LABELS = Object.freeze({ primary: 'Primary', secondary: 'Secondary' });

/** Complete public root CSS-variable catalog grouped for progressive disclosure. */
const ROOT_VARIABLE_GROUPS = Object.freeze([
  Object.freeze({
    title: 'Track',
    names: Object.freeze([
      '--rxtt-track-thickness',
      '--rxtt-track-offset',
      '--rxtt-track-start',
      '--rxtt-track-end',
      '--rxtt-track-bg',
      '--rxtt-track-border-color',
      '--rxtt-track-border-style',
      '--rxtt-track-border-width',
      '--rxtt-track-z-index',
      '--rxtt-track-overflow',
      '--rxtt-track-contain',
    ]),
  }),
  Object.freeze({ title: 'Viewport', names: Object.freeze(['--rxtt-viewport-bg']) }),
  Object.freeze({
    title: 'Markers',
    names: Object.freeze([
      '--rxtt-marker-min-size',
      '--rxtt-marker-bg',
      '--rxtt-marker-ring-color',
      '--rxtt-marker-ring-width',
      '--rxtt-marker-border-color',
      '--rxtt-marker-border-style',
      '--rxtt-marker-border-width',
      '--rxtt-marker-border-radius',
      '--rxtt-marker-hover-ring-color',
      '--rxtt-marker-hover-ring-width',
      '--rxtt-marker-selected-ring-color',
      '--rxtt-marker-selected-ring-width',
      '--rxtt-marker-opacity',
    ]),
  }),
  Object.freeze({
    title: 'Clusters',
    names: Object.freeze([
      '--rxtt-cluster-bg',
      '--rxtt-cluster-font-size',
      '--rxtt-cluster-text-color',
      '--rxtt-cluster-content',
    ]),
  }),
  Object.freeze({
    title: 'Focus',
    names: Object.freeze([
      '--rxtt-focus-outline-color',
      '--rxtt-focus-outline-offset',
      '--rxtt-focus-outline-style',
      '--rxtt-focus-outline-width',
    ]),
  }),
]);

/** Public CSS variables accepted by rule marker scope. */
const RULE_VARIABLE_GROUPS = Object.freeze([ROOT_VARIABLE_GROUPS[2], ROOT_VARIABLE_GROUPS[3]]);

/** Initial explicit root overrides preserving the playground's representative theme. */
const INITIAL_ROOT_VARIABLES = Object.freeze({
  '--rxtt-marker-border-radius': '0px',
  '--rxtt-marker-min-size': '2px',
  '--rxtt-marker-opacity': '1',
  '--rxtt-marker-ring-width': '1px',
  '--rxtt-track-bg': '#f8f9fa',
  '--rxtt-track-end': '0px',
  '--rxtt-track-offset': '0px',
  '--rxtt-track-start': '0px',
  '--rxtt-track-thickness': '1rem',
  '--rxtt-track-z-index': '1000',
  '--rxtt-cluster-bg': '#dc3545',
  '--rxtt-cluster-font-size': '10px',
  '--rxtt-cluster-text-color': '#ffffff',
});

/** Initial marker-color overrides owned by stable Rule A and Rule B identities. */
const INITIAL_RULE_VARIABLES = Object.freeze({
  a: Object.freeze({ '--rxtt-marker-bg': '#0d6efd' }),
  b: Object.freeze({ '--rxtt-marker-bg': '#6f42c1' }),
});

/** Stylesheet fallbacks shown without creating explicit overrides. */
const VARIABLE_HINTS = Object.freeze({
  '--rxtt-cluster-content': 'attr(data-rxtt-count)',
});

/**
 * Creates an HTML element with optional class and text.
 * @param {string} tagName - Element tag name.
 * @param {string} [className] - Optional class list.
 * @param {string} [text] - Optional text content.
 * @returns {HTMLElement} Created element.
 */
function createElement(tagName, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
}

/**
 * Creates an accessible push button.
 * @param {string} label - Visible action label.
 * @param {() => unknown} onClick - Activation callback.
 * @param {Record<string, string>} [attributes] - Additional button attributes.
 * @returns {HTMLButtonElement} Configured button.
 */
function createButton(label, onClick, attributes = {}) {
  const button = createElement('button', '', label);
  button.type = 'button';
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, value);
  }
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Creates one labeled checkbox row.
 * @param {string} labelText - Visible control label.
 * @param {boolean} checked - Initial checked state.
 * @param {(checked: boolean) => void} onChange - Committed-state callback.
 * @param {Record<string, string>} [attributes] - Additional input attributes.
 * @returns {{ input: HTMLInputElement, label: HTMLLabelElement }} Row elements.
 */
function createCheckbox(labelText, checked, onChange, attributes = {}) {
  const label = createElement('label', 'workbench-row workbench-row--checkbox');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  for (const [name, value] of Object.entries(attributes)) {
    input.setAttribute(name, value);
  }
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, document.createTextNode(labelText));
  return { input, label };
}

/**
 * Creates one labeled text or number input row.
 * @param {string} labelText - Visible control label.
 * @param {string} type - Native input type.
 * @param {string | number} initialValue - Initial input value.
 * @param {(value: string) => void} onChange - Committed-value callback.
 * @param {Record<string, string>} [attributes] - Additional input attributes.
 * @returns {{ input: HTMLInputElement, label: HTMLLabelElement }} Row elements.
 */
function createInput(labelText, type, initialValue, onChange, attributes = {}) {
  const label = createElement('label', 'workbench-row');
  const input = document.createElement('input');
  input.type = type;
  input.value = String(initialValue);
  for (const [name, value] of Object.entries(attributes)) {
    input.setAttribute(name, value);
  }
  input.addEventListener('change', () => onChange(input.value));
  label.append(document.createTextNode(labelText), input);
  return { input, label };
}

/**
 * Creates one labeled select row.
 * @param {string} labelText - Visible control label.
 * @param {ReadonlyArray<{ label: string, value: string }>} options - Native option definitions.
 * @param {string} initialValue - Initially selected value.
 * @param {(value: string) => void} onChange - Selection callback.
 * @param {Record<string, string>} [attributes] - Additional select attributes.
 * @returns {{ label: HTMLLabelElement, select: HTMLSelectElement }} Row elements.
 */
function createSelect(labelText, options, initialValue, onChange, attributes = {}) {
  const label = createElement('label', 'workbench-row');
  const select = document.createElement('select');
  for (const option of options) {
    const optionElement = createElement('option', '', option.label);
    optionElement.value = option.value;
    select.append(optionElement);
  }
  select.value = initialValue;
  for (const [name, value] of Object.entries(attributes)) {
    select.setAttribute(name, value);
  }
  select.addEventListener('change', () => onChange(select.value));
  label.append(document.createTextNode(labelText), select);
  return { label, select };
}

/**
 * Creates one top-level progressive-disclosure panel.
 * @param {string} title - Summary label.
 * @param {boolean} open - Initial disclosure state.
 * @returns {{ body: HTMLDivElement, details: HTMLDetailsElement }} Panel elements.
 */
function createPanel(title, open) {
  const details = createElement('details', 'workbench-panel');
  const body = createElement('div', 'workbench-panel__body');
  details.open = open;
  details.append(createElement('summary', '', title), body);
  return { body, details };
}

/**
 * Creates a compact semantic control group.
 * @param {string} title - Fieldset legend.
 * @returns {HTMLFieldSetElement} Group element.
 */
function createGroup(title) {
  const fieldset = createElement('fieldset', 'workbench-group');
  fieldset.append(createElement('legend', '', title));
  return fieldset;
}

/**
 * Recursively merges an accepted option patch into playground-owned state.
 * @param {Record<string, unknown>} base - Previously committed state.
 * @param {Record<string, unknown>} patch - Core-accepted patch.
 * @returns {Record<string, unknown>} Detached merged state.
 */
function mergeOptions(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
        ? mergeOptions(current, value)
        : value;
  }
  return result;
}

/**
 * Parses compact semicolon-separated marker attributes.
 * @param {string} value - Entries in `name=value` form.
 * @returns {Record<string, string>} Marker attribute map.
 * @throws {Error} When a non-empty entry omits its separator.
 */
function parseAttributes(value) {
  const attributes = {};
  for (const entry of value.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Attribute "${trimmed}" must use name=value syntax.`);
    }
    attributes[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return attributes;
}

/**
 * Produces a retention-safe scalar-only telemetry summary.
 * @param {unknown} payload - Public event payload.
 * @returns {string} Bounded readable summary without DOM references.
 */
function summarizePayload(payload) {
  if (payload === null || typeof payload !== 'object') {
    return payload === undefined ? '' : String(payload);
  }
  return Object.entries(payload)
    .filter(([, value]) => ['boolean', 'number', 'string'].includes(typeof value))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
    .slice(0, 140);
}

/**
 * Initializes the isolated workbench. The bridge is demo infrastructure rather
 * than an additional RXT Tracker API; `main.js` exposes the real method mapping.
 * @param {{
 *   commitConfiguration: (configuration: { options: object, rules: object[] }) => void,
 *   getStats: () => object,
 *   renderNow: () => void,
 *   requestRender: () => void,
 *   resetStats: () => void,
 * }} api - Demo-only bridge to one integration's real configuration and command surfaces.
 * @returns {{
 *   getInitialConfiguration: () => { options: object, rules: object[] },
 *   handleEvent: (eventName: string, payload: unknown) => void,
 *   start: () => void,
 * }} Workbench startup and event-transport interface.
 */
function createPlaygroundWorkbench(api) {
  const controls = document.querySelector('#playground-workbench-controls');
  const content = document.querySelector('#playground-workbench-content');
  const layout = document.querySelector('.playground-workbench__layout');
  if (!(controls instanceof HTMLElement) || !(content instanceof HTMLElement) || !(layout instanceof HTMLElement)) {
    throw new Error('Playground workbench hosts are missing.');
  }

  /** Playground-owned committed state; Core remains authoritative for accepted option semantics. */
  const state = {
    applicationFormInvalidation: false,
    burstCounter: 0,
    documentOverflowAxis: 'vertical',
    categoryCounters: { primary: 0, secondary: 0 },
    rootVariables: { ...INITIAL_ROOT_VARIABLES },
    rules: {
      a: {
        enabled: true,
        hooks: { attributes: '', className: '' },
        selector: '.demo-primary',
        variables: { ...INITIAL_RULE_VARIABLES.a },
      },
      b: {
        enabled: true,
        hooks: { attributes: '', className: '' },
        selector: '.demo-secondary',
        variables: { ...INITIAL_RULE_VARIABLES.b },
      },
      focus: false,
      labelMode: 'none',
      nativeTitle: true,
      scroll: true,
      scrollAlign: 'start',
      scrollBehavior: 'auto',
      selectedStyle: 'a',
    },
    options: {
      a11y: { enabled: false, keyboard: false, label: 'Page tracker' },
      clustering: { enabled: true, threshold: 2 },
      diagnostics: { metrics: false, warnings: true },
      interaction: { activation: true, drag: false },
      orientation: 'vertical',
      placement: 'left',
      updates: {
        interval: { delay: 1000, enabled: false },
        mutation: {
          debounce: 100,
          enabled: true,
          options: { attributes: false, characterData: false, childList: true, subtree: true },
        },
        resize: { debounce: 50, enabled: true },
        scroll: { enabled: true },
      },
      viewport: { enabled: true },
    },
    sections: [],
    targetSerial: 0,
    targets: [],
    probes: { checkbox: null, textElement: null, textNode: null },
    resizeTargetsDirty: false,
    textRevision: 0,
  };
  const mutationTargets = () => [content];
  const textRuleLabel = (element) => {
    if (element instanceof HTMLTextAreaElement) {
      return element.value.trim() || element.getAttribute('aria-label');
    }
    return element.textContent?.trim() || element.getAttribute('aria-label');
  };
  let resizeTargets = () => [content, ...state.targets.map(({ element }) => element)];

  const configurationOutput = createElement('pre', 'runtime-json');
  configurationOutput.dataset.inspector = 'configuration';
  const counts = createElement('p', 'fixture-counts');
  const cssStatus = createElement('p', 'workbench-status');
  const eventLog = createElement('div', 'runtime-log');
  eventLog.dataset.inspector = 'events';
  const fixtureStatus = createElement('p', 'workbench-status');
  const checkboxStatus = createElement('output', 'fixture-probe-status');
  const characterDataStatus = createElement('output', 'fixture-probe-status');
  const targetList = createElement('ol', 'fixture-target-list');
  const optionStatus = createElement('p', 'workbench-status');
  const rawStatsOutput = createElement('pre', 'runtime-json');
  rawStatsOutput.dataset.inspector = 'raw-stats';
  const ruleStatus = createElement('p', 'workbench-status');
  for (const status of [cssStatus, fixtureStatus, optionStatus, ruleStatus]) {
    status.setAttribute('role', 'status');
  }
  const runtimeValues = {};
  let rebuildRuleStyleControls = () => {};
  let observingRuntime = false;
  let syncEnds = 0;
  let syncStarts = 0;

  /** Docks controls at a deterministic physical edge for committed document and Tracker geometry. */
  function syncControlsEdge() {
    let edge = 'right';

    if (state.documentOverflowAxis === 'horizontal') {
      edge = state.options.orientation === 'horizontal' && state.options.placement === 'bottom' ? 'top' : 'bottom';
    } else if (state.options.orientation === 'vertical' && state.options.placement === 'right') {
      edge = 'left';
    }

    layout.dataset.controlsEdge = edge;
  }

  /**
   * Resolves the shared public label value.
   * @param {'a' | 'b'} key - Stable rule identity.
   * @param {object} [ruleCollection] - Candidate or committed rule state.
   * @returns {string | ((element: Element) => string | null) | null} Public label option.
   */
  function createRuleLabel(key, ruleCollection = state.rules) {
    if (ruleCollection.labelMode === 'static') {
      return `Tracked Rule ${key.toUpperCase()}`;
    }
    if (ruleCollection.labelMode === 'text') {
      return textRuleLabel;
    }
    return null;
  }

  /**
   * Builds one public rule from a stable playground identity.
   * @param {'a' | 'b'} key - Stable rule identity.
   * @param {object} [ruleState] - Candidate or committed rule definition.
   * @param {object} [ruleCollection] - Candidate or committed shared rule state.
   * @returns {object} Public Tracker rule.
   */
  function buildRule(key, ruleState = state.rules[key], ruleCollection = state.rules) {
    return {
      selector: ruleState.selector,
      label: createRuleLabel(key, ruleCollection),
      marker: {
        attributes: { ...parseAttributes(ruleState.hooks.attributes), 'data-playground-rule': key },
        className: ruleState.hooks.className.trim(),
        cssVariables: { ...ruleState.variables },
        title: ruleCollection.nativeTitle,
      },
      scroll: {
        align: ruleCollection.scrollAlign,
        behavior: ruleCollection.scrollBehavior,
        enabled: ruleCollection.scroll,
        target: 'self',
      },
      focus: { enabled: ruleCollection.focus, target: 'self' },
    };
  }

  /**
   * Builds the ordered public rules list.
   * @param {object} [candidateRules] - Candidate or committed rule state.
   * @returns {object[]} Ordered public rules.
   */
  function buildRules(candidateRules = state.rules) {
    return ['a', 'b']
      .filter((key) => candidateRules[key].enabled)
      .map((key) => buildRule(key, candidateRules[key], candidateRules));
  }

  /**
   * Builds complete public options with demo-owned observer resolvers.
   * @param {object} [optionState] - Candidate or committed option state.
   * @param {Record<string, string>} [rootVariables] - Candidate or committed root variables.
   * @returns {object} Public Tracker options.
   */
  function buildOptions(optionState = state.options, rootVariables = state.rootVariables) {
    return {
      ...optionState,
      cssVariables: { ...rootVariables },
      updates: {
        ...optionState.updates,
        mutation: { ...optionState.updates.mutation, targets: mutationTargets },
        resize: { ...optionState.updates.resize, targets: resizeTargets },
      },
    };
  }

  /**
   * Builds and validates one complete public configuration.
   * @param {object} [optionState] - Candidate or committed option state.
   * @param {object} [ruleState] - Candidate or committed rule state.
   * @param {Record<string, string>} [rootVariables] - Candidate or committed root variables.
   */
  function createConfiguration(
    optionState = state.options,
    ruleState = state.rules,
    rootVariables = state.rootVariables,
  ) {
    const configuration = {
      options: buildOptions(optionState, rootVariables),
      rules: buildRules(ruleState),
    };
    assertValidTrackerConfiguration(configuration);
    return configuration;
  }

  /**
   * Preflights and commits one complete configuration through the integration bridge.
   * @param {object} [optionState] - Candidate or committed option state.
   * @param {object} [ruleState] - Candidate or committed rule state.
   * @param {Record<string, string>} [rootVariables] - Candidate or committed root variables.
   */
  function commitConfiguration(
    optionState = state.options,
    ruleState = state.rules,
    rootVariables = state.rootVariables,
  ) {
    api.commitConfiguration(createConfiguration(optionState, ruleState, rootVariables));
    state.resizeTargetsDirty = false;
  }

  /**
   * Builds a serializable view of successfully committed state.
   * @returns {object} Detached inspector model.
   */
  function buildConfigurationView() {
    return {
      applicationFormInvalidation: state.applicationFormInvalidation,
      controlsEdge: layout.dataset.controlsEdge,
      documentOverflowAxis: state.documentOverflowAxis,
      fixture: {
        checkboxChecked: state.probes.checkbox?.checked ?? false,
        characterData: state.probes.textNode?.data ?? '',
        targets: state.targets.map((target) => ({
          category: target.category,
          id: target.fixtureId,
          required: target.element.required,
          section: target.element.closest('.demo-section')?.getAttribute('data-section') ?? null,
          state: target.element.dataset.state ?? 'inactive',
          valid: target.element.validity.valid,
          value: target.element.value === '' ? 'empty' : 'populated',
        })),
      },
      options: {
        ...state.options,
        cssVariables: { ...state.rootVariables },
        updates: {
          ...state.options.updates,
          mutation: { ...state.options.updates.mutation, targets: 'tracked fixture' },
          resize: { ...state.options.updates.resize, targets: 'tracked fixture and tracked textarea targets' },
        },
      },
      rules: {
        ruleA: { ...state.rules.a, labelMode: state.rules.labelMode, nativeTitle: state.rules.nativeTitle },
        ruleB: { ...state.rules.b, labelMode: state.rules.labelMode, nativeTitle: state.rules.nativeTitle },
        activation: {
          focus: state.rules.focus,
          scroll: state.rules.scroll,
          scrollAlign: state.rules.scrollAlign,
          scrollBehavior: state.rules.scrollBehavior,
        },
      },
    };
  }

  /** Refreshes the read-only committed-configuration inspector. */
  function refreshConfiguration() {
    configurationOutput.textContent = JSON.stringify(buildConfigurationView(), null, 2);
  }

  /**
   * Applies an option candidate transactionally.
   * @param {object} patch - Public option patch.
   * @returns {boolean} Whether Core accepted the candidate.
   */
  function applyOptionPatch(patch) {
    const candidateOptions = mergeOptions(state.options, patch);
    try {
      commitConfiguration(candidateOptions);
      state.options = candidateOptions;
      optionStatus.textContent = 'Tracker options applied.';
      syncControlsEdge();
      refreshConfiguration();
      return true;
    } catch (error) {
      optionStatus.textContent = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Applies a complete rule candidate transactionally.
   * @param {object} candidateRules - Detached candidate rule state.
   * @returns {boolean} Whether Core accepted the candidate.
   */
  function applyRuleCandidate(candidateRules) {
    try {
      commitConfiguration(state.options, candidateRules);
      state.rules = candidateRules;
      ruleStatus.textContent = `${String(buildRules().length)} rule(s) applied.`;
      refreshConfiguration();
      return true;
    } catch (error) {
      ruleStatus.textContent = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Copies stable rule state for candidate editing.
   * @returns {object} Detached candidate rule state.
   */
  function copyRuleState() {
    return {
      ...state.rules,
      a: { ...state.rules.a, hooks: { ...state.rules.a.hooks }, variables: { ...state.rules.a.variables } },
      b: { ...state.rules.b, hooks: { ...state.rules.b.hooks }, variables: { ...state.rules.b.variables } },
    };
  }

  /** Refreshes deterministic fixture category counts. */
  function refreshCounts() {
    const primaryCount = state.targets.filter((target) => target.category === 'primary').length;
    counts.textContent = `Sections: ${String(state.sections.length)} · Primary targets: ${String(primaryCount)} · Secondary targets: ${String(state.targets.length - primaryCount)}`;
  }

  /**
   * Appends one normal long-form fixture section.
   * @returns {HTMLElement} Appended section.
   */
  function addSection() {
    const section = createElement('section', 'demo-section');
    const number = state.sections.length + 1;
    section.dataset.section = String(number);
    section.append(createElement('h2', '', `Section ${String(number)}`), createElement('p', '', FILLER_TEXT));
    state.sections.push(section);
    content.append(section);
    return section;
  }

  /**
   * Adds one deterministic textarea with independent category and form-state axes.
   * @param {'primary' | 'secondary'} category - Stable application-owned category.
   * @param {'invalid' | 'required-valid' | 'optional-valid'} formState - Initial native form state.
   * @param {number} [sectionIndex] - Zero-based destination section.
   * @param {boolean} [synchronize] - Whether to refresh workbench views immediately.
   * @returns {object} Owned target record with stable visible identity.
   */
  function addTarget(
    category,
    formState,
    sectionIndex = state.targetSerial % state.sections.length,
    synchronize = true,
  ) {
    state.targetSerial += 1;
    state.categoryCounters[category] += 1;
    const element = document.createElement('textarea');
    const fixtureId = `${TARGET_CATEGORY_PREFIXES[category]}-${String(state.categoryCounters[category])}`;
    const categoryLabel = TARGET_CATEGORY_LABELS[category];
    const label = `${fixtureId} · ${categoryLabel} textarea`;
    element.className = `demo-${category}`;
    element.dataset.initialFormState = formState;
    element.dataset.state = 'inactive';
    element.dataset.targetCategory = category;
    element.dataset.targetId = fixtureId;
    element.id = `demo-textarea-${fixtureId.toLowerCase()}`;
    element.setAttribute('aria-label', label);
    element.placeholder = `${fixtureId} · ${categoryLabel} · required · type to become valid`;
    element.rows = 3;
    if (formState !== 'optional-valid') {
      element.required = true;
    }
    if (formState !== 'invalid') {
      element.value = `${label} has deterministic content.`;
    }
    const record = { category, control: null, element, fixtureId, serial: state.targetSerial };
    state.targets.push(record);
    state.resizeTargetsDirty = true;
    resizeTargets = () => [content, ...state.targets.map(({ element: target }) => target)];
    state.sections[sectionIndex].append(element);
    if (synchronize) {
      refreshTargetRows();
      refreshCounts();
      refreshConfiguration();
    }
    return record;
  }

  /**
   * Removes one owned target record and its current DOM node.
   * @param {object} record - Owned target record.
   */
  function removeTarget(record) {
    const index = state.targets.indexOf(record);
    if (index >= 0) {
      state.targets.splice(index, 1);
      state.resizeTargetsDirty = true;
      resizeTargets = () => [content, ...state.targets.map(({ element: target }) => target)];
    }
    record.control?.row.remove();
    record.element.remove();
    refreshTargetRows();
    refreshCounts();
    refreshConfiguration();
  }

  /**
   * Moves one exact target to the next fixture section without replacing its DOM identity.
   * @param {object} record - Owned target record.
   */
  function moveTarget(record) {
    const currentSection = record.element.closest('.demo-section');
    const currentIndex = state.sections.indexOf(currentSection);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % state.sections.length;
    state.sections[nextIndex].append(record.element);
    refreshTargetRow(record);
    refreshConfiguration();
  }

  /**
   * Sets one target value and emits the same bubbling input boundary used by user editing.
   * @param {object} record - Owned target record.
   * @param {string} value - Deterministic next value.
   */
  function setTargetValue(record, value) {
    record.element.value = value;
    record.element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Updates the controls and summary for one exact target from live DOM state.
   * @param {object} record - Owned target record.
   */
  function refreshTargetRow(record) {
    if (record.control === null) {
      return;
    }
    const { element } = record;
    const section = element.closest('.demo-section')?.getAttribute('data-section') ?? 'detached';
    const validity = element.validity.valid ? 'Valid' : 'Invalid';
    record.control.summary.textContent = `${TARGET_CATEGORY_LABELS[record.category]} · ${element.required ? 'Required' : 'Optional'} · ${validity} · Section ${section}`;
    record.control.state.textContent = `State: ${element.dataset.state ?? 'inactive'}`;
    record.control.valueButton.textContent = element.value === '' ? 'Fill' : 'Clear';
    record.control.valueButton.setAttribute(
      'aria-label',
      `${record.fixtureId} ${element.value === '' ? 'fill' : 'clear'}`,
    );
    record.control.required.checked = element.required;
    record.control.stateSelect.value = element.dataset.state ?? 'inactive';
    element.placeholder = `${record.fixtureId} · ${TARGET_CATEGORY_LABELS[record.category]} · ${element.required ? 'required · type to become valid' : 'optional · type to add content'}`;
  }

  /**
   * Creates the management row for one exact tracked target.
   * @param {object} record - Owned target record.
   * @returns {HTMLLIElement} Stable target control row.
   */
  function createTargetRow(record) {
    const row = createElement('li', 'fixture-target-row');
    const heading = createElement('div', 'fixture-target-row__heading');
    const identity = createElement('strong', 'fixture-target-row__identity', record.fixtureId);
    const summary = createElement('span', 'fixture-target-row__summary');
    const stateOutput = createElement('span', 'fixture-target-row__state');
    const actions = createElement('div', 'fixture-target-row__actions');
    const valueButton = createButton(
      '',
      () => {
        setTargetValue(
          record,
          record.element.value === '' ? `${record.fixtureId} has deterministic filled content.` : '',
        );
      },
      { 'data-target-action': 'value' },
    );
    const requiredLabel = createElement('label', 'fixture-target-row__required');
    const required = document.createElement('input');
    required.type = 'checkbox';
    required.setAttribute('aria-label', `${record.fixtureId} required`);
    required.addEventListener('change', () => {
      record.element.required = required.checked;
      refreshTargetRow(record);
      refreshConfiguration();
    });
    requiredLabel.append(required, document.createTextNode('Required'));
    const stateLabel = createElement('label', 'fixture-target-row__state-control');
    stateLabel.append(document.createTextNode('State'));
    const stateSelect = document.createElement('select');
    stateSelect.setAttribute('aria-label', `${record.fixtureId} state`);
    for (const value of ['inactive', 'active']) {
      const option = createElement('option', '', value);
      option.value = value;
      stateSelect.append(option);
    }
    stateSelect.addEventListener('change', () => {
      record.element.dataset.state = stateSelect.value;
      refreshTargetRow(record);
      refreshConfiguration();
    });
    stateLabel.append(stateSelect);
    actions.append(
      valueButton,
      requiredLabel,
      stateLabel,
      createButton('Move to next section', () => moveTarget(record), {
        'aria-label': `${record.fixtureId} move to next section`,
        'data-target-action': 'move',
      }),
      createButton('Remove', () => removeTarget(record), {
        'aria-label': `${record.fixtureId} remove`,
        'data-target-action': 'remove',
      }),
    );
    heading.append(identity, summary);
    row.dataset.targetControlId = record.fixtureId;
    row.append(heading, stateOutput, actions);
    record.control = { required, row, state: stateOutput, stateSelect, summary, valueButton };
    refreshTargetRow(record);
    return row;
  }

  /** Reconciles dynamic management rows with the current owned target set. */
  function refreshTargetRows() {
    const activeIds = new Set(state.targets.map(({ fixtureId }) => fixtureId));
    for (const row of targetList.querySelectorAll('[data-target-control-id]')) {
      if (!activeIds.has(row.dataset.targetControlId)) {
        row.remove();
      }
    }
    for (const record of state.targets) {
      const row = record.control?.row ?? createTargetRow(record);
      refreshTargetRow(record);
      targetList.append(row);
    }
  }

  /** Adds the compact checkbox and Text-node probes to the first normal fixture section. */
  function createFixtureProbes() {
    const probes = createElement('div', 'fixture-probes');
    const checkboxProbe = createElement('section', 'fixture-probe');
    checkboxProbe.append(createElement('strong', '', 'Checkbox state probe'));
    const checkbox = document.createElement('input');
    checkbox.id = 'fixture-checkbox-probe';
    checkbox.type = 'checkbox';
    checkbox.className = 'demo-checkbox-probe';
    const checkboxLabel = document.createElement('label');
    checkboxLabel.htmlFor = checkbox.id;
    checkboxLabel.append(checkbox, document.createTextNode('Checked'));
    checkboxProbe.append(checkboxLabel, createElement('p', 'fixture-probe__hint', 'Try selector: input:checked'));
    const textProbe = createElement('section', 'fixture-probe');
    textProbe.append(createElement('strong', '', 'Character-data probe'));
    const textElement = createElement('p', 'demo-text-probe');
    const textNode = document.createTextNode('Character data probe · revision 0');
    textElement.append(textNode);
    textProbe.append(textElement);
    probes.append(checkboxProbe, textProbe);
    state.sections[0].append(probes);
    state.probes = { checkbox, textElement, textNode };
  }

  /** Refreshes compact probe state shown in the workbench. */
  function refreshProbeStatus() {
    checkboxStatus.textContent = state.probes.checkbox?.checked ? 'Current: checked' : 'Current: unchecked';
    characterDataStatus.textContent = `Current: "${state.probes.textNode?.data ?? ''}"`;
  }

  /** Runs one bounded mixed-observer mutation burst using only burst-owned targets. */
  function runMutationBurst() {
    state.burstCounter += 1;
    const origin = (state.burstCounter * 3) % state.sections.length;
    const retained = addTarget('secondary', 'invalid', origin);
    setTargetValue(retained, `${retained.fixtureId} · burst ${String(state.burstCounter)}`);
    retained.element.dataset.state = 'active';
    retained.element.required = false;
    moveTarget(retained);
    const transient = addTarget('primary', 'optional-valid', (origin + 1) % state.sections.length);
    removeTarget(transient);
    if (!(state.probes.textNode instanceof Text)) {
      throw new Error('Mutation burst requires the character-data probe.');
    }
    state.probes.textNode.data = `Character data probe · burst ${String(state.burstCounter)}`;
    refreshTargetRows();
    refreshCounts();
    refreshProbeStatus();
    refreshConfiguration();
    fixtureStatus.textContent = `Mutation burst ${String(state.burstCounter)} completed.`;
    fixtureStatus.dataset.burstCount = String(state.burstCounter);
    fixtureStatus.dataset.burstRetainedId = retained.fixtureId;
    fixtureStatus.dataset.burstTransientId = transient.fixtureId;
  }

  /**
   * Prepends one bounded, retention-safe public event summary.
   * @param {string} eventName - Public event name.
   * @param {unknown} payload - Public event payload.
   */
  function appendEvent(eventName, payload) {
    const summary = summarizePayload(payload);
    eventLog.prepend(createElement('div', '', `${eventName}${summary ? ` — ${summary}` : ''}`));
    while (eventLog.childElementCount > EVENT_LOG_LIMIT) {
      eventLog.lastElementChild.remove();
    }
  }

  /** Refreshes the public stats summary and raw inspector. */
  function refreshRuntime() {
    const stats = api.getStats();
    const summary = {
      clusters: stats.clusters?.current ?? 0,
      errors: stats.errors?.total ?? 0,
      markers: stats.markers?.current ?? 0,
      mutations: stats.observers?.mutation ?? 0,
      renders: stats.renders?.completed ?? 0,
      warnings: stats.warnings?.total ?? 0,
    };
    for (const [key, value] of Object.entries(summary)) {
      runtimeValues[key].textContent = String(value);
    }
    runtimeValues.sync.textContent = `${String(syncStarts)} / ${String(syncEnds)}`;
    rawStatsOutput.textContent = JSON.stringify(stats, null, 2);
  }

  /**
   * Builds target-oriented fixture, probe, structure, and geometry controls.
   * @returns {HTMLDetailsElement} Top-level panel.
   */
  function buildFixturePanel() {
    const panel = createPanel('Fixture & stress', true);
    const addTargetGroup = createGroup('Add target');
    const targetsGroup = createGroup('Targets');
    const checkboxGroup = createGroup('Checkbox probe');
    const characterDataGroup = createGroup('Character-data probe');
    const structureGroup = createGroup('Structure & stress');
    const axisGroup = createGroup('Document geometry');
    targetList.setAttribute('aria-label', 'Tracked textarea targets');

    const categoryControl = createSelect(
      'Category',
      [
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
      ],
      'primary',
      () => undefined,
      { 'data-fixture': 'target-category' },
    );
    const formStateControl = createSelect(
      'Initial form state',
      [
        { label: 'Invalid required', value: 'invalid' },
        { label: 'Valid required', value: 'required-valid' },
        { label: 'Valid optional', value: 'optional-valid' },
      ],
      'invalid',
      () => undefined,
      { 'data-fixture': 'target-form-state' },
    );
    const addTargetButton = createButton(
      'Add',
      () => addTarget(categoryControl.select.value, formStateControl.select.value),
      { 'data-action': 'add-target' },
    );
    addTargetGroup.append(
      categoryControl.label,
      formStateControl.label,
      addTargetButton,
      createElement(
        'p',
        'workbench-note',
        'Category is stable. Initial form state independently sets value and the required attribute.',
      ),
    );

    targetsGroup.append(
      targetList,
      counts,
      createElement(
        'p',
        'workbench-note',
        'Fill/Clear changes textarea.value. Required and State mutate attributes. Move and Remove mutate child-list structure.',
      ),
    );

    checkboxStatus.setAttribute('aria-label', 'Checkbox probe state');
    checkboxGroup.append(
      checkboxStatus,
      createElement(
        'p',
        'workbench-note',
        'Use the Checked control in the tracked fixture. Try input:checked and compare application invalidation off/on.',
      ),
    );

    characterDataStatus.setAttribute('aria-label', 'Character-data probe value');
    characterDataGroup.append(
      characterDataStatus,
      createButton(
        'Change Text node',
        () => {
          if (state.probes.textNode) {
            state.textRevision += 1;
            state.probes.textNode.data = `Character data probe · revision ${String(state.textRevision)}`;
            refreshProbeStatus();
            refreshConfiguration();
          }
        },
        { 'data-action': 'change-text-node' },
      ),
      createElement(
        'p',
        'workbench-note',
        'This changes the existing Text.data value and produces a characterData mutation.',
      ),
    );

    const structureButtons = createElement('div', 'workbench-buttons');
    structureButtons.append(
      createButton('+5 sections', () => {
        for (let index = 0; index < 5; index += 1) {
          addSection();
        }
        refreshTargetRows();
        refreshCounts();
        refreshConfiguration();
      }),
      createButton('+40 targets', () => {
        const combinations = [
          ['primary', 'invalid'],
          ['primary', 'required-valid'],
          ['primary', 'optional-valid'],
          ['secondary', 'invalid'],
          ['secondary', 'required-valid'],
          ['secondary', 'optional-valid'],
        ];
        for (let index = 0; index < 40; index += 1) {
          const [category, formState] = combinations[index % combinations.length];
          addTarget(category, formState, undefined, false);
        }
        refreshTargetRows();
        refreshCounts();
        refreshConfiguration();
      }),
      createButton('Run mutation burst', runMutationBurst, { 'data-action': 'mutation-burst' }),
      createButton(
        'Remove all targets',
        () => {
          for (const target of state.targets) {
            target.control?.row.remove();
            target.element.remove();
          }
          state.targets.length = 0;
          state.resizeTargetsDirty = true;
          resizeTargets = () => [content, ...state.targets.map(({ element: target }) => target)];
          refreshTargetRows();
          refreshCounts();
          refreshConfiguration();
        },
        { 'data-action': 'remove-all-targets' },
      ),
      createButton('Toggle overlapping layer', () => {
        const existing = document.querySelector('.playground-overlap-layer');
        if (existing) {
          existing.remove();
        } else {
          document.body.append(createElement('div', 'playground-overlap-layer', 'Application overlap layer'));
        }
      }),
    );
    structureGroup.append(
      structureButtons,
      createElement(
        'p',
        'workbench-note',
        'Drag a textarea resize handle for geometry updates. Structural changes may also trigger overlapping ResizeObserver sources.',
      ),
    );

    axisGroup.append(
      createSelect(
        'Document overflow axis',
        [
          { label: 'Vertical', value: 'vertical' },
          { label: 'Horizontal', value: 'horizontal' },
        ],
        state.documentOverflowAxis,
        (value) => {
          state.documentOverflowAxis = value;
          document.body.classList.toggle('playground-workbench--horizontal-document', value === 'horizontal');
          syncControlsEdge();
          api.requestRender();
          refreshConfiguration();
        },
        { 'data-fixture': 'overflow-axis' },
      ).label,
    );

    refreshTargetRows();
    refreshProbeStatus();
    panel.body.append(
      addTargetGroup,
      targetsGroup,
      checkboxGroup,
      characterDataGroup,
      structureGroup,
      axisGroup,
      createElement(
        'p',
        'workbench-note',
        'Textarea value, validity, and checkbox checked state are browser/application state. Required and data-state are attributes; Text.data is characterData; add, move, and remove are childList changes.',
      ),
      fixtureStatus,
    );
    return panel.details;
  }

  /**
   * Builds one stable rule-identity editor.
   * @param {'a' | 'b'} key - Stable rule identity.
   * @param {string} suggestionsId - Selector datalist identifier.
   * @returns {HTMLFieldSetElement} Rule group.
   */
  function createRuleGroup(key, suggestionsId) {
    const group = createGroup(`Rule ${key.toUpperCase()}`);
    const enabled = createCheckbox(
      'Enabled',
      state.rules[key].enabled,
      (checked) => {
        const candidate = copyRuleState();
        candidate[key].enabled = checked;
        if (!applyRuleCandidate(candidate)) {
          enabled.input.checked = state.rules[key].enabled;
        }
        rebuildRuleStyleControls();
      },
      { 'data-rule-toggle': key },
    );
    const selector = createInput(
      'Selector',
      'text',
      state.rules[key].selector,
      (value) => {
        const candidate = copyRuleState();
        candidate[key].selector = value;
        if (!applyRuleCandidate(candidate)) {
          selector.input.value = state.rules[key].selector;
        }
        rebuildRuleStyleControls();
      },
      { list: suggestionsId, 'data-rule-selector': key },
    );
    group.append(enabled.label, selector.label);
    return group;
  }

  /**
   * Builds ordered rule, label, scroll, and focus controls.
   * @returns {HTMLDetailsElement} Top-level panel.
   */
  function buildRulesPanel() {
    const panel = createPanel('Rules & navigation', true);
    const suggestions = document.createElement('datalist');
    suggestions.id = 'playground-selector-suggestions';
    for (const value of SELECTOR_SUGGESTIONS) {
      const option = document.createElement('option');
      option.value = value;
      suggestions.append(option);
    }
    const activation = createGroup('Labels and activation');
    activation.append(
      createSelect(
        'Label mode',
        [
          { label: 'none', value: 'none' },
          { label: 'static', value: 'static' },
          { label: 'target text', value: 'text' },
        ],
        state.rules.labelMode,
        (value) => {
          const candidate = copyRuleState();
          candidate.labelMode = value;
          applyRuleCandidate(candidate);
        },
      ).label,
      createCheckbox(
        'Native marker title',
        state.rules.nativeTitle,
        (nativeTitle) => {
          const candidate = copyRuleState();
          candidate.nativeTitle = nativeTitle;
          applyRuleCandidate(candidate);
        },
        { 'data-rule-option': 'native-title' },
      ).label,
      createCheckbox('Scroll on activation', state.rules.scroll, (scroll) => {
        const candidate = copyRuleState();
        candidate.scroll = scroll;
        applyRuleCandidate(candidate);
      }).label,
      createSelect(
        'Scroll alignment',
        ['start', 'center', 'end', 'nearest'].map((value) => ({ label: value, value })),
        state.rules.scrollAlign,
        (value) => {
          const candidate = copyRuleState();
          candidate.scrollAlign = value;
          applyRuleCandidate(candidate);
        },
      ).label,
      createSelect(
        'Scroll behavior',
        ['auto', 'smooth'].map((value) => ({ label: value, value })),
        state.rules.scrollBehavior,
        (value) => {
          const candidate = copyRuleState();
          candidate.scrollBehavior = value;
          applyRuleCandidate(candidate);
        },
      ).label,
      createCheckbox(
        'Focus on activation',
        state.rules.focus,
        (focus) => {
          const candidate = copyRuleState();
          candidate.focus = focus;
          applyRuleCandidate(candidate);
        },
        { 'data-rule-option': 'focus' },
      ).label,
      createElement(
        'p',
        'workbench-note',
        'Focus targets the matched element. Generated textarea sources receive native focus and expose their caret.',
      ),
    );
    panel.body.append(
      createRuleGroup('a', suggestions.id),
      createRuleGroup('b', suggestions.id),
      suggestions,
      createElement(
        'p',
        'workbench-note',
        'Rules are evaluated in order: Rule A before Rule B. The first matching rule owns the source element.',
      ),
      activation,
      ruleStatus,
    );
    return panel.details;
  }

  /**
   * Returns legal physical placements for one public orientation.
   * @param {string} orientation - Committed public orientation.
   * @returns {ReadonlyArray<{ label: string, value: string }>} Select options.
   */
  function getPlacementOptions(orientation) {
    return orientation === 'horizontal'
      ? [
          { label: 'top', value: 'top' },
          { label: 'bottom', value: 'bottom' },
        ]
      : [
          { label: 'left', value: 'left' },
          { label: 'right', value: 'right' },
        ];
  }

  /**
   * Builds public Tracker option and explicit render controls.
   * @returns {HTMLDetailsElement} Top-level panel.
   */
  function buildTrackerPanel() {
    const panel = createPanel('Tracker', true);
    const geometry = createGroup('Geometry and grouping');
    const interaction = createGroup('Interaction and accessibility');
    const linkedA11yControls = {};
    let placementControl;
    const orientationControl = createSelect(
      'Orientation',
      [
        { label: 'vertical', value: 'vertical' },
        { label: 'horizontal', value: 'horizontal' },
      ],
      state.options.orientation,
      (orientation) => {
        const legalPlacements = getPlacementOptions(orientation);
        const placement = legalPlacements.some(({ value }) => value === state.options.placement)
          ? state.options.placement
          : orientation === 'vertical'
            ? 'left'
            : 'top';
        if (applyOptionPatch({ orientation, placement })) {
          const replacement = createSelect(
            'Placement',
            legalPlacements,
            placement,
            (nextPlacement) => {
              if (!applyOptionPatch({ placement: nextPlacement })) {
                replacement.select.value = state.options.placement;
              }
            },
            { 'data-option': 'placement' },
          );
          placementControl.label.replaceWith(replacement.label);
          placementControl = replacement;
        } else {
          orientationControl.select.value = state.options.orientation;
        }
      },
      { 'data-option': 'orientation' },
    );
    placementControl = createSelect(
      'Placement',
      getPlacementOptions(state.options.orientation),
      state.options.placement,
      (placement) => {
        if (!applyOptionPatch({ placement })) {
          placementControl.select.value = state.options.placement;
        }
      },
      { 'data-option': 'placement' },
    );
    geometry.append(
      orientationControl.label,
      placementControl.label,
      createCheckbox('Viewport enabled', true, (enabled) => applyOptionPatch({ viewport: { enabled } })).label,
      createCheckbox('Clustering enabled', true, (enabled) => applyOptionPatch({ clustering: { enabled } }), {
        'data-option': 'clustering',
      }).label,
      createInput(
        'Clustering threshold',
        'number',
        '2',
        (value) => applyOptionPatch({ clustering: { threshold: Number(value) } }),
        { min: '0', step: '0.5', 'data-option': 'cluster-threshold' },
      ).label,
    );
    const accessibilityControl = createCheckbox(
      'Accessibility enabled',
      false,
      (enabled) => {
        const patch = enabled ? { a11y: { enabled: true } } : { a11y: { enabled: false, keyboard: false } };
        if (applyOptionPatch(patch) && !enabled) {
          linkedA11yControls.keyboard.input.checked = false;
        }
      },
      { 'data-option': 'a11y-enabled' },
    );
    const keyboardControl = createCheckbox('Keyboard enabled', false, (keyboard) => {
      const patch = keyboard ? { a11y: { enabled: true, keyboard: true } } : { a11y: { keyboard: false } };
      if (applyOptionPatch(patch) && keyboard) {
        linkedA11yControls.accessibility.input.checked = true;
      }
    });
    linkedA11yControls.accessibility = accessibilityControl;
    linkedA11yControls.keyboard = keyboardControl;
    interaction.append(
      createCheckbox('Interaction activation', true, (activation) => applyOptionPatch({ interaction: { activation } }))
        .label,
      createCheckbox('Interaction drag', false, (drag) => applyOptionPatch({ interaction: { drag } })).label,
      accessibilityControl.label,
      keyboardControl.label,
      createInput('Accessible label', 'text', state.options.a11y.label, (label) =>
        applyOptionPatch({ a11y: { label } }),
      ).label,
    );
    const renderActions = createElement('div', 'workbench-buttons');
    renderActions.append(createButton('Render now', api.renderNow), createButton('Request render', api.requestRender));
    panel.body.append(geometry, interaction, renderActions, optionStatus);
    return panel.details;
  }

  /**
   * Builds observer-source and application-invalidation controls.
   * @returns {HTMLDetailsElement} Top-level panel.
   */
  function buildUpdatesPanel() {
    const panel = createPanel('Updates', false);
    const sources = createGroup('Automatic sources');
    const application = createGroup('Application invalidation');
    const advanced = createElement('details', 'workbench-advanced');
    const advancedBody = createElement('div', 'workbench-advanced__body');
    advanced.append(createElement('summary', '', 'Advanced timing'), advancedBody);
    sources.append(
      createCheckbox('Mutation updates', true, (enabled) => applyOptionPatch({ updates: { mutation: { enabled } } }), {
        'data-update': 'mutation',
      }).label,
      createCheckbox(
        'Observe child list',
        true,
        (childList) => applyOptionPatch({ updates: { mutation: { options: { childList } } } }),
        { 'data-update': 'child-list' },
      ).label,
      createCheckbox(
        'Observe attributes',
        false,
        (attributes) => applyOptionPatch({ updates: { mutation: { options: { attributes } } } }),
        { 'data-update': 'attributes' },
      ).label,
      createCheckbox(
        'Observe text / characterData',
        false,
        (characterData) => applyOptionPatch({ updates: { mutation: { options: { characterData } } } }),
        { 'data-update': 'text' },
      ).label,
      createCheckbox('Resize updates', true, (enabled) => applyOptionPatch({ updates: { resize: { enabled } } }), {
        'data-update': 'resize',
      }).label,
      createCheckbox('Scroll updates', true, (enabled) => applyOptionPatch({ updates: { scroll: { enabled } } }), {
        'data-update': 'scroll',
      }).label,
      createCheckbox('Interval updates', false, (enabled) => applyOptionPatch({ updates: { interval: { enabled } } }), {
        'data-update': 'interval',
      }).label,
    );
    application.append(
      createCheckbox(
        'Request render on form input',
        false,
        (enabled) => {
          state.applicationFormInvalidation = enabled;
          refreshConfiguration();
        },
        { 'data-update': 'form-input' },
      ).label,
      createElement(
        'p',
        'workbench-note',
        'Textarea and checkbox input requests one public render only when enabled. Property state is not presented as a MutationObserver record.',
      ),
      createElement(
        'p',
        'workbench-note',
        'Multiple sources can observe one action. Disable unrelated Resize, Scroll, or Interval updates when isolating MutationObserver behavior.',
      ),
    );
    advancedBody.append(
      createInput(
        'Mutation debounce, ms',
        'number',
        '100',
        (value) => applyOptionPatch({ updates: { mutation: { debounce: Number(value) } } }),
        { min: '0', step: '10' },
      ).label,
      createInput(
        'Resize debounce, ms',
        'number',
        '50',
        (value) => applyOptionPatch({ updates: { resize: { debounce: Number(value) } } }),
        { min: '0', step: '10' },
      ).label,
      createInput(
        'Interval delay, ms',
        'number',
        '1000',
        (value) => applyOptionPatch({ updates: { interval: { delay: Number(value) } } }),
        { min: '16', step: '100' },
      ).label,
    );
    panel.body.append(sources, application, advanced);
    return panel.details;
  }

  /**
   * Applies one root CSS-variable candidate transactionally.
   * @param {string} name - Public root variable name.
   * @param {boolean} overridden - Whether to emit the declaration.
   * @param {string} value - Verbatim CSS value.
   * @returns {boolean} Whether Core accepted the candidate.
   */
  function applyRootVariable(name, overridden, value) {
    const candidateVariables = { ...state.rootVariables };
    if (overridden) {
      candidateVariables[name] = value;
    } else {
      delete candidateVariables[name];
    }
    try {
      commitConfiguration(state.options, state.rules, candidateVariables);
      state.rootVariables = candidateVariables;
      cssStatus.textContent = `${name} now uses ${overridden ? 'Override' : 'Default'}.`;
      refreshConfiguration();
      return true;
    } catch (error) {
      cssStatus.textContent = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Applies one stable rule CSS-variable candidate transactionally.
   * @param {'a' | 'b'} key - Stable rule identity.
   * @param {string} name - Public rule variable name.
   * @param {boolean} overridden - Whether to emit the declaration.
   * @param {string} value - Verbatim CSS value.
   * @returns {boolean} Whether Core accepted the candidate.
   */
  function applyRuleVariable(key, name, overridden, value) {
    const candidate = copyRuleState();
    if (overridden) {
      candidate[key].variables[name] = value;
    } else {
      delete candidate[key].variables[name];
    }
    const accepted = applyRuleCandidate(candidate);
    cssStatus.textContent = accepted
      ? `${name} now uses ${overridden ? 'Override' : 'Default'} for Rule ${key.toUpperCase()}.`
      : ruleStatus.textContent;
    return accepted;
  }

  /**
   * Creates one always-visible Default/Override variable row.
   * @param {string} name - Public CSS variable name.
   * @param {() => Record<string, string>} getVariables - Current committed scope values.
   * @param {(overridden: boolean, value: string) => boolean} onApply - Transactional commit callback.
   * @returns {HTMLDivElement} Variable row.
   */
  function createVariableRow(name, getVariables, onApply) {
    const row = createElement('div', 'variable-row');
    const toggleLabel = createElement('label', 'variable-row__toggle');
    const toggle = document.createElement('input');
    const toggleState = createElement('span');
    const value = document.createElement('input');
    const initial = getVariables()[name];
    toggle.type = 'checkbox';
    toggle.checked = initial !== undefined;
    toggle.setAttribute('aria-label', `${name} override`);
    value.type = 'text';
    value.value = initial ?? '';
    value.disabled = !toggle.checked;
    value.placeholder = VARIABLE_HINTS[name] ?? 'CSS value';
    value.setAttribute('aria-label', `${name} value`);
    toggleState.textContent = toggle.checked ? 'Override' : 'Default';
    toggleLabel.append(toggle, toggleState);
    toggle.addEventListener('change', () => {
      if (!onApply(toggle.checked, value.value)) {
        toggle.checked = getVariables()[name] !== undefined;
      }
      value.disabled = !toggle.checked;
      toggleState.textContent = toggle.checked ? 'Override' : 'Default';
    });
    value.addEventListener('change', () => {
      if (toggle.checked && !onApply(true, value.value)) {
        value.value = getVariables()[name] ?? '';
      }
    });
    row.append(createElement('code', '', name), toggleLabel, value);
    return row;
  }

  /**
   * Creates a strict catalog for one public variable scope.
   * @param {ReadonlyArray<object>} groups - Named progressive-disclosure groups.
   * @param {() => Record<string, string>} getVariables - Current committed scope values.
   * @param {(name: string, overridden: boolean, value: string) => boolean} onApply - Scope commit callback.
   * @returns {HTMLDivElement} Variable catalog.
   */
  function createVariableCatalog(groups, getVariables, onApply) {
    const catalog = createElement('div', 'variable-catalog');
    for (const definition of groups) {
      const group = createElement('details', 'variable-group');
      const list = createElement('div', 'variable-list');
      for (const name of definition.names) {
        list.append(createVariableRow(name, getVariables, (overridden, value) => onApply(name, overridden, value)));
      }
      group.append(createElement('summary', '', definition.title), list);
      catalog.append(group);
    }
    return catalog;
  }

  /**
   * Builds strict root and stable-rule CSS-variable catalogs.
   * @returns {HTMLDetailsElement} Top-level panel.
   */
  function buildCssPanel() {
    const panel = createPanel('CSS variables', false);
    const root = createGroup('Root Tracker options');
    root.append(createVariableCatalog(ROOT_VARIABLE_GROUPS, () => state.rootVariables, applyRootVariable));
    const marker = createGroup('Rule-specific marker');
    const markerHost = createElement('div');
    const selector = createSelect(
      'Rule identity',
      [
        { label: 'Rule A', value: 'a' },
        { label: 'Rule B', value: 'b' },
      ],
      state.rules.selectedStyle,
      (key) => {
        state.rules.selectedStyle = key;
        rebuildRuleStyleControls();
        refreshConfiguration();
      },
      { 'data-css-scope': 'marker-rule' },
    );
    marker.append(selector.label, markerHost);

    rebuildRuleStyleControls = () => {
      markerHost.replaceChildren();
      const key = state.rules.selectedStyle;
      const advanced = createElement('details', 'workbench-advanced');
      const body = createElement('div', 'workbench-advanced__body');
      advanced.append(createElement('summary', '', 'Advanced marker hooks'), body);
      const classes = createInput('Classes', 'text', state.rules[key].hooks.className, (className) => {
        const candidate = copyRuleState();
        candidate[key].hooks.className = className;
        if (!applyRuleCandidate(candidate)) {
          classes.input.value = state.rules[key].hooks.className;
        }
      });
      const attributes = createInput(
        'Attributes',
        'text',
        state.rules[key].hooks.attributes,
        (attributeValue) => {
          const candidate = copyRuleState();
          candidate[key].hooks.attributes = attributeValue;
          if (!applyRuleCandidate(candidate)) {
            attributes.input.value = state.rules[key].hooks.attributes;
          }
        },
        { placeholder: 'data-state=value; aria-label=text' },
      );
      body.append(classes.label, attributes.label);
      markerHost.append(
        createVariableCatalog(
          RULE_VARIABLE_GROUPS,
          () => state.rules[key].variables,
          (name, overridden, value) => applyRuleVariable(key, name, overridden, value),
        ),
        advanced,
      );
    };
    rebuildRuleStyleControls();
    panel.body.append(
      root,
      marker,
      createElement(
        'p',
        'workbench-note',
        'Default omits a declaration. Override sends the entered string verbatim, including an empty string.',
      ),
      cssStatus,
    );
    return panel.details;
  }

  /**
   * Builds diagnostics, event telemetry, and committed-state inspectors.
   * @returns {HTMLDetailsElement} Top-level panel.
   */
  function buildRuntimePanel() {
    const panel = createPanel('Runtime inspector', false);
    const summary = createElement('dl', 'runtime-summary');
    const labels = {
      markers: 'Markers',
      clusters: 'Clusters',
      warnings: 'Warnings',
      errors: 'Errors',
      mutations: 'Mutation observations',
      renders: 'Render completions',
      sync: 'Sync start / end',
    };
    for (const [key, label] of Object.entries(labels)) {
      const wrapper = createElement('div');
      const value = createElement('dd', '', '0');
      value.dataset.runtimeValue = key;
      runtimeValues[key] = value;
      wrapper.append(createElement('dt', '', label), value);
      summary.append(wrapper);
    }
    const diagnostics = createGroup('Diagnostics');
    diagnostics.append(
      createCheckbox(
        'Warnings',
        state.options.diagnostics.warnings,
        (warnings) => applyOptionPatch({ diagnostics: { warnings } }),
        { 'data-diagnostic': 'warnings' },
      ).label,
      createCheckbox(
        'Metrics',
        state.options.diagnostics.metrics,
        (metrics) => applyOptionPatch({ diagnostics: { metrics } }),
        { 'data-diagnostic': 'metrics' },
      ).label,
    );
    const actions = createElement('div', 'workbench-buttons');
    actions.append(
      createButton('Refresh inspector', refreshRuntime, { 'data-action': 'refresh-inspector' }),
      createButton('Reset stats', () => {
        api.resetStats();
        refreshRuntime();
      }),
      createButton('Clear event log', () => eventLog.replaceChildren()),
    );
    const rawDetails = createElement('details', 'workbench-advanced');
    rawDetails.append(createElement('summary', '', 'Raw stats'), rawStatsOutput);
    const eventDetails = createElement('details', 'workbench-advanced');
    eventDetails.append(createElement('summary', '', 'Event telemetry'), eventLog);
    const configurationDetails = createElement('details', 'workbench-advanced');
    configurationDetails.append(createElement('summary', '', 'Current configuration'), configurationOutput);
    panel.body.append(summary, diagnostics, actions, rawDetails, eventDetails, configurationDetails);
    return panel.details;
  }

  for (let index = 0; index < INITIAL_SECTION_COUNT; index += 1) {
    addSection();
  }
  for (const [index, section] of INITIAL_RULE_A_SECTIONS.entries()) {
    addTarget('primary', index % 2 === 0 ? 'invalid' : 'required-valid', section - 1, false);
  }
  for (const [index, section] of INITIAL_RULE_B_SECTIONS.entries()) {
    addTarget('secondary', index % 2 === 0 ? 'invalid' : 'optional-valid', section - 1, false);
  }
  createFixtureProbes();
  refreshCounts();

  controls.append(
    buildFixturePanel(),
    buildRulesPanel(),
    buildTrackerPanel(),
    buildUpdatesPanel(),
    buildCssPanel(),
    buildRuntimePanel(),
  );

  content.addEventListener('input', (event) => {
    const targetRecord = state.targets.find(({ element }) => element === event.target);
    if (targetRecord) {
      refreshTargetRow(targetRecord);
    }
    refreshProbeStatus();
    refreshConfiguration();
    if (state.applicationFormInvalidation) {
      api.requestRender();
    }
  });
  syncControlsEdge();
  refreshConfiguration();

  /** Returns the complete validated configuration required for the first Tracker mount. */
  function getInitialConfiguration() {
    const configuration = createConfiguration();
    state.resizeTargetsDirty = false;
    return configuration;
  }

  /** Starts one shared runtime observation window after event transport is connected. */
  function start() {
    syncStarts = 0;
    syncEnds = 0;
    eventLog.replaceChildren();
    api.resetStats();
    observingRuntime = true;
    api.renderNow();
    refreshRuntime();
  }

  /**
   * Receives one event through the integration's real event transport.
   * @param {string} eventName - Public Tracker event name.
   * @param {unknown} payload - Integration-delivered public event payload.
   */
  function handleEvent(eventName, payload) {
    if (!observingRuntime) {
      return;
    }
    if (eventName === 'sync:start') {
      syncStarts += 1;
      return;
    }
    if (eventName === 'sync:end') {
      syncEnds += 1;
      appendEvent(eventName, payload);
      refreshRuntime();
      if (state.resizeTargetsDirty) {
        state.resizeTargetsDirty = false;
        commitConfiguration();
      }
      return;
    }
    appendEvent(eventName, payload);
  }

  return { getInitialConfiguration, handleEvent, start };
}

export { createPlaygroundWorkbench };
