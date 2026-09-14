// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createConnectedElement } from './support/connectedElement.js';
import {
  createTrackerIntegrationInstance,
  createTrackerStateIntegration,
  destroyTrackerInstance,
  mountTrackerInstance,
} from './testIntegration.js';
import { resolveTrackerOptions } from '../config/resolveOptions.js';
import type { TrackerOptions, TrackerReadonlyOptions, TrackerRendererLike, TrackerResolvedOptions } from '../types.js';

/** Committed option branches that normalization and validation always produce. */
const RESOLVED_OPTION_BRANCHES = [
  'orientation',
  'placement',
  'cssVariables',
  'track',
  'viewport',
  'markerLayer',
  'marker',
  'clustering',
  'updates',
  'interaction',
  'a11y',
  'diagnostics',
] as const;

/** Snapshot option fields createTrackerInstanceSnapshot() creates unconditionally. */
const REQUIRED_SNAPSHOT_OPTION_FIELDS = [
  'orientation',
  'placement',
  'cssVariables',
  'track',
  'viewport',
  'markerLayer',
  'clustering',
  'interaction',
  'a11y',
] as const;

/** Restores the DOM after each committed-options scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('committed options type contract', () => {
  it('reads every committed branch without optional chaining', () => {
    const options = resolveTrackerOptions({ orientation: 'horizontal' }) satisfies TrackerResolvedOptions;

    // Each access below fails to compile against the public input type, which is
    // exactly the guarantee this layer adds.
    expect(options.orientation).toBe('horizontal');
    expect(options.placement).toBe('top');
    expect(options.track.className).toBe('');
    expect(options.viewport.enabled).toBe(true);
    expect(options.markerLayer.className).toBe('');
    expect(options.marker.title).toBe(true);
    expect(options.clustering.enabled).toBe(true);
    expect(options.updates.mutation.enabled).toBe(true);
    expect(options.updates.mutation.options.subtree).toBe(true);
    expect(options.updates.resize.debounce).toBe(50);
    expect(options.updates.scroll.enabled).toBe(true);
    expect(options.updates.interval.delay).toBe(1000);
    expect(options.interaction.activation).toBe(true);
    expect(options.a11y.label).toBe('Content tracker');
    expect(options.diagnostics.warnings).toBe(true);
  });

  it('uses orientation-specific placement defaults while preserving explicit compatible edges', () => {
    expect(resolveTrackerOptions({}).placement).toBe('left');
    expect(resolveTrackerOptions({ orientation: 'horizontal' }).placement).toBe('top');
    expect(resolveTrackerOptions({ placement: 'right' }).placement).toBe('right');
    expect(resolveTrackerOptions({ orientation: 'horizontal', placement: 'bottom' }).placement).toBe('bottom');
  });

  it('keeps public input options separate from committed options', () => {
    const inputOptions: TrackerOptions = { orientation: 'horizontal' };

    // @ts-expect-error Public input options carry no completeness guarantee.
    const committed: TrackerResolvedOptions = inputOptions;

    expect(committed.orientation).toBe('horizontal');
  });

  it('rejects nested mutation of the committed options view at compile time', () => {
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });
    const options: TrackerReadonlyOptions = runtime.getOptions();

    expect(() => {
      // @ts-expect-error Committed options are deeply frozen at runtime.
      options.updates.mutation.enabled = false;
    }).toThrow(TypeError);

    expect(options.updates.mutation.enabled).toBe(true);

    runtime.destroy();
  });

  it('exposes every committed branch through getOptions()', () => {
    const runtime = createTrackerStateIntegration({ options: { orientation: 'horizontal' }, rules: [] });
    const options = runtime.getOptions();

    RESOLVED_OPTION_BRANCHES.forEach((branch) => {
      expect(options[branch]).toBeDefined();
    });

    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.updates.mutation)).toBe(true);

    runtime.destroy();
  });

  it('accepts its own committed options back through replaceOptions()', () => {
    const runtime = createTrackerStateIntegration({
      options: { a11y: { enabled: true, keyboard: true }, orientation: 'horizontal' },
      rules: [],
    });
    const committedOptions = runtime.getOptions();

    runtime.replaceOptions(committedOptions);

    expect(runtime.getOptions()).toEqual(committedOptions);

    runtime.destroy();
  });

  it('creates every unconditional snapshot option field', () => {
    const renderRoot = createConnectedElement();
    const target = createConnectedElement();

    target.className = 'resolved-options-target';

    const runtime = createTrackerStateIntegration({
      options: { clustering: { enabled: false } },
      rules: [{ selector: '.resolved-options-target' }],
    });

    runtime.mount({ renderRoot });

    const snapshotOptions = runtime.getSnapshot().options;

    REQUIRED_SNAPSHOT_OPTION_FIELDS.forEach((field) => {
      expect(snapshotOptions[field]).toBeDefined();
    });

    expect(snapshotOptions).not.toHaveProperty('updates');
    expect(snapshotOptions).not.toHaveProperty('diagnostics');

    runtime.destroy();
  });
});

describe('renderer hook options', () => {
  it('passes frozen committed options to every renderer hook', () => {
    const renderRoot = createConnectedElement();
    const target = createConnectedElement();

    target.className = 'renderer-options-target';

    const receivedOptions: TrackerReadonlyOptions[] = [];
    let root: HTMLElement | null = null;
    const renderer: TrackerRendererLike = {
      destroy() {
        root = null;
      },
      mount(context, options) {
        root = context.target.kind === 'root' ? context.target.root : context.target.host;
        receivedOptions.push(options);

        return root;
      },
      renderMarkers(_renderRecords, options) {
        receivedOptions.push(options);
      },
      renderTrack(options) {
        receivedOptions.push(options);
      },
      renderViewport(_viewportLayout, options) {
        receivedOptions.push(options);
      },
      get root() {
        return root;
      },
    };

    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createTrackerIntegrationInstance(
      { options: { orientation: 'horizontal' }, rules: [{ selector: '.renderer-options-target' }] },
      { getInstance: () => instance, renderer },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: renderRoot } });

    expect(receivedOptions.length).toBeGreaterThanOrEqual(4);
    receivedOptions.forEach((options) => {
      expect(options.orientation).toBe('horizontal');
      expect(options.updates.mutation.enabled).toBe(true);
      expect(Object.isFrozen(options)).toBe(true);
    });

    destroyTrackerInstance(instance);
  });
});
