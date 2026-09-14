import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import './shared/base.css';
import './styles.css';

import { createActivityGenerator, needsAttention } from './activity-generator.js';

/** Number of deterministic events appended by the burst control. */
const BURST_EVENT_COUNT = 40;
/** Tail distance at which the reader is treated as following live activity. */
const FOLLOW_LATEST_THRESHOLD_PX = 96;
/** Maximum retained events before generation is temporarily suspended. */
const HARD_EVENT_LIMIT = 900;
/** Cadence of deterministic live updates. */
const LIVE_INTERVAL_MS = 5_000;
/** Event count that triggers safe prefix retention. */
const MAX_EVENT_COUNT = 600;
/** Extra events retained before the reader's visible anchor. */
const PRUNE_SAFETY_BUFFER = 12;
/** Seed that makes the full demo sequence repeatable. */
const RANDOM_SEED = 20_260_829;
/** Target history size after a safe retention pass. */
const TRIM_TO_EVENT_COUNT = 450;

/**
 * @typedef {object} ActivityEvent
 * @property {boolean} acknowledged Whether actionable work was acknowledged.
 * @property {string} actor Synthetic actor name.
 * @property {string} context Event context.
 * @property {number} id Stable application-owned identifier.
 * @property {string} kind Event category.
 * @property {string} message Event message.
 * @property {'none' | 'attention' | 'critical'} signal Attention state.
 * @property {number} timestamp Event time in milliseconds.
 * @property {boolean} unread Whether the event is unread.
 */

/** @param {string} id Required element ID. @returns {HTMLElement} Matching element. */
function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Activity stream is missing #${id}.`);
  }
  return element;
}

/** Ordered list containing the retained application event sources. */
const activityList = /** @type {HTMLOListElement} */ (requireElement('activity-list'));
/** Independent scroll viewport for the activity stream and Tracker source root. */
const activityScroller = requireElement('activity-scroller');
/** Counter for unresolved attention work. */
const attentionCount = requireElement('attention-count');
/** Control that appends a deterministic burst. */
const burstButton = /** @type {HTMLButtonElement} */ (requireElement('burst-button'));
/** Visual live-state indicator. */
const liveDot = requireElement('live-dot');
/** Textual live-state indicator. */
const liveLabel = requireElement('live-label');
/** Control that clears only the unread application state. */
const markAllReadButton = /** @type {HTMLButtonElement} */ (requireElement('mark-all-read-button'));
/** Control that returns the reader to the latest retained event. */
const newEventsButton = /** @type {HTMLButtonElement} */ (requireElement('new-events-button'));
/** Container hidden while there are no unseen incoming events. */
const newEventsDock = requireElement('new-events-dock');
/** Control that pauses or resumes live generation. */
const pauseButton = /** @type {HTMLButtonElement} */ (requireElement('pause-button'));
/** Counter for all retained application events. */
const retainedCount = requireElement('retained-count');
/** Reader-facing retention and safety-limit status. */
const retentionStatus = requireElement('retention-status');
/** Render host for the independent Tracker DOM. */
const trackerHost = requireElement('tracker-host');
/** Counter for unread application events. */
const unreadCount = requireElement('unread-count');

/** Deterministic event source for initial history and live updates. */
const generator = createActivityGenerator(RANDOM_SEED);
/** Tracker that represents only unresolved attention items. */
const tracker = createTracker();
/** Mutable activity, retention, and live-update state. */
const state = {
  events: /** @type {ActivityEvent[]} */ ([]),
  liveEnabled: true,
  pendingNewEvents: 0,
  retentionSuspended: false,
};

/** @param {string} actor Synthetic actor name. @returns {string} Avatar initials. */
function getInitials(actor) {
  return actor
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** @param {number} timestamp Event time. @returns {string} Local clock time. */
function formatClockTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    timestamp,
  );
}

/** @param {ActivityEvent} event Event model. @returns {'acknowledge' | 'mark-read' | null} Visible event action. */
function getEventAction(event) {
  if (needsAttention(event)) {
    return 'acknowledge';
  }
  return event.unread ? 'mark-read' : null;
}

/** @param {ActivityEvent} event Event model. @returns {HTMLLIElement} Rendered list item. */
function createEventElement(event) {
  const item = document.createElement('li');
  const avatar = document.createElement('span');
  const main = document.createElement('div');
  const heading = document.createElement('div');
  const message = document.createElement('p');
  const time = document.createElement('time');
  const metadata = document.createElement('div');
  const context = document.createElement('span');

  item.className = 'activity-event';
  item.dataset.acknowledged = String(event.acknowledged);
  item.dataset.eventId = String(event.id);
  item.dataset.signal = event.signal;
  item.dataset.unread = String(event.unread);
  item.tabIndex = -1;
  avatar.className = 'activity-event__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = getInitials(event.actor);
  main.className = 'activity-event__main';
  heading.className = 'activity-event__heading';
  message.className = 'activity-event__message';
  message.textContent = event.message;
  time.className = 'activity-event__time';
  time.dateTime = new Date(event.timestamp).toISOString();
  time.textContent = formatClockTime(event.timestamp);
  heading.append(message, time);
  metadata.className = 'activity-event__metadata';
  context.className = 'activity-event__context';
  context.textContent = `${event.kind} · ${event.context}`;
  metadata.append(context);

  if (event.unread) {
    metadata.append(createBadge('Unread', 'unread'));
  }
  if (event.signal !== 'none') {
    metadata.append(
      createBadge(
        needsAttention(event) ? event.signal : 'Acknowledged',
        needsAttention(event) ? event.signal : 'acknowledged',
      ),
    );
  }

  main.append(heading, metadata);
  item.append(avatar, main);
  const action = getEventAction(event);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `activity-event__action${action === 'acknowledge' ? ` activity-event__action--${event.signal}` : ''}`;
    button.dataset.action = action;
    button.textContent = action === 'acknowledge' ? 'Acknowledge' : 'Mark read';
    item.append(button);
  }
  return item;
}

/** @param {string} text Badge copy. @param {string} tone Semantic style tone. @returns {HTMLSpanElement} Badge. */
function createBadge(text, tone) {
  const badge = document.createElement('span');
  badge.className = `activity-badge activity-badge--${tone}`;
  badge.textContent = text;
  return badge;
}

/** @param {ActivityEvent[]} events Event models. @returns {DocumentFragment} Event DOM. */
function createEventFragment(events) {
  const fragment = document.createDocumentFragment();
  events.forEach((event) => fragment.append(createEventElement(event)));
  return fragment;
}

/** @returns {number} Current distance from the stream tail. */
function getBottomDistance() {
  return activityScroller.scrollHeight - activityScroller.clientHeight - activityScroller.scrollTop;
}

/** @returns {boolean} Whether the reader is following the stream tail. */
function isNearBottom() {
  return getBottomDistance() <= FOLLOW_LATEST_THRESHOLD_PX;
}

/** @returns {void} Moves the independent stream viewport to its tail. */
function scrollToLatest() {
  activityScroller.scrollTop = activityScroller.scrollHeight;
}

/** @returns {HTMLLIElement | null} First retained event that intersects the viewport. */
function getFirstVisibleEvent() {
  const scrollerTop = activityScroller.getBoundingClientRect().top;
  return (
    Array.from(activityList.children).find((child) => child.getBoundingClientRect().bottom > scrollerTop + 1) ?? null
  );
}

/** @returns {void} Updates application-owned counters. */
function updateSummary() {
  retainedCount.textContent = String(state.events.length);
  unreadCount.textContent = String(state.events.filter((event) => event.unread).length);
  attentionCount.textContent = String(state.events.filter(needsAttention).length);
}

/** @returns {void} Updates the user-controlled live state presentation. */
function updateLiveState() {
  const paused = !state.liveEnabled;
  liveDot.dataset.paused = String(paused);
  liveLabel.textContent = paused ? 'Live updates paused' : 'Live updates on';
  pauseButton.textContent = paused ? 'Resume live updates' : 'Pause live updates';
}

/** @returns {void} Updates the separate new-events control. */
function updateNewEventsControl() {
  newEventsDock.hidden = state.pendingNewEvents === 0;
  newEventsButton.textContent = `↓ ${state.pendingNewEvents} new ${state.pendingNewEvents === 1 ? 'event' : 'events'}`;
}

/** @returns {void} Updates retention and hard-limit feedback. */
function updateRetentionStatus() {
  retentionStatus.dataset.retentionSuspended = String(state.retentionSuspended);
  if (state.retentionSuspended) {
    retentionStatus.textContent =
      'Live generation is paused at the 900-event safety ceiling until retained history can be pruned safely.';
  } else {
    retentionStatus.textContent = 'Retention target: keep about 450 events after crossing 600.';
  }
  burstButton.disabled = state.retentionSuspended && state.events.length >= HARD_EVENT_LIMIT;
}

/** @param {ActivityEvent} event Changed event. @returns {void} Replaces exactly one rendered event. */
function rerenderEvent(event) {
  const current = activityList.querySelector(`[data-event-id="${event.id}"]`);
  if (current instanceof HTMLLIElement) {
    current.replaceWith(createEventElement(event));
  }
}

/**
 * Removes an old prefix, retaining the visible anchor and its safety buffer where possible.
 *
 * @param {boolean} followingLatest Tail-following state captured before a transaction.
 * @returns {number} Number of pruned models.
 */
function pruneOldEvents(followingLatest) {
  if (state.events.length <= MAX_EVENT_COUNT) {
    return 0;
  }
  const desiredRemoval = state.events.length - TRIM_TO_EVENT_COUNT;
  let removable = desiredRemoval;
  let anchor = null;
  let anchorTopBefore = 0;

  if (!followingLatest) {
    anchor = getFirstVisibleEvent();
    if (!anchor) {
      return 0;
    }
    const anchorIndex = state.events.findIndex((event) => event.id === Number(anchor.dataset.eventId));
    removable = Math.min(desiredRemoval, Math.max(0, anchorIndex - PRUNE_SAFETY_BUFFER));
    if (removable === 0) {
      return 0;
    }
    anchorTopBefore = anchor.getBoundingClientRect().top - activityScroller.getBoundingClientRect().top;
  }

  state.events.splice(0, removable);
  for (let index = 0; index < removable; index += 1) {
    activityList.firstElementChild?.remove();
  }
  if (anchor) {
    const anchorTopAfter = anchor.getBoundingClientRect().top - activityScroller.getBoundingClientRect().top;
    activityScroller.scrollTop += anchorTopAfter - anchorTopBefore;
  }
  state.retentionSuspended = false;
  return removable;
}

/** @returns {void} Schedules one public Tracker synchronization for one completed application transaction. */
function synchronizeTracker() {
  tracker.requestRender();
}

/** @param {ActivityEvent[]} batch New events generated by one application transaction. @returns {number} Appended event count. */
function appendBatch(batch) {
  if (state.retentionSuspended && state.events.length >= HARD_EVENT_LIMIT) {
    return 0;
  }
  const followingLatest = isNearBottom();
  const available = Math.max(0, HARD_EVENT_LIMIT - state.events.length);
  const appended = batch.slice(0, available);
  if (appended.length === 0) {
    return 0;
  }
  state.events.push(...appended);
  activityList.append(createEventFragment(appended));
  const pruned = pruneOldEvents(followingLatest);
  if (state.events.length >= HARD_EVENT_LIMIT && pruned === 0) {
    state.retentionSuspended = true;
  }
  if (followingLatest) {
    state.pendingNewEvents = 0;
    scrollToLatest();
  } else {
    state.pendingNewEvents += appended.length;
  }
  updateSummary();
  updateNewEventsControl();
  updateRetentionStatus();
  synchronizeTracker();
  return appended.length;
}

/** @returns {void} Handles a normal live tick. */
function handleLiveTick() {
  if (state.liveEnabled && !state.retentionSuspended) {
    appendBatch(generator.createLiveBatch());
  }
}

/** @param {MouseEvent} event Delegated activity action. @returns {void} Applies one event action. */
function handleEventAction(event) {
  const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  const item = button?.closest('.activity-event');
  if (!(button instanceof HTMLButtonElement) || !(item instanceof HTMLLIElement)) {
    return;
  }
  const model = state.events.find((candidate) => candidate.id === Number(item.dataset.eventId));
  if (!model) {
    return;
  }
  if (button.dataset.action === 'acknowledge') {
    model.acknowledged = true;
    model.unread = false;
  } else if (button.dataset.action === 'mark-read') {
    model.unread = false;
  } else {
    return;
  }
  rerenderEvent(model);
  updateSummary();
  synchronizeTracker();
}

/** @returns {void} Marks retained application events as read without changing Tracker scope. */
function markAllRead() {
  state.events
    .filter((event) => event.unread)
    .forEach((event) => {
      event.unread = false;
      rerenderEvent(event);
    });
  updateSummary();
  synchronizeTracker();
}

/** @returns {void} Handles stream scrolling and resumes safe retention at the tail. */
function handleScroll() {
  if (state.pendingNewEvents > 0 && isNearBottom()) {
    state.pendingNewEvents = 0;
    updateNewEventsControl();
  }
  if (state.retentionSuspended && isNearBottom() && pruneOldEvents(true) > 0) {
    updateSummary();
    updateRetentionStatus();
    synchronizeTracker();
  }
}

/** @returns {void} Returns the reader to the latest retained activity. */
function jumpToLatest() {
  state.pendingNewEvents = 0;
  scrollToLatest();
  updateNewEventsControl();
}

/** @returns {Tracker} Configured Tracker instance. */
function createTracker() {
  return new Tracker({
    options: {
      a11y: { enabled: true, keyboard: true, label: 'Unresolved activity overview' },
      clustering: { enabled: true, threshold: 1.25 },
      orientation: 'vertical',
      placement: 'right',
      track: { className: 'activity-tracker' },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: true },
        scroll: { enabled: true },
      },
      viewport: { className: 'activity-tracker__viewport', enabled: true },
    },
    rules: [
      {
        focus: { enabled: true },
        label: (element) =>
          `Attention: ${element.querySelector('.activity-event__message')?.textContent ?? 'Unresolved activity'}`,
        marker: {
          className: 'activity-tracker__marker--attention',
          cssVariables: { '--rxtt-marker-bg': '#b7791f' },
          title: true,
        },
        scroll: { align: 'center', behavior: 'auto' },
        selector: '.activity-event[data-signal="attention"][data-acknowledged="false"]',
      },
      {
        focus: { enabled: true },
        label: (element) =>
          `Critical: ${element.querySelector('.activity-event__message')?.textContent ?? 'Unresolved activity'}`,
        marker: {
          className: 'activity-tracker__marker--critical',
          cssVariables: { '--rxtt-marker-bg': '#c63f3f' },
          title: true,
        },
        scroll: { align: 'center', behavior: 'auto' },
        selector: '.activity-event[data-signal="critical"][data-acknowledged="false"]',
      },
    ],
  });
}

state.events = generator.createInitialHistory();
activityList.append(createEventFragment(state.events));
updateSummary();
updateLiveState();
updateNewEventsControl();
updateRetentionStatus();
scrollToLatest();
tracker.mount({ renderHost: trackerHost, scrollRoot: activityScroller, sourceRoot: activityScroller });

pauseButton.addEventListener('click', () => {
  state.liveEnabled = !state.liveEnabled;
  updateLiveState();
});
burstButton.addEventListener('click', () => {
  appendBatch(generator.createLiveBatch(BURST_EVENT_COUNT));
});
markAllReadButton.addEventListener('click', markAllRead);
newEventsButton.addEventListener('click', jumpToLatest);
activityList.addEventListener('click', handleEventAction);
activityScroller.addEventListener('scroll', handleScroll, { passive: true });
/** Interval handle cleared when the demo page is discarded. */
const liveIntervalId = window.setInterval(handleLiveTick, LIVE_INTERVAL_MS);
window.addEventListener(
  'pagehide',
  () => {
    window.clearInterval(liveIntervalId);
    tracker.destroy();
  },
  { once: true },
);
