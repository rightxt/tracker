// eslint-disable-next-line import/no-unresolved -- Dependency is installed in this standalone demo consumer.
import WaveSurfer from 'wavesurfer.js';
// eslint-disable-next-line import/no-unresolved -- Dependency is installed in this standalone demo consumer.
import Timeline from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import './shared/base.css';
import './styles.css';

import { deriveQuestions, deriveReviewCandidates, formatDuration, parseSrt } from './caption-data.js';
import { AUDIO_PEAKS } from './waveform-peaks.js';

/** Local CC BY-SA audio fixture. */
const AUDIO_URL = new URL('../assets/WP351_-_Wikimedia_Futures_Lab,_Eva_Martin.mp3', import.meta.url).href;
/** Local timed-caption fixture corresponding to the recording. */
const SRT_URL = new URL('../assets/WP351_-_Wikimedia_Futures_Lab,_Eva_Martin.srt', import.meta.url).href;
/** Canonical duration of the bundled recording in seconds. */
const AUDIO_DURATION = 651.807371634569;
/** Timeline scales offered to the reader. */
const ZOOM_LEVELS = Object.freeze([
  { id: 'overview', label: '1×', pixelsPerSecond: 12 },
  { id: 'review', label: '2×', pixelsPerSecond: 24 },
  { id: 'detail', label: '4×', pixelsPerSecond: 48 },
]);
/** Standard MediaError code used when the browser cannot decode the local fixture. */
const MEDIA_SOURCE_NOT_SUPPORTED = 4;

/**
 * Supplies the two AudioBuffer prototype methods read by WaveSurfer's
 * predecoded-peaks path when a browser has HTML media but no Web Audio API.
 *
 * @returns {() => void} Idempotent restoration callback.
 */
function installWaveSurferAudioBufferCompatibility() {
  if (typeof globalThis.AudioBuffer === 'function') {
    return () => {};
  }

  class CompatibleAudioBuffer {
    /**
     * @param {Float32Array} destination Destination channel segment.
     * @param {number} channelNumber Source channel index.
     * @param {number} [startInChannel] Source offset.
     * @returns {void}
     */
    copyFromChannel(destination, channelNumber, startInChannel = 0) {
      const channel = this.getChannelData(channelNumber);
      destination.set(channel.subarray(startInChannel, startInChannel + destination.length));
    }

    /**
     * @param {Float32Array} source Source channel segment.
     * @param {number} channelNumber Destination channel index.
     * @param {number} [startInChannel] Destination offset.
     * @returns {void}
     */
    copyToChannel(source, channelNumber, startInChannel = 0) {
      this.getChannelData(channelNumber).set(source, startInChannel);
    }

    /**
     * @param {number} channelNumber Requested channel index.
     * @returns {Float32Array} Unsupported direct instance channel access.
     */
    getChannelData(channelNumber) {
      throw new Error(`CompatibleAudioBuffer instances do not own channel ${String(channelNumber)} data.`);
    }
  }

  Object.defineProperty(globalThis, 'AudioBuffer', {
    configurable: true,
    value: CompatibleAudioBuffer,
  });
  let installed = true;
  return () => {
    if (installed && globalThis.AudioBuffer === CompatibleAudioBuffer) {
      Reflect.deleteProperty(globalThis, 'AudioBuffer');
    }
    installed = false;
  };
}

/** @param {string} id Required element ID. @returns {HTMLElement} Element. */
function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Audio review is missing #${id}.`);
  }
  return element;
}
/** Source lane containing caption, question, and review annotations. */
const annotationLanes = requireElement('annotation-lanes');
/** Count of parsed timed-caption cues. */
const captionCount = requireElement('caption-count');
/** Selected candidate's explanatory copy. */
const itemDescription = requireElement('item-details-description');
/** Selected candidate's heading, or the pre-selection prompt. */
const itemDetails = requireElement('item-details-title');
/** Selected candidate's review category. */
const itemKind = requireElement('item-details-kind');
/** Selected candidate's lifecycle state. */
const itemStatus = requireElement('item-details-status');
/** Selected candidate's temporal range. */
const itemTime = requireElement('item-details-time');
/** Selected candidate's source caption context. */
const itemTranscript = requireElement('item-details-transcript');
/** Status region for fixture and media loading outcomes. */
const loadingStatus = requireElement('loading-status');
/** Count of candidates remaining open for review. */
const openCount = requireElement('open-count');
/** Compact open-review count in the overview heading. */
const overviewOpenCount = requireElement('overview-open-count');
/** Media playback toggle. */
const playButton = /** @type {HTMLButtonElement} */ (requireElement('play-button'));
/** Count of non-interactive question-context markers. */
const questionCount = requireElement('question-count');
/** Static total-duration readout for the recording. */
const recordingDuration = requireElement('recording-duration');
/** Count of candidates already reviewed. */
const reviewedCount = requireElement('reviewed-count');
/** Control that toggles the selected candidate review state. */
const reviewStatusButton = /** @type {HTMLButtonElement} */ (requireElement('review-status-button'));
/** Live playback time and rounded total-duration readout. */
const timeDisplay = /** @type {HTMLOutputElement} */ (requireElement('time-display'));
/** Width-controlled inner timeline used for application zoom. */
const timelineContent = requireElement('timeline-content');
/** Horizontal source viewport and Tracker scroll root. */
const timelineScroller = requireElement('timeline-scroller');
/** Render host for the independent Tracker DOM. */
const trackerHost = requireElement('tracker-host');
/** WaveSurfer mount target. */
const waveform = requireElement('waveform');
/** Controls for selecting an application-owned timeline scale. */
const zoomOptions = requireElement('zoom-options');

/** Mutable recipe state shared by source annotations, media events, and Tracker. */
const state = {
  audioReady: false,
  audioUnavailable: false,
  captions: [],
  captionsReady: false,
  duration: AUDIO_DURATION,
  questions: [],
  reviewCandidates: [],
  selectedId: null,
  tracker: null,
  zoomId: 'overview',
  zoomFrame: null,
};
/** WaveSurfer instance, created once after the static controls are ready. */
let wavesurfer = null;

/** @param {number} value Seconds. @returns {string} Clock time. */
function formatTime(value) {
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

/** @param {number} value Recording duration in seconds. @returns {string} Rounded total duration. */
function formatTotalDuration(value) {
  return formatTime(Math.round(value));
}
/** @returns {object} Current zoom definition. */
function currentZoom() {
  const zoom = ZOOM_LEVELS.find((candidate) => candidate.id === state.zoomId);
  if (!zoom) {
    throw new Error('Unknown audio-review zoom.');
  }
  return zoom;
}
/** @param {HTMLElement} element Target. @param {number} start Start seconds. @param {number} end End seconds. @returns {void} */
function positionRange(element, start, end) {
  element.style.left = `${(start / state.duration) * 100}%`;
  element.style.width = `${Math.max(0, ((end - start) / state.duration) * 100)}%`;
}
/** @param {HTMLElement} element Target. @param {number} time Seconds. @returns {void} */
function positionPoint(element, time) {
  element.style.left = `${(time / state.duration) * 100}%`;
}
/** @param {object} candidate Candidate. @returns {string} Accessible Tracker label. */
function candidateLabel(candidate) {
  return `${candidate.title} · ${formatDuration(candidate.endTime - candidate.startTime)}`;
}

/** @returns {void} Updates all application-owned counts. */
function updateSummary() {
  const open = state.reviewCandidates.filter((candidate) => candidate.status === 'open').length;
  captionCount.textContent = String(state.captions.length);
  questionCount.textContent = String(state.questions.length);
  openCount.textContent = String(open);
  reviewedCount.textContent = String(state.reviewCandidates.length - open);
  overviewOpenCount.textContent = `${open} remaining`;
}

/** @returns {void} Updates selected source styling. */
function updateSelection() {
  annotationLanes
    .querySelectorAll('[data-review-id]')
    .forEach((element) => element.setAttribute('aria-current', String(element.dataset.reviewId === state.selectedId)));
}
/** @param {object} candidate Candidate. @param {boolean} center Whether application should center this source. @returns {void} */
function selectCandidate(candidate, center) {
  state.selectedId = candidate.id;
  updateSelection();
  itemDetails.textContent = candidate.title;
  itemTime.textContent = `${formatTime(candidate.startTime)}–${formatTime(candidate.endTime)} · ${formatDuration(candidate.endTime - candidate.startTime)}`;
  itemDescription.textContent = candidate.description;
  itemTranscript.hidden = false;
  itemTranscript.textContent = candidate.transcript;
  itemKind.hidden = false;
  itemKind.textContent = candidate.kind.replace('-', ' ');
  itemStatus.hidden = false;
  itemStatus.textContent = candidate.status;
  itemStatus.dataset.status = candidate.status;
  reviewStatusButton.hidden = false;
  reviewStatusButton.textContent = candidate.status === 'open' ? 'Mark reviewed' : 'Reopen review';
  const source = annotationLanes.querySelector(`[data-review-id="${CSS.escape(candidate.id)}"]`);
  if (center && source instanceof HTMLElement) {
    centerTimelineElement(source);
  }
  if (state.audioReady) {
    wavesurfer?.setTime(candidate.startTime);
  }
}
/** @param {HTMLElement} element Timeline source. @returns {void} */
function centerTimelineElement(element) {
  const target = element.offsetLeft + element.offsetWidth / 2 - timelineScroller.clientWidth / 2;
  timelineScroller.scrollTo({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    left: Math.max(0, Math.min(timelineScroller.scrollWidth - timelineScroller.clientWidth, target)),
  });
}

/** @param {object} cue Caption cue. @returns {HTMLElement} Caption context element. */
function createCaption(cue) {
  const segment = document.createElement('span');
  segment.className = 'timeline-item caption-segment';
  segment.title = `Caption #${cue.index}: ${cue.text}`;
  positionRange(segment, cue.startTime, cue.endTime);
  return segment;
}
/** @param {object} cue Question cue. @returns {HTMLSpanElement} Non-interactive question context marker. */
function createQuestion(cue) {
  const marker = document.createElement('span');
  marker.className = 'timeline-item question-marker';
  marker.dataset.questionIndex = String(cue.index);
  marker.setAttribute('aria-hidden', 'true');
  marker.title = `Question at ${formatTime(cue.startTime)}: ${cue.text}`;
  positionPoint(marker, cue.startTime);
  return marker;
}
/** @param {object} candidate Review candidate. @returns {HTMLButtonElement} Review source. */
function createReviewCandidate(candidate) {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'timeline-item review-candidate';
  marker.dataset.reviewId = candidate.id;
  marker.dataset.reviewKind = candidate.kind;
  marker.dataset.status = candidate.status;
  marker.tabIndex = 0;
  marker.setAttribute('aria-label', `${candidateLabel(candidate)}, ${candidate.status}`);
  marker.title = marker.getAttribute('aria-label') ?? '';
  if (candidate.kind === 'short-caption') {
    positionPoint(marker, candidate.startTime);
  } else {
    positionRange(marker, candidate.startTime, candidate.endTime);
  }
  return marker;
}
/** @returns {void} Renders source timeline annotations before Tracker mount. */
function renderAnnotations() {
  const fragment = document.createDocumentFragment();
  state.captions.forEach((cue) => fragment.append(createCaption(cue)));
  state.questions.forEach((cue) => fragment.append(createQuestion(cue)));
  state.reviewCandidates.forEach((candidate) => fragment.append(createReviewCandidate(candidate)));
  annotationLanes.replaceChildren(fragment);
  updateSummary();
}

/** @returns {void} Mounts Tracker after all source data and geometry are ready. */
function mountTracker() {
  if (state.tracker || (!state.audioReady && !state.audioUnavailable) || !state.captionsReady) {
    return;
  }
  const tracker = new Tracker({
    options: {
      a11y: { enabled: true, keyboard: true, label: 'Open caption review candidates across the recording' },
      clustering: { enabled: true, threshold: 1.8 },
      orientation: 'horizontal',
      placement: 'bottom',
      track: { className: 'audio-review-tracker' },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: true },
        scroll: { enabled: true },
      },
      viewport: { enabled: true },
    },
    rules: [
      {
        focus: { enabled: true },
        label: (element) =>
          candidateLabel(
            state.reviewCandidates.find((candidate) => candidate.id === element.dataset.reviewId) ?? {
              endTime: 0,
              startTime: 0,
              title: 'Review candidate',
            },
          ),
        marker: {
          className: 'audio-review-marker-pause',
          cssVariables: { '--rxtt-marker-bg': '#7557c7' },
          title: true,
        },
        scroll: { align: 'center', behavior: 'auto' },
        selector: ".review-candidate[data-status='open'][data-review-kind='long-pause']",
      },
      {
        focus: { enabled: true },
        label: (element) =>
          candidateLabel(
            state.reviewCandidates.find((candidate) => candidate.id === element.dataset.reviewId) ?? {
              endTime: 0,
              startTime: 0,
              title: 'Review candidate',
            },
          ),
        marker: { className: 'audio-review-marker-long', cssVariables: { '--rxtt-marker-bg': '#b7791f' }, title: true },
        scroll: { align: 'center', behavior: 'auto' },
        selector: ".review-candidate[data-status='open'][data-review-kind='long-caption']",
      },
      {
        focus: { enabled: true },
        label: (element) =>
          candidateLabel(
            state.reviewCandidates.find((candidate) => candidate.id === element.dataset.reviewId) ?? {
              endTime: 0,
              startTime: 0,
              title: 'Review candidate',
            },
          ),
        marker: {
          className: 'audio-review-marker-short',
          cssVariables: { '--rxtt-marker-bg': '#c63f3f' },
          title: true,
        },
        scroll: { align: 'center', behavior: 'auto' },
        selector: ".review-candidate[data-status='open'][data-review-kind='short-caption']",
      },
    ],
  });
  tracker.on('marker:activate', ({ element }) => {
    const candidate = state.reviewCandidates.find((item) => item.id === element.dataset.reviewId);
    if (candidate) {
      selectCandidate(candidate, false);
    }
  });
  tracker.on('cluster:activate', ({ primaryMarker }) => {
    const candidate = state.reviewCandidates.find((item) => item.id === primaryMarker.element.dataset.reviewId);
    if (candidate) {
      selectCandidate(candidate, false);
    }
  });
  tracker.mount({ renderHost: trackerHost, scrollRoot: timelineScroller, sourceRoot: timelineScroller });
  state.tracker = tracker;
}

/** @param {boolean} preserveCenter Whether zoom should retain temporal center. @returns {void} */
function applyTimelineWidth(preserveCenter) {
  const previousWidth = timelineContent.getBoundingClientRect().width;
  const centerRatio =
    previousWidth > 0 ? (timelineScroller.scrollLeft + timelineScroller.clientWidth / 2) / previousWidth : 0;
  const nextWidth = Math.max(timelineScroller.clientWidth, state.duration * currentZoom().pixelsPerSecond);
  timelineContent.style.width = `${Math.round(nextWidth)}px`;
  if (state.zoomFrame !== null) {
    cancelAnimationFrame(state.zoomFrame);
  }
  state.zoomFrame = requestAnimationFrame(() => {
    state.zoomFrame = null;
    if (preserveCenter) {
      timelineScroller.scrollLeft = Math.max(
        0,
        Math.min(nextWidth - timelineScroller.clientWidth, centerRatio * nextWidth - timelineScroller.clientWidth / 2),
      );
    }
    state.tracker?.requestRender();
  });
}
/** @returns {void} Renders zoom UI. */
function renderZoomOptions() {
  const fragment = document.createDocumentFragment();
  ZOOM_LEVELS.forEach((zoom) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.zoomId = zoom.id;
    button.textContent = zoom.label;
    button.setAttribute('aria-pressed', String(zoom.id === state.zoomId));
    button.title = `${zoom.pixelsPerSecond} pixels per second`;
    fragment.append(button);
  });
  zoomOptions.replaceChildren(fragment);
}

/** @returns {Promise<object[]>} Parsed local timed-caption cues. */
async function loadCaptions() {
  const response = await fetch(SRT_URL);
  if (!response.ok) {
    throw new Error(`SRT request failed with HTTP ${response.status}.`);
  }
  const captions = parseSrt(await response.text());
  if (captions.length === 0) {
    throw new Error('The SRT did not contain parseable cues.');
  }
  return captions;
}
/** @returns {Promise<void>} Loads source annotations and mounts Tracker when media geometry is available. */
async function initializeCaptions() {
  try {
    state.captions = await loadCaptions();
    state.questions = deriveQuestions(state.captions);
    state.reviewCandidates = deriveReviewCandidates(state.captions);
    state.captionsReady = true;
    renderAnnotations();
    applyTimelineWidth(false);
    mountTracker();
    reportReadyStatus();
  } catch (error) {
    console.error(error);
    setStatus('error', 'Could not load or parse the local timed-caption fixture. Tracker was not mounted.');
  }
}
/** @param {'ready' | 'error'} status Status presentation state. @param {string} message Reader-facing status. @returns {void} */
function setStatus(status, message) {
  loadingStatus.dataset.state = status;
  loadingStatus.textContent = message;
}
/** @returns {void} Reports caption readiness and any recoverable playback limitation. */
function reportReadyStatus() {
  if (!state.captionsReady) {
    return;
  }
  const playbackStatus = state.audioUnavailable
    ? ' Audio playback is unavailable in this browser; the caption-review timeline remains fully usable.'
    : '';
  setStatus(
    'ready',
    `Loaded ${state.captions.length} real timed captions and ${state.reviewCandidates.length} timing-review candidates.${playbackStatus}`,
  );
}

annotationLanes.addEventListener('click', (event) => {
  const candidateId =
    event.target instanceof Element ? event.target.closest('[data-review-id]')?.dataset.reviewId : undefined;
  const candidate = candidateId ? state.reviewCandidates.find((item) => item.id === candidateId) : null;
  if (candidate) {
    selectCandidate(candidate, true);
  }
});
reviewStatusButton.addEventListener('click', () => {
  const candidate = state.reviewCandidates.find((item) => item.id === state.selectedId);
  if (!candidate) {
    return;
  }
  candidate.status = candidate.status === 'open' ? 'reviewed' : 'open';
  const source = annotationLanes.querySelector(`[data-review-id="${CSS.escape(candidate.id)}"]`);
  if (source instanceof HTMLElement) {
    source.dataset.status = candidate.status;
    source.setAttribute('aria-label', `${candidateLabel(candidate)}, ${candidate.status}`);
  }
  updateSummary();
  selectCandidate(candidate, false);
  state.tracker?.requestRender();
});
zoomOptions.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-zoom-id]') : null;
  if (!(button instanceof HTMLButtonElement) || button.dataset.zoomId === state.zoomId) {
    return;
  }
  state.zoomId = button.dataset.zoomId ?? state.zoomId;
  zoomOptions
    .querySelectorAll('button')
    .forEach((control) => control.setAttribute('aria-pressed', String(control === button)));
  applyTimelineWidth(true);
});
playButton.addEventListener('click', async () => {
  try {
    await wavesurfer?.playPause();
  } catch (error) {
    console.error(error);
    setStatus('error', 'Playback could not start.');
  }
});

renderZoomOptions();
applyTimelineWidth(false);
/** Application-owned media element that defers MP3 transfer until playback. */
const audio = document.createElement('audio');
audio.preload = 'none';
const restoreAudioBuffer = installWaveSurferAudioBufferCompatibility();
try {
  wavesurfer = WaveSurfer.create({
    container: waveform,
    cursorColor: '#172033',
    cursorWidth: 2,
    dragToSeek: true,
    duration: AUDIO_DURATION,
    fillParent: true,
    height: 180,
    hideScrollbar: true,
    interact: true,
    media: audio,
    normalize: true,
    peaks: AUDIO_PEAKS,
    plugins: [Timeline.create({ height: 24 })],
    progressColor: '#335cff',
    url: AUDIO_URL,
    waveColor: '#98a2b3',
  });
} catch (error) {
  restoreAudioBuffer();
  throw error;
}
wavesurfer.on('ready', (duration) => {
  restoreAudioBuffer();
  state.duration = duration;
  state.audioReady = true;
  state.audioUnavailable = false;
  recordingDuration.textContent = formatTotalDuration(duration);
  playButton.disabled = false;
  applyTimelineWidth(false);
  mountTracker();
  reportReadyStatus();
});
wavesurfer.on('timeupdate', (time) => {
  timeDisplay.value = `${formatTime(time)} / ${formatTotalDuration(state.duration)}`;
  timeDisplay.textContent = timeDisplay.value;
});
wavesurfer.on('play', () => {
  playButton.textContent = 'Pause';
});
wavesurfer.on('pause', () => {
  playButton.textContent = 'Play';
});
wavesurfer.on('finish', () => {
  playButton.textContent = 'Play';
});
wavesurfer.on('error', (error) => {
  restoreAudioBuffer();
  if (error instanceof MediaError && error.code === MEDIA_SOURCE_NOT_SUPPORTED) {
    state.audioUnavailable = true;
    applyTimelineWidth(false);
    mountTracker();
    reportReadyStatus();
    return;
  }
  console.error(error);
  setStatus('error', 'Could not load the local audio fixture.');
});
void initializeCaptions();
window.addEventListener(
  'pagehide',
  () => {
    if (state.zoomFrame !== null) {
      cancelAnimationFrame(state.zoomFrame);
    }
    restoreAudioBuffer();
    state.tracker?.destroy();
    audio.pause();
    wavesurfer?.destroy();
    audio.removeAttribute('src');
    audio.load();
  },
  { once: true },
);
