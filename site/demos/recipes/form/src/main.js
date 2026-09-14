import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import '../../../../shared/application/base.css';
import './styles.css';

/** @type {HTMLFormElement} */
const applicationForm = document.querySelector('#application-form');

/** @type {HTMLInputElement} */
const arrivalDateInput = document.querySelector('#arrival-date');

/** @type {HTMLInputElement} */
const birthDateInput = document.querySelector('#birth-date');

/** @type {HTMLInputElement} */
const departureDateInput = document.querySelector('#departure-date');

/** @type {HTMLInputElement} */
const intensityInput = document.querySelector('#intensity');

/** @type {HTMLOutputElement} */
const intensityOutput = document.querySelector('#intensity-output');

/** @type {HTMLInputElement} */
const signedDateInput = document.querySelector('#signed-date');

/** @type {HTMLElement} */
const successMessage = document.querySelector('#success-message');

if (
  !(applicationForm instanceof HTMLFormElement) ||
  !(arrivalDateInput instanceof HTMLInputElement) ||
  !(birthDateInput instanceof HTMLInputElement) ||
  !(departureDateInput instanceof HTMLInputElement) ||
  !(intensityInput instanceof HTMLInputElement) ||
  !(intensityOutput instanceof HTMLOutputElement) ||
  !(signedDateInput instanceof HTMLInputElement) ||
  !(successMessage instanceof HTMLElement)
) {
  throw new Error('Extended application form markup is incomplete.');
}

/**
 * Reads an element's visible text without the decorative required marker.
 *
 * @param {Element} element - Label or legend whose text identifies a field.
 * @returns {string} Trimmed visible label text.
 */
function readLabelText(element) {
  const clone = element.cloneNode(true);

  clone.querySelectorAll('.required-mark').forEach((mark) => mark.remove());

  return clone.textContent.trim();
}

/**
 * Adds the browser-provided validation reason to a marker label.
 *
 * @param {string} label - Human-readable field or group label.
 * @param {string} reason - Native validation message, or an empty string.
 * @returns {string} Marker label with its current validation reason.
 */
function appendValidationReason(label, reason) {
  return reason ? `${label}: ${reason}` : label;
}

/**
 * Resolves a marker label for one standalone native control.
 *
 * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} element - Invalid form control.
 * @returns {string | null} Marker label, or null when the control has no label.
 */
function resolveFieldLabel(element) {
  const label = element.labels?.[0];

  return label ? appendValidationReason(readLabelText(label), element.validationMessage) : null;
}

/**
 * Resolves one marker label for a logical radio or checkbox group.
 *
 * @param {HTMLFieldSetElement} fieldset - Invalid choice-group fieldset.
 * @returns {string | null} Marker label, or null when the group has no legend.
 */
function resolveChoiceGroupLabel(fieldset) {
  const legend = fieldset.querySelector('legend');

  if (!legend) {
    return null;
  }

  const reason = fieldset.querySelector('input:invalid')?.validationMessage ?? '';

  return appendValidationReason(readLabelText(legend), reason);
}

const tracker = new Tracker({
  options: {
    clustering: { enabled: false },
    cssVariables: { '--rxtt-marker-bg': '#b42318' },
  },
  rules: [
    {
      // Choice inputs are excluded here because each choice fieldset gets one logical marker.
      selector:
        '.form-was-validated input:invalid:not(fieldset.choice-group *), .form-was-validated select:invalid, .form-was-validated textarea:invalid',
      label: resolveFieldLabel,
      focus: { enabled: true },
    },
    {
      selector: '.form-was-validated fieldset.choice-group:has(:invalid)',
      label: resolveChoiceGroupLabel,
      focus: { enabled: true, target: 'input:invalid' },
    },
  ],
});

tracker.mount({ sourceRoot: applicationForm });

let resetFrame = null;
let trackerRenderFrame = null;

/**
 * Schedules at most one application-driven Tracker render per animation frame.
 *
 * @returns {void}
 */
function scheduleTrackerRender() {
  if (trackerRenderFrame !== null) {
    return;
  }

  trackerRenderFrame = window.requestAnimationFrame(() => {
    trackerRenderFrame = null;
    tracker.render();
  });
}

/**
 * Schedules a render when the application is already showing validation feedback.
 *
 * @returns {void}
 */
function scheduleValidatedTrackerRender() {
  if (applicationForm.classList.contains('form-was-validated')) {
    scheduleTrackerRender();
  }
}

/**
 * Enables or disables a conditional section and synchronizes its disclosure state.
 * Disabled controls are excluded from native validation and form submission.
 *
 * @param {HTMLInputElement} toggle - Checkbox controlling the section.
 * @returns {void}
 */
function synchronizeConditionalSection(toggle) {
  const sectionId = toggle.getAttribute('aria-controls');
  const section = document.getElementById(sectionId);
  const fieldset = section.querySelector('fieldset');
  const shouldShow = toggle.checked;

  section.hidden = !shouldShow;
  fieldset.disabled = !shouldShow;
  toggle.setAttribute('aria-expanded', String(shouldShow));
}

/**
 * Updates every checkbox-controlled conditional section.
 *
 * @returns {void}
 */
function synchronizeAllConditionalSections() {
  applicationForm.querySelectorAll('input[type="checkbox"][aria-controls]').forEach((toggle) => {
    synchronizeConditionalSection(toggle);
  });
}

/**
 * Formats a Date as an ISO calendar date without applying a UTC conversion.
 *
 * @param {Date} date - Date to format.
 * @returns {string} Date formatted as YYYY-MM-DD.
 */
function formatLocalDate(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Synchronizes the minimum departure date with the selected arrival date.
 *
 * @returns {void}
 */
function synchronizeTravelDates() {
  departureDateInput.min = arrivalDateInput.value || arrivalDateInput.min;

  if (departureDateInput.value && departureDateInput.value < departureDateInput.min) {
    departureDateInput.value = '';
  }
}

/**
 * Initializes date constraints using the user's local calendar date.
 *
 * @returns {void}
 */
function initializeDateConstraints() {
  const today = new Date();
  const todayValue = formatLocalDate(today);
  const adultCutoff = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());

  birthDateInput.max = formatLocalDate(adultCutoff);
  arrivalDateInput.min = todayValue;
  departureDateInput.min = todayValue;
  signedDateInput.max = todayValue;
  signedDateInput.value = todayValue;
}

/**
 * Displays the current range value in the associated output element.
 *
 * @returns {void}
 */
function updateIntensityOutput() {
  intensityOutput.value = intensityInput.value;
  intensityOutput.textContent = intensityInput.value;
}

applicationForm.querySelectorAll('input[type="checkbox"][aria-controls]').forEach((toggle) => {
  toggle.addEventListener('change', () => {
    synchronizeConditionalSection(toggle);
    scheduleValidatedTrackerRender();
  });
});

intensityInput.addEventListener('input', updateIntensityOutput);
arrivalDateInput.addEventListener('change', () => {
  synchronizeTravelDates();
  scheduleValidatedTrackerRender();
});

// Native invalid events do not bubble, so the form observes them in the capture phase.
applicationForm.addEventListener(
  'invalid',
  () => {
    applicationForm.classList.add('form-was-validated');
    successMessage.hidden = true;
    scheduleTrackerRender();
  },
  true,
);

applicationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applicationForm.classList.add('form-was-validated');
  successMessage.hidden = false;
  successMessage.focus();
  scheduleTrackerRender();
});

applicationForm.addEventListener('reset', () => {
  if (resetFrame !== null) {
    window.cancelAnimationFrame(resetFrame);
  }

  if (trackerRenderFrame !== null) {
    window.cancelAnimationFrame(trackerRenderFrame);
    trackerRenderFrame = null;
  }

  resetFrame = window.requestAnimationFrame(() => {
    resetFrame = null;
    applicationForm.classList.remove('form-was-validated');
    successMessage.hidden = true;
    synchronizeAllConditionalSections();
    updateIntensityOutput();
    initializeDateConstraints();
    synchronizeTravelDates();
    scheduleTrackerRender();
  });
});

applicationForm.addEventListener('input', scheduleValidatedTrackerRender);

initializeDateConstraints();
synchronizeAllConditionalSections();
synchronizeTravelDates();
updateIntensityOutput();

window.addEventListener(
  'pagehide',
  () => {
    if (resetFrame !== null) {
      window.cancelAnimationFrame(resetFrame);
    }

    if (trackerRenderFrame !== null) {
      window.cancelAnimationFrame(trackerRenderFrame);
    }

    tracker.destroy();
  },
  { once: true },
);
