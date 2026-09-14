// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  TrackerConfigurationError,
  assertValidTrackerConfiguration,
  createTrackerStateIntegration,
} from './testIntegration.js';
import { createDefaultOptions } from '../config/defaultOptions.js';
import { ALLOWED_OPTIONS_SHAPE } from '../config/optionSchema.js';
import { resolveTrackerOptions } from '../config/resolveOptions.js';
import { setPath } from '../utils/path.js';
import { collectSchemaLeafPaths } from './support/schemaLeafPaths.js';

/** Every fixed options field declared in ALLOWED_OPTIONS_SHAPE, as a dot-separated path. */
const OPTION_LEAF_PATHS = collectSchemaLeafPaths(ALLOWED_OPTIONS_SHAPE);

/**
 * Builds an options candidate whose only own property is an explicit
 * `undefined` at the given dot-separated path.
 *
 * @param path - Dot-separated option path.
 * @returns Options candidate with a single own-`undefined` leaf.
 */
function buildOwnUndefinedOptions(path: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  setPath(input, path, undefined);

  return input;
}

describe('options field own-undefined rejection', () => {
  it('rejects an own undefined leaf at every declared option path when replacing or patching options', () => {
    const previousOptions = createDefaultOptions();
    const failures: string[] = [];
    const expectRejection = (mode: string, path: string, resolve: () => unknown): void => {
      let thrown: unknown;

      try {
        resolve();
      } catch (error) {
        thrown = error;
      }

      const rejection = thrown as { code?: unknown; message?: unknown } | undefined;
      const isExpectedRejection =
        rejection !== undefined &&
        rejection.code === 'ERR_TRACKER_INVALID_CONFIGURATION' &&
        typeof rejection.message === 'string' &&
        rejection.message.includes(`"${path}"`);

      if (!isExpectedRejection) {
        failures.push(
          `${mode} options at "${path}": ${
            thrown === undefined ? 'no rejection was thrown' : `unexpected rejection (${String(thrown)})`
          }`,
        );
      }
    };

    OPTION_LEAF_PATHS.forEach((path) => {
      expectRejection('replacing', path, () =>
        resolveTrackerOptions(buildOwnUndefinedOptions(path), { replace: true }),
      );
      expectRejection('patching', path, () =>
        resolveTrackerOptions(buildOwnUndefinedOptions(path), { replace: false, previousOptions }),
      );
    });

    expect(failures).toEqual([]);
  });

  it('rejects an own undefined field before any other field is normalized, validated, or committed', () => {
    const runtime = createTrackerStateIntegration({
      options: { a11y: { enabled: true }, orientation: 'horizontal' },
      rules: [],
    });
    const committedBefore = runtime.getOptions();

    expect(() =>
      runtime.patchOptions({
        a11y: { enabled: false },
        clustering: { enabled: undefined as never },
        orientation: 'vertical',
      }),
    ).toThrow(TrackerConfigurationError);

    expect(runtime.getOptions()).toEqual(committedBefore);

    runtime.destroy();
  });

  it('rejects own undefined identically through replaceOptions() and patchOptions()', () => {
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

    expect(() => runtime.replaceOptions({ marker: { title: undefined as never } })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
    expect(() => runtime.patchOptions({ marker: { title: undefined as never } })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    runtime.destroy();
  });
});

describe('CSS custom-property key and value matrix', () => {
  const ROOT_ONLY_NAMES = [
    '--rxtt-track-thickness',
    '--rxtt-track-offset',
    '--rxtt-track-start',
    '--rxtt-track-end',
    '--rxtt-track-bg',
    '--rxtt-track-border-color',
    '--rxtt-track-border-style',
    '--rxtt-track-border-width',
    '--rxtt-track-z-index',
    '--rxtt-track-overflow',
    '--rxtt-track-contain',
    '--rxtt-viewport-bg',
    '--rxtt-focus-outline-color',
    '--rxtt-focus-outline-offset',
    '--rxtt-focus-outline-style',
    '--rxtt-focus-outline-width',
  ];
  const SHARED_ROOT_AND_RULE_NAMES = [
    '--rxtt-marker-min-size',
    '--rxtt-marker-bg',
    '--rxtt-marker-ring-color',
    '--rxtt-marker-ring-width',
    '--rxtt-marker-border-color',
    '--rxtt-marker-border-style',
    '--rxtt-marker-border-width',
    '--rxtt-marker-border-radius',
    '--rxtt-marker-hover-ring-color',
    '--rxtt-marker-hover-ring-width',
    '--rxtt-marker-selected-ring-color',
    '--rxtt-marker-selected-ring-width',
    '--rxtt-marker-opacity',
    '--rxtt-cluster-bg',
    '--rxtt-cluster-font-size',
    '--rxtt-cluster-text-color',
    '--rxtt-cluster-content',
  ];
  const RENDERER_OWNED_NAMES = [
    '--rxtt-viewport-start',
    '--rxtt-viewport-size',
    '--rxtt-marker-start',
    '--rxtt-marker-size',
  ];

  it.each(ROOT_ONLY_NAMES)('accepts the root-only reserved name "%s" at root scope', (name) => {
    const runtime = createTrackerStateIntegration({ options: { cssVariables: { [name]: 'red' } }, rules: [] });

    expect(runtime.getOptions().cssVariables[name]).toBe('red');

    runtime.destroy();
  });

  it.each(SHARED_ROOT_AND_RULE_NAMES)('accepts the shared reserved name "%s" at root scope', (name) => {
    const runtime = createTrackerStateIntegration({ options: { cssVariables: { [name]: 'red' } }, rules: [] });

    expect(runtime.getOptions().cssVariables[name]).toBe('red');

    runtime.destroy();
  });

  it.each(SHARED_ROOT_AND_RULE_NAMES)('accepts the shared reserved name "%s" at rule-marker scope', (name) => {
    const runtime = createTrackerStateIntegration({
      options: {},
      rules: [{ marker: { cssVariables: { [name]: 'red' } }, selector: '.target' }],
    });

    expect(runtime.getRules()[0]?.marker?.cssVariables?.[name]).toBe('red');

    runtime.destroy();
  });

  it.each(ROOT_ONLY_NAMES)('rejects the root-only reserved name "%s" at rule-marker scope', (name) => {
    expect(() =>
      createTrackerStateIntegration({
        options: {},
        rules: [{ marker: { cssVariables: { [name]: 'red' } }, selector: '.target' }],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it.each(RENDERER_OWNED_NAMES)('rejects the renderer-owned name "%s" at root scope', (name) => {
    expect(() => createTrackerStateIntegration({ options: { cssVariables: { [name]: 'red' } }, rules: [] })).toThrow(
      TrackerConfigurationError,
    );
  });

  it.each(RENDERER_OWNED_NAMES)('rejects the renderer-owned name "%s" at rule-marker scope', (name) => {
    expect(() =>
      createTrackerStateIntegration({
        options: {},
        rules: [{ marker: { cssVariables: { [name]: 'red' } }, selector: '.target' }],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects an unknown "--rxtt-" prefixed name at root scope', () => {
    expect(() =>
      createTrackerStateIntegration({ options: { cssVariables: { '--rxtt-not-a-real-token': 'red' } }, rules: [] }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects an unknown "--rxtt-" prefixed name at rule-marker scope', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: {},
        rules: [{ marker: { cssVariables: { '--rxtt-not-a-real-token': 'red' } }, selector: '.target' }],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('accepts an application-owned name outside the "--rxtt-" namespace at root scope', () => {
    const runtime = createTrackerStateIntegration({ options: { cssVariables: { '--app-accent': 'teal' } }, rules: [] });

    expect(runtime.getOptions().cssVariables['--app-accent']).toBe('teal');

    runtime.destroy();
  });

  it('accepts an application-owned name outside the "--rxtt-" namespace at rule-marker scope', () => {
    const runtime = createTrackerStateIntegration({
      options: {},
      rules: [{ marker: { cssVariables: { '--app-accent': 'teal' } }, selector: '.target' }],
    });

    expect(runtime.getRules()[0]?.marker?.cssVariables?.['--app-accent']).toBe('teal');

    runtime.destroy();
  });

  it('rejects a custom-property key that does not follow "--" grammar', () => {
    expect(() =>
      createTrackerStateIntegration({ options: { cssVariables: { 'not-a-custom-property': 'red' } }, rules: [] }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects an invalid key even when its root value is the null deletion sentinel', () => {
    expect(() =>
      createTrackerStateIntegration({ options: { cssVariables: { 'not-a-custom-property': null } }, rules: [] }),
    ).toThrow(TrackerConfigurationError);
  });

  it('forwards an empty-string value verbatim without rejecting it', () => {
    const runtime = createTrackerStateIntegration({ options: { cssVariables: { '--app-accent': '' } }, rules: [] });

    expect(runtime.getOptions().cssVariables['--app-accent']).toBe('');

    runtime.destroy();
  });

  it('treats a root null value as a deletion command, not a rejected value', () => {
    const runtime = createTrackerStateIntegration({
      options: { cssVariables: { '--app-accent': 'teal' } },
      rules: [],
    });

    runtime.patchOptions({ cssVariables: { '--app-accent': null } });

    expect(runtime.getOptions().cssVariables).not.toHaveProperty('--app-accent');

    runtime.destroy();
  });

  it('rejects a null value at rule-marker scope, which has no deletion tombstone', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: {},
        rules: [{ marker: { cssVariables: { '--app-accent': null as never } }, selector: '.target' }],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects an own undefined custom-property value at root scope', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: { cssVariables: { '--app-accent': undefined as never } },
        rules: [],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects an own undefined custom-property value at rule-marker scope', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: {},
        rules: [{ marker: { cssVariables: { '--app-accent': undefined as never } }, selector: '.target' }],
      }),
    ).toThrow(TrackerConfigurationError);
  });
});

describe('diagnostics sink matrix', () => {
  it('accepts an absent diagnostics sink', () => {
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

    expect(runtime.getOptions().diagnostics.output).toBeUndefined();

    runtime.destroy();
  });

  it('accepts an own function warn/error sink', () => {
    const sink = { error: () => {}, warn: () => {} };
    const runtime = createTrackerStateIntegration({ options: { diagnostics: { output: sink } }, rules: [] });

    expect(runtime.getOptions().diagnostics.output).toBe(sink);

    runtime.destroy();
  });

  it('rejects an own undefined warn/error sink method', () => {
    const sink = { warn: undefined as unknown as () => void };

    expect(() => createTrackerStateIntegration({ options: { diagnostics: { output: sink } }, rules: [] })).toThrow(
      TrackerConfigurationError,
    );
  });

  it('rejects an own non-function warn/error sink method', () => {
    const sink = { warn: 'not-a-function' as unknown as () => void };

    expect(() => createTrackerStateIntegration({ options: { diagnostics: { output: sink } }, rules: [] })).toThrow(
      TrackerConfigurationError,
    );
  });

  it('accepts null diagnostics output as removal of a previously configured sink', () => {
    const sink = { warn: () => {} };
    const runtime = createTrackerStateIntegration({ options: { diagnostics: { output: sink } }, rules: [] });

    runtime.patchOptions({ diagnostics: { output: null } });

    expect(runtime.getOptions().diagnostics.output).toBeNull();

    runtime.destroy();
  });

  it('accepts an inherited, non-own warn/error sink method', () => {
    const sink = Object.create({ warn: () => {} }) as { warn?: () => void };

    expect(Object.hasOwn(sink, 'warn')).toBe(false);

    const runtime = createTrackerStateIntegration({ options: { diagnostics: { output: sink } }, rules: [] });

    expect(runtime.getOptions().diagnostics.output).toBe(sink);

    runtime.destroy();
  });
});

describe('global marker attribute value matrix', () => {
  it('accepts string, finite-number, and boolean attribute values', () => {
    const runtime = createTrackerStateIntegration({
      options: {
        marker: {
          attributes: {
            'aria-hidden': true,
            'aria-label': 'Marker',
            'data-count': 3,
          },
        },
      },
      rules: [],
    });

    expect(runtime.getOptions().marker.attributes).toEqual({
      'aria-hidden': 'true',
      'aria-label': 'Marker',
      'data-count': '3',
    });

    runtime.destroy();
  });

  it('treats a null attribute value as a removal tombstone rather than a rejected value', () => {
    const runtime = createTrackerStateIntegration({
      options: { marker: { attributes: { 'aria-label': 'Marker' } } },
      rules: [],
    });

    runtime.patchOptions({ marker: { attributes: { 'aria-label': null } } });

    expect(runtime.getOptions().marker.attributes).not.toHaveProperty('aria-label');

    runtime.destroy();
  });

  it('rejects an own undefined attribute value', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: { marker: { attributes: { 'aria-label': undefined as never } } },
        rules: [],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects an attribute value of an unsupported type', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: { marker: { attributes: { 'aria-label': { nested: true } as never } } },
        rules: [],
      }),
    ).toThrow(TrackerConfigurationError);
  });
});

describe('array own-undefined element and sparse-hole matrix', () => {
  it('rejects an explicit undefined element inside updates.mutation.options.attributeFilter', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: { updates: { mutation: { options: { attributeFilter: ['class', undefined as never] } } } },
        rules: [],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects a sparse hole inside updates.mutation.options.attributeFilter', () => {
    const attributeFilter = new Array<string>(2);

    attributeFilter[0] = 'class';

    expect(() =>
      createTrackerStateIntegration({
        options: { updates: { mutation: { options: { attributeFilter } } } },
        rules: [],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('accepts a fully populated attributeFilter array', () => {
    const runtime = createTrackerStateIntegration({
      options: { updates: { mutation: { options: { attributeFilter: ['class', 'style'] } } } },
      rules: [],
    });

    expect(runtime.getOptions().updates.mutation.options.attributeFilter).toEqual(['class', 'style']);

    runtime.destroy();
  });
});

describe('configuration envelope own-undefined rejection', () => {
  it('rejects an own undefined "options" key via assertValidTrackerConfiguration()', () => {
    expect(() => assertValidTrackerConfiguration({ options: undefined as never, rules: [] })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('rejects an own undefined "rules" key via assertValidTrackerConfiguration()', () => {
    expect(() => assertValidTrackerConfiguration({ options: {}, rules: undefined as never })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('accepts an entirely omitted "options" or "rules" key via assertValidTrackerConfiguration()', () => {
    expect(() => assertValidTrackerConfiguration({ rules: [] })).not.toThrow();
    expect(() => assertValidTrackerConfiguration({ options: {} })).not.toThrow();
    expect(() => assertValidTrackerConfiguration({})).not.toThrow();
  });

  it('rejects an own undefined "options" key when constructing a runtime', () => {
    expect(() => createTrackerStateIntegration({ options: undefined as never, rules: [] })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('rejects an own undefined "rules" key when constructing a runtime', () => {
    expect(() => createTrackerStateIntegration({ options: {}, rules: undefined as never })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('accepts an entirely omitted "options" or "rules" key when constructing a runtime', () => {
    const runtimeWithoutOptions = createTrackerStateIntegration({ rules: [] });
    const runtimeWithoutRules = createTrackerStateIntegration({ options: {} });
    const runtimeWithoutEither = createTrackerStateIntegration();

    runtimeWithoutOptions.destroy();
    runtimeWithoutRules.destroy();
    runtimeWithoutEither.destroy();
  });

  it('rejects an unknown top-level configuration key', () => {
    expect(() => createTrackerStateIntegration({ options: {}, rules: [], extra: true } as never)).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });
});
