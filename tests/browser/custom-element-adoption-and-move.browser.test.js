import { afterEach, describe, expect, it } from 'vitest';

import { TrackerElement, defineTrackerElement } from '../../packages/element/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';
import { waitFor as pollUntil } from './support/wait-for.js';

defineTrackerElement();

/** Creates a registered `rxt-tracker` Custom Element instance. */
function createTrackerElement() {
  const element = document.createElement('rxt-tracker');

  if (!(element instanceof TrackerElement)) {
    throw new Error('Expected the registered rxt-tracker Custom Element.');
  }

  return element;
}

/**
 * Waits until a condition becomes true within this suite's 3-second deadline.
 *
 * @param {() => boolean} condition - Success condition.
 * @param {string} description - Failure description.
 * @returns {Promise<void>}
 */
function waitFor(condition, description) {
  return pollUntil(condition, description, { timeoutMs: 3000 });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Custom Element adoption and DOM-move reaction ordering', () => {
  it('reconnects exactly once, with no duplicate runtime output, when moved to a new parent within the same document', async () => {
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'adoption-move-target';
    document.body.append(containerA, containerB, target);

    const element = createTrackerElement();

    element.replaceOptions({
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.adoption-move-target' }]);

    let destroyCount = 0;

    element.addEventListener('destroy', () => {
      destroyCount += 1;
    });

    containerA.appendChild(element);
    await waitFor(() => element.querySelector('.rxtt__marker') !== null, 'the first mounted marker');

    expect(element.querySelectorAll('.rxtt')).toHaveLength(1);
    expect(element.isConnected).toBe(true);

    const rootBeforeMove = element.querySelector('.rxtt');

    // A same-document move is, per the DOM standard, a removal followed by an
    // insertion: disconnectedCallback and connectedCallback both fire
    // synchronously as part of this single appendChild() call.
    containerB.appendChild(element);

    expect(element.parentElement).toBe(containerB);
    expect(element.isConnected).toBe(true);
    await waitFor(() => element.querySelector('.rxtt__marker') !== null, 'the marker after the same-document move');

    // Exactly one runtime lifecycle (disconnect + reconnect) must have run: no
    // leaked duplicate runtime, and no lost teardown notification either.
    expect(destroyCount).toBe(1);
    expect(element.querySelectorAll('.rxtt')).toHaveLength(1);
    expect(element.querySelectorAll('.rxtt__marker')).toHaveLength(1);

    const rootAfterMove = element.querySelector('.rxtt');

    // The move tears the previous runtime down and connects a fresh one - the
    // rendered root is expected to be a freshly created node, not reused.
    expect(rootAfterMove).not.toBe(rootBeforeMove);
    expect(element.getStats()).not.toBeNull();

    element.remove();
  });

  it('adopts into a same-origin iframe document and remounts its page-mode default against the destination document', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0;">
          <div class="adoption-frame-target">frame target</div>
        </body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;

    if (frameDocument?.body == null) {
      throw new Error('Expected a complete adoption frame.');
    }

    const mainTarget = document.createElement('div');

    mainTarget.className = 'adoption-frame-target';
    document.body.appendChild(mainTarget);

    const element = createTrackerElement();

    element.replaceOptions({
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.adoption-frame-target' }]);
    document.body.appendChild(element);

    await waitFor(() => element.querySelector('.rxtt__marker') !== null, 'the initial main-document marker');
    expect(element.ownerDocument).toBe(document);
    expect(element.querySelectorAll('.rxtt')).toHaveLength(1);

    let destroyCount = 0;

    element.addEventListener('destroy', () => {
      destroyCount += 1;
    });

    // A currently-connected node is always removed (disconnectedCallback)
    // before its owner document changes (adoptedCallback), per the DOM
    // standard's adopt algorithm - so this always exercises a
    // disconnect+reconnect cycle rather than adoptedCallback's in-place
    // remount branch, which only applies to an already-disconnected node.
    frameDocument.adoptNode(element);
    frameDocument.body.appendChild(element);

    expect(element.ownerDocument).toBe(frameDocument);
    expect(element.isConnected).toBe(true);
    await waitFor(() => element.querySelector('.rxtt__marker') !== null, 'the marker after cross-document adoption');

    expect(destroyCount).toBe(1);
    expect(element.querySelectorAll('.rxtt')).toHaveLength(1);
    // Page-mode default re-resolves sourceRoot against the *destination*
    // document body: only the frame target is now in scope, not the
    // main-document one left behind.
    expect(element.querySelectorAll('.rxtt__marker')).toHaveLength(1);
    expect(element.getStats()?.warnings.total ?? 0).toBe(0);

    element.remove();
  });

  it('reports a stable realm-mismatch failure for a stale explicit sourceRoot after adoption, then recovers once corrected', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0;">
          <div id="adoption-frame-container">
            <div class="adoption-stale-target">frame target</div>
          </div>
        </body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;
    const frameContainer = frameDocument?.getElementById('adoption-frame-container');

    if (frameContainer == null) {
      throw new Error('Expected a complete adoption frame.');
    }

    const mainContainer = document.createElement('div');
    const mainTarget = document.createElement('div');

    mainTarget.className = 'adoption-stale-target';
    mainContainer.appendChild(mainTarget);
    document.body.appendChild(mainContainer);

    const capturedErrors = [];
    const element = createTrackerElement();

    element.replaceOptions({
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
      diagnostics: {
        output: {
          error: (code, message, details) => {
            capturedErrors.push({ code, details, message });
          },
        },
      },
    });
    element.replaceRules([{ selector: '.adoption-stale-target' }]);
    // Set explicitly, in the main-document realm, before the element ever connects.
    element.sourceRoot = mainContainer;
    document.body.appendChild(element);

    await waitFor(() => element.querySelector('.rxtt__marker') !== null, 'the initial main-realm marker');
    expect(element.getStats()).not.toBeNull();

    // Adopt while `sourceRoot` still explicitly references the main-document
    // realm: the destination render root lands in the frame document, but the
    // configured sourceRoot does not follow it.
    frameDocument.adoptNode(element);
    frameContainer.appendChild(element);

    await waitFor(() => capturedErrors.length > 0, 'a reported realm-mismatch lifecycle error');

    // Two distinct, independent reports land on the shared diagnostics sink for
    // this single failure: Core's own instance diagnostics (lifecycle.ts:599)
    // report the specific mount-validation error before throwing it, and the
    // Element's connectedCallback catch separately reports the exception it
    // caught as a generic lifecycle-failure wrapper. Both are intentional.
    expect(capturedErrors).toHaveLength(2);
    expect(capturedErrors.every((entry) => entry.details.error.match(/realm/i))).toBe(true);
    expect(capturedErrors.map((entry) => entry.code)).toEqual(['invalid-mount-context', 'element-lifecycle-error']);

    // Full rollback: no leaked root, no usable runtime.
    expect(element.querySelectorAll('.rxtt')).toHaveLength(0);
    expect(element.getStats()).toBeNull();
    expect(element.isConnected).toBe(true);

    // Correcting sourceRoot to the destination realm must recover the
    // instance without requiring a full disconnect/reconnect from the host.
    // The corrected root must be a container of the target, not the target
    // itself: sourceRoot is scanned via querySelectorAll(), which never
    // matches the scanned root node against the rule selector.
    element.sourceRoot = frameContainer;
    await waitFor(() => element.querySelector('.rxtt__marker') !== null, 'the marker after the sourceRoot correction');

    expect(capturedErrors).toHaveLength(2);
    expect(element.querySelectorAll('.rxtt')).toHaveLength(1);
    expect(element.getStats()).not.toBeNull();

    element.remove();
  });
});
