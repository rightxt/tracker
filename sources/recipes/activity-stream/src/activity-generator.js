/** @typedef {'none' | 'attention' | 'critical'} EventSignal */

/**
 * @typedef {object} ActivityEvent
 * @property {number} id Stable application-owned identifier.
 * @property {number} timestamp Event time in milliseconds.
 * @property {string} message Human-readable activity message.
 * @property {string} context Product or service context.
 * @property {string} actor Synthetic actor name.
 * @property {string} kind Activity category.
 * @property {EventSignal} signal Attention state.
 * @property {boolean} unread Whether the event is unread in the application.
 * @property {boolean} acknowledged Whether an actionable event was acknowledged.
 */

/** Synthetic branch names used by deploy and merge messages. */
const BRANCHES = Object.freeze([
  'main',
  'feature/payment-retry',
  'feature/search-ranking',
  'fix/session-refresh',
  'release/next',
]);
/** Deployment environments used by synthetic events. */
const ENVIRONMENTS = Object.freeze(['staging', 'production']);
/** Initial retained history size before live updates start. */
const INITIAL_EVENT_COUNT = 300;
/** Synthetic people used as event actors. */
const PEOPLE = Object.freeze([
  'Alice Martin',
  'Noah Wilson',
  'Emma Clark',
  'Maya Patel',
  'Leo Anders',
  'Sofia Chen',
  'Daniel Brooks',
  'Nina Garcia',
  'Owen Price',
  'Priya Shah',
  'Lucas Meyer',
  'Ava Thompson',
]);
/** Project names used by synthetic events. */
const PROJECTS = Object.freeze(['storefront', 'gateway', 'dashboard', 'mobile-app', 'worker', 'tracker']);
/** Service names used by synthetic events. */
const SERVICES = Object.freeze(['api', 'auth', 'billing', 'search', 'checkout', 'catalog']);

/**
 * Creates a deterministic pseudo-random generator.
 *
 * @param {number} seed Integer seed.
 * @returns {() => number} Function returning numbers in `[0, 1)`.
 */
function createRandom(seed) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Returns whether an event belongs in the unresolved-work overview.
 *
 * @param {ActivityEvent} event Activity event.
 * @returns {boolean} Whether attention remains unresolved.
 */
function needsAttention(event) {
  return event.signal !== 'none' && !event.acknowledged;
}

/**
 * Creates the deterministic synthetic activity domain.
 *
 * @param {number} seed Seed for the complete generated sequence.
 * @returns {{ createInitialHistory: () => ActivityEvent[], createLiveBatch: (count?: number) => ActivityEvent[] }} Event generators.
 */
function createActivityGenerator(seed) {
  const random = createRandom(seed);
  let lastTimestamp = Date.now();
  let nextId = 1;

  /** @template T @param {readonly T[]} values Candidate values. @returns {T} Chosen value. */
  function pick(values) {
    return values[Math.floor(random() * values.length)];
  }

  /** @param {number} min Inclusive lower bound. @param {number} max Inclusive upper bound. @returns {number} Integer. */
  function randomInteger(min, max) {
    return Math.floor(random() * (max - min + 1)) + min;
  }

  /** @returns {string} Synthetic semantic version. */
  function randomVersion() {
    return `${randomInteger(1, 8)}.${randomInteger(0, 12)}.${randomInteger(0, 20)}`;
  }

  /** @returns {string} Weighted semantic template identifier. */
  function pickTemplate() {
    const value = random();
    if (value < 0.18) {
      return 'comment';
    }
    if (value < 0.32) {
      return 'deploy-success';
    }
    if (value < 0.45) {
      return 'build-success';
    }
    if (value < 0.56) {
      return 'merged';
    }
    if (value < 0.65) {
      return 'release';
    }
    if (value < 0.78) {
      return 'deploy-started';
    }
    if (value < 0.84) {
      return 'review-request';
    }
    if (value < 0.89) {
      return 'mention';
    }
    if (value < 0.93) {
      return 'assignment';
    }
    if (value < 0.96) {
      return 'build-failed';
    }
    if (value < 0.98) {
      return 'deploy-failed';
    }
    if (value < 0.995) {
      return 'security';
    }
    return 'incident';
  }

  /** @returns {{ actor: string, context: string, kind: string, message: string, signal: EventSignal }} Semantic event data. */
  function createPayload() {
    const actor = pick(PEOPLE);
    const project = pick(PROJECTS);
    const service = pick(SERVICES);
    const environment = pick(ENVIRONMENTS);
    const branch = pick(BRANCHES);
    const issueNumber = randomInteger(120, 980);
    const pullRequestNumber = randomInteger(80, 640);

    switch (pickTemplate()) {
      case 'comment':
        return {
          actor,
          context: project,
          kind: 'Comment',
          message: `${actor} commented on PR #${pullRequestNumber} in ${project}.`,
          signal: 'none',
        };
      case 'deploy-success':
        return {
          actor,
          context: `${service} · ${environment}`,
          kind: 'Deployment',
          message: `Deployment of ${service} ${randomVersion()} to ${environment} completed.`,
          signal: 'none',
        };
      case 'build-success':
        return {
          actor,
          context: `${project} · ${branch}`,
          kind: 'CI',
          message: `Build #${randomInteger(4200, 9800)} completed for ${project}/${branch}.`,
          signal: 'none',
        };
      case 'merged':
        return {
          actor,
          context: project,
          kind: 'Pull request',
          message: `${actor} merged PR #${pullRequestNumber} into main in ${project}.`,
          signal: 'none',
        };
      case 'release':
        return {
          actor,
          context: project,
          kind: 'Release',
          message: `Release ${project} ${randomVersion()} was published.`,
          signal: 'none',
        };
      case 'review-request':
        return {
          actor,
          context: project,
          kind: 'Review request',
          message: `${actor} requested your review on PR #${pullRequestNumber} in ${project}.`,
          signal: 'attention',
        };
      case 'mention':
        return {
          actor,
          context: project,
          kind: 'Mention',
          message: `${actor} mentioned you in issue #${issueNumber} in ${project}.`,
          signal: 'attention',
        };
      case 'assignment':
        return {
          actor,
          context: project,
          kind: 'Assignment',
          message: `${actor} assigned issue #${issueNumber} to you in ${project}.`,
          signal: 'attention',
        };
      case 'deploy-started':
        return {
          actor,
          context: `${service} · ${environment}`,
          kind: 'Deployment',
          message: `Deployment of ${service} ${randomVersion()} to ${environment} started.`,
          signal: 'none',
        };
      case 'build-failed':
        return {
          actor,
          context: `${project} · ${branch}`,
          kind: 'CI failure',
          message: `Build failed for ${project}/${branch}.`,
          signal: 'critical',
        };
      case 'deploy-failed':
        return {
          actor,
          context: `${service} · ${environment}`,
          kind: 'Deployment failure',
          message: `Deployment of ${service} ${randomVersion()} to ${environment} failed.`,
          signal: 'critical',
        };
      case 'security':
        return {
          actor,
          context: project,
          kind: 'Security',
          message: `Security scan found ${randomInteger(1, 5)} high-severity findings in ${project}.`,
          signal: 'critical',
        };
      default:
        return {
          actor,
          context: service,
          kind: 'Incident',
          message: `Incident opened for elevated latency in ${service}.`,
          signal: 'critical',
        };
    }
  }

  /** @param {number} timestamp Event time. @param {boolean} live Whether the event is live. @param {number} recencyRatio Initial-history recency. @returns {ActivityEvent} Model. */
  function createEvent(timestamp, live, recencyRatio) {
    const payload = createPayload();
    const actionable = payload.signal !== 'none';
    return {
      ...payload,
      acknowledged: actionable ? (live ? false : random() < 0.88 - 0.42 * recencyRatio ** 4) : true,
      id: nextId++,
      timestamp,
      unread: live ? true : random() < 0.015 + 0.58 * recencyRatio ** 6,
    };
  }

  /** @returns {ActivityEvent[]} Initial chronological history. */
  function createInitialHistory() {
    let timestamp = Date.now() - INITIAL_EVENT_COUNT * 54_000;
    const history = Array.from({ length: INITIAL_EVENT_COUNT }, (_, index) => {
      timestamp += randomInteger(25_000, 82_000);
      return createEvent(timestamp, false, index / (INITIAL_EVENT_COUNT - 1));
    });
    lastTimestamp = history.at(-1)?.timestamp ?? Date.now();
    return history;
  }

  /** @param {number} [count] Batch size. @returns {ActivityEvent[]} New live events. */
  function createLiveBatch(count = randomInteger(1, 5)) {
    const firstTimestamp = Math.max(Date.now(), lastTimestamp + 1);
    return Array.from({ length: count }, (_, index) => {
      const timestamp = firstTimestamp + index * 220;
      lastTimestamp = timestamp;
      return createEvent(timestamp, true, 1);
    });
  }

  return { createInitialHistory, createLiveBatch };
}

export { createActivityGenerator, needsAttention };
