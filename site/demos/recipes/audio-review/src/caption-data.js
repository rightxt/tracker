/** Minimum cue duration that requires a long-caption review. */
const LONG_CAPTION_MIN_SECONDS = 9;
/** Minimum silent gap duration that requires a pause review. */
const LONG_PAUSE_MIN_SECONDS = 2;
/** Maximum cue duration that requires a short-caption review. */
const SHORT_CAPTION_MAX_SECONDS = 0.5;

/** @typedef {'short-caption' | 'long-caption' | 'long-pause'} ReviewKind */

/**
 * @typedef {object} CaptionCue
 * @property {number} duration Cue duration in seconds.
 * @property {number} endTime Cue end in seconds.
 * @property {number} index One-based SRT cue index.
 * @property {number} startTime Cue start in seconds.
 * @property {string} text Normalized caption text.
 */

/**
 * @typedef {object} ReviewCandidate
 * @property {number | null} cueIndex Related caption index, if applicable.
 * @property {string} description Reader-facing reason for review.
 * @property {number} endTime Candidate end in seconds.
 * @property {string} id Stable application-owned identifier.
 * @property {ReviewKind} kind Review category.
 * @property {number} startTime Candidate start in seconds.
 * @property {'open' | 'reviewed'} status Current review lifecycle state.
 * @property {string} title Short candidate label.
 * @property {string} transcript Relevant caption context.
 */

/** @param {number} seconds Duration in seconds. @returns {string} Human-readable duration. */
function formatDuration(seconds) {
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)} seconds`;
}

/** @param {string} timestamp Standard SRT timestamp. @returns {number} Seconds. */
function parseSrtTimestamp(timestamp) {
  const match = timestamp.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/u);
  if (!match) {
    throw new Error(`Invalid SRT timestamp: ${timestamp}`);
  }
  const [, hours, minutes, seconds, milliseconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
}

/** @param {string} source SRT source. @returns {CaptionCue[]} Parsed caption cues. */
function parseSrt(source) {
  const normalized = source.replace(/\r\n?/gu, '\n').trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\n{2,}/u)
    .map((block) => {
      const lines = block.split('\n');
      const timing = lines[1]?.match(/^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/u);
      const index = Number(lines[0]);
      if (!Number.isInteger(index) || !timing) {
        return null;
      }
      const startTime = parseSrtTimestamp(timing[1]);
      const endTime = parseSrtTimestamp(timing[2]);
      return {
        duration: endTime - startTime,
        endTime,
        index,
        startTime,
        text: lines.slice(2).join(' ').replace(/\s+/gu, ' ').trim(),
      };
    })
    .filter((cue) => cue !== null);
}

/** @param {CaptionCue[]} captions Caption cues. @returns {CaptionCue[]} Question cues. */
function deriveQuestions(captions) {
  return captions.filter((cue) => cue.text.includes('?'));
}

/** @param {CaptionCue[]} captions Caption cues. @returns {ReviewCandidate[]} Derived timing-review candidates. */
function deriveReviewCandidates(captions) {
  const candidates = [];
  captions.forEach((cue) => {
    if (cue.duration <= SHORT_CAPTION_MAX_SECONDS) {
      candidates.push({
        cueIndex: cue.index,
        description: `This caption lasts ${formatDuration(cue.duration)}, at or below the 0.5 s review threshold.`,
        endTime: cue.endTime,
        id: `short-caption-${cue.index}`,
        kind: 'short-caption',
        startTime: cue.startTime,
        status: 'open',
        title: `Very short caption #${cue.index}`,
        transcript: cue.text,
      });
    }
    if (cue.duration >= LONG_CAPTION_MIN_SECONDS) {
      candidates.push({
        cueIndex: cue.index,
        description: `This caption lasts ${formatDuration(cue.duration)}, at or above the 9.0 s review threshold.`,
        endTime: cue.endTime,
        id: `long-caption-${cue.index}`,
        kind: 'long-caption',
        startTime: cue.startTime,
        status: 'open',
        title: `Long caption #${cue.index}`,
        transcript: cue.text,
      });
    }
  });
  for (let index = 0; index < captions.length - 1; index += 1) {
    const current = captions[index];
    const next = captions[index + 1];
    const gap = next.startTime - current.endTime;
    if (gap >= LONG_PAUSE_MIN_SECONDS) {
      candidates.push({
        cueIndex: null,
        description: `The gap before caption #${next.index} lasts ${formatDuration(gap)}, at or above the 2.0 s review threshold.`,
        endTime: next.startTime,
        id: `long-pause-${current.index}-${next.index}`,
        kind: 'long-pause',
        startTime: current.endTime,
        status: 'open',
        title: `Long caption gap after #${current.index}`,
        transcript: `Before: “${current.text}”\nAfter: “${next.text}”`,
      });
    }
  }
  return candidates.sort((left, right) => left.startTime - right.startTime);
}

export { deriveQuestions, deriveReviewCandidates, formatDuration, parseSrt };
