// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createConnectedElement } from '../../__tests__/support/connectedElement.js';
import { createTrackerStateIntegration } from '../../__tests__/testIntegration.js';

/** Restores the DOM after each snapshot activation scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('snapshot item interactivity follows interaction.activation', () => {
  it('marks marker items interactive by default when interaction.activation is unset', () => {
    const renderRoot = createConnectedElement();
    const target = createConnectedElement();

    target.className = 'default-interactivity-target';

    const runtime = createTrackerStateIntegration({
      options: { clustering: { enabled: false } },
      rules: [{ selector: '.default-interactivity-target' }],
    });

    runtime.mount({ renderRoot });

    const [marker] = runtime.getSnapshot().markers;

    expect(marker?.interactive).toBe(true);

    runtime.destroy();
  });

  it('marks marker items non-interactive when interaction.activation is false', () => {
    const renderRoot = createConnectedElement();
    const target = createConnectedElement();

    target.className = 'disabled-interactivity-target';

    const runtime = createTrackerStateIntegration({
      options: { clustering: { enabled: false }, interaction: { activation: false } },
      rules: [{ selector: '.disabled-interactivity-target' }],
    });

    runtime.mount({ renderRoot });

    const [marker] = runtime.getSnapshot().markers;

    expect(marker?.interactive).toBe(false);

    runtime.destroy();
  });

  it('marks marker items interactive when interaction.activation is explicitly true', () => {
    const renderRoot = createConnectedElement();
    const target = createConnectedElement();

    target.className = 'enabled-interactivity-target';

    const runtime = createTrackerStateIntegration({
      options: { clustering: { enabled: false }, interaction: { activation: true } },
      rules: [{ selector: '.enabled-interactivity-target' }],
    });

    runtime.mount({ renderRoot });

    const [marker] = runtime.getSnapshot().markers;

    expect(marker?.interactive).toBe(true);

    runtime.destroy();
  });

  it('marks cluster items non-interactive when interaction.activation is false', () => {
    const renderRoot = createConnectedElement();
    const targetA = createConnectedElement();
    const targetB = createConnectedElement();

    targetA.className = 'cluster-interactivity-target';
    targetB.className = 'cluster-interactivity-target';

    const runtime = createTrackerStateIntegration({
      options: { clustering: { enabled: true }, interaction: { activation: false } },
      rules: [{ selector: '.cluster-interactivity-target' }],
    });

    runtime.mount({ renderRoot });

    const [cluster] = runtime.getSnapshot().clusters;

    expect(cluster?.interactive).toBe(false);

    runtime.destroy();
  });

  it('updates item interactivity on the next snapshot after interaction.activation changes', () => {
    const renderRoot = createConnectedElement();
    const target = createConnectedElement();

    target.className = 'dynamic-interactivity-target';

    const runtime = createTrackerStateIntegration({
      options: { clustering: { enabled: false } },
      rules: [{ selector: '.dynamic-interactivity-target' }],
    });

    runtime.mount({ renderRoot });

    expect(runtime.getSnapshot().markers[0]?.interactive).toBe(true);

    runtime.patchOptions({ interaction: { activation: false } });

    expect(runtime.getSnapshot().markers[0]?.interactive).toBe(false);

    runtime.destroy();
  });
});
