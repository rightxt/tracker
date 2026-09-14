import { afterEach, describe, expect, it, vi } from 'vitest';

import { TrackerElement, defineTrackerElement } from '../../packages/element/src/index.ts';

defineTrackerElement();

/** Deterministic options that disable asynchronous update sources. */
const DISABLED_UPDATE_OPTIONS = {
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
};

/** Creates one registered TrackerElement instance in the main realm. */
function createTrackerElement() {
  const element = document.createElement('rxt-tracker');

  if (!(element instanceof TrackerElement)) {
    throw new Error('Expected the registered rxt-tracker Custom Element.');
  }

  return element;
}

/** Removes browser fixtures after each event-transport scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('Element event transport', () => {
  it('uses the active owner-document realm after adoption', () => {
    const iframe = document.createElement('iframe');

    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (frameWindow === null || frameDocument === null) {
      throw new Error('Expected a live iframe browsing context.');
    }

    const element = createTrackerElement();
    let receivedEvent;

    element.replaceOptions(DISABLED_UPDATE_OPTIONS);
    element.addEventListener(
      'sync:start',
      (event) => {
        receivedEvent = event;
      },
      { once: true },
    );

    frameDocument.adoptNode(element);
    frameDocument.body.appendChild(element);
    element.render();

    expect(receivedEvent).toBeInstanceOf(frameWindow.CustomEvent);
    expect(receivedEvent).not.toBeInstanceOf(window.CustomEvent);
    expect(receivedEvent).toMatchObject({ bubbles: false, cancelable: false, composed: false, type: 'sync:start' });
  });

  it('stays local across ancestors and a shadow boundary while publishing one frozen detail identity', () => {
    const shadowHost = document.createElement('section');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const element = createTrackerElement();
    const receivedDetails = [];
    const ancestorListener = vi.fn();
    const documentListener = vi.fn();

    element.replaceOptions(DISABLED_UPDATE_OPTIONS);
    element.addEventListener('sync:end', (event) => {
      receivedDetails.push(event.detail);

      expect(() => {
        event.detail.markersCount = 999;
      }).toThrow(TypeError);
    });
    element.addEventListener('sync:end', (event) => {
      receivedDetails.push(event.detail);
      expect(event.detail.markersCount).toBe(0);
    });
    shadowHost.addEventListener('sync:end', ancestorListener);
    document.addEventListener('sync:end', documentListener);

    shadowRoot.appendChild(element);
    document.body.appendChild(shadowHost);

    expect(receivedDetails).toHaveLength(2);
    expect(receivedDetails[0]).toBe(receivedDetails[1]);
    expect(Object.isFrozen(receivedDetails[0])).toBe(true);
    expect(ancestorListener).not.toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();

    shadowHost.removeEventListener('sync:end', ancestorListener);
    document.removeEventListener('sync:end', documentListener);
  });
});
