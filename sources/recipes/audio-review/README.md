# Audio caption review recipe

This Vanilla recipe reviews real timed-caption data across a local MP3 waveform. Tracker is a horizontal remaining-work overview, not a waveform, scrollbar, or mirror of all captions. If a browser build lacks an MP3 decoder, the review timeline and Tracker remain available while playback stays disabled and the page reports the limitation.

## What this recipe demonstrates

- horizontal element-mode Tracker with a viewport and clustering;
- real timed media data, parsed locally at runtime;
- open timing-review candidates as the only Tracker sources;
- selector membership changing when review state changes;
- application-owned zoom geometry and host-owned invalidation.

## What to try

Scroll the timeline, observe the Tracker viewport, switch 1×/2×/4×, activate a marker or cluster, inspect the transcript, mark a candidate reviewed, then reopen it. The source stays on the main timeline while the Tracker marker appears only for open work.

## Real data and review derivation

The included fixture currently has 150 timed captions and 20 question cues, derived directly from `?` punctuation. It produces 16 timing-review candidates: 8 very short captions, 7 long captions, and 1 long gap. These are candidates for review, not confirmed errors.

Rules are fixed: `duration <= 0.5 s`, `duration >= 9.0 s`, and `inter-caption gap >= 2.0 s`.

## Tracker scope and ownership

```text
Main timeline: captions, questions, and all review candidates
Tracker: only open review candidates

sourceRoot = fixed timeline scroller
scrollRoot = same timeline scroller
renderHost = dedicated neighboring host
```

Mutation observation and interval polling are disabled; resize and scroll updates remain enabled. Review and zoom transactions each call one scheduled `requestRender()` after application state and geometry are complete. WaveSurfer owns playback, waveform and ruler; the application owns horizontal scrolling and zoom; Tracker does not inspect WaveSurfer’s private Shadow DOM.

Clustering uses the explicit `1.8` percentage-point threshold: nearby candidates merge, while the recording does not collapse into only a few clusters.

## Licensing and fixtures

WaveSurfer.js 7.12.11 is bundled as an npm ESM dependency under BSD-3-Clause; its notice is in `public/THIRD_PARTY_NOTICES.txt`. The MP3 recording “WP351 – Wikimedia Futures Lab, Eva Martin” is by [Ainali](https://commons.wikimedia.org/wiki/User:Ainali) on Wikimedia Commons and is licensed CC BY-SA 4.0. The English SRT is separately attributed to [Ainali](https://commons.wikimedia.org/wiki/User:Ainali) on [Wikimedia Commons TimedText](https://commons.wikimedia.org/wiki/TimedText:WP351_-_Wikimedia_Futures_Lab,_Eva_Martin.mp3.en.srt), also under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). These fixture licenses do not relicense unrelated RXT Tracker recipe source code.

## Project structure

- `assets/` — local MP3 and SRT fixtures.
- `src/caption-data.js` — generic SRT parsing and neutral timing derivation.
- `src/main.js` — WaveSurfer, application state, timeline and Tracker lifecycle.
- `src/styles.css` — responsive timeline, review and Tracker presentation.
