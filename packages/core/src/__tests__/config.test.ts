import { describe, expect, it, vi } from 'vitest';

import {
  TrackerConfigurationError,
  cloneTrackerConfiguration,
  createDefaultOptions,
  createTrackerStateIntegration,
  normalizeOptions,
  validateOptions,
} from './testIntegration.js';
import { getPlacement } from '../config/optionAccessors.js';
import { createTrackerInstance } from '../tracker/createTrackerInstance.js';

describe('core options contract', () => {
  it('returns diagnostics for unsupported top-level option candidates', () => {
    const candidates: unknown[] = [null, undefined, 'options', 1, false, []];

    candidates.forEach((candidate) => {
      expect(() => validateOptions(candidate)).not.toThrow();

      const result = validateOptions(candidate);

      expect(result.errors.map((error) => error.code)).toContain('invalid-options');
      expect(result.options).toEqual(createDefaultOptions());
    });
  });

  it('preserves a plain-object diagnostics sink as caller-owned state', () => {
    const sink = {
      codes: [] as string[],
      warn(code: string) {
        this.codes.push(code);
      },
    };
    const instance = createTrackerInstance({ options: { diagnostics: { output: sink } }, rules: [] });

    instance.diagnostics.warn('invalid-option-value', 'Test warning.');

    expect(sink.codes).toEqual(['invalid-option-value']);
    expect(instance.options.diagnostics?.output).toBe(sink);
    expect(instance.rendererOptions.diagnostics?.output).toBe(sink);
    expect(Object.isFrozen(sink)).toBe(false);
  });

  it('preserves a plain-object diagnostics sink identity through cloneTrackerConfiguration()', () => {
    const sink = { warn: vi.fn() };

    const clone = cloneTrackerConfiguration({ options: { diagnostics: { output: sink } } });

    expect(clone.options?.diagnostics?.output).toBe(sink);
    expect(clone.options).not.toBe(undefined);
    expect(clone.options?.diagnostics).not.toEqual(undefined);
  });

  it('does not add an own `output` key when cloning options without a diagnostics sink', () => {
    const clone = cloneTrackerConfiguration({ options: { diagnostics: { warnings: false } } });

    expect(clone.options?.diagnostics).toEqual({ warnings: false });
    expect(Object.prototype.hasOwnProperty.call(clone.options?.diagnostics ?? {}, 'output')).toBe(false);
  });

  it('keeps visual defaults out of normalized JavaScript options', () => {
    const defaults = createDefaultOptions();
    const result = validateOptions(normalizeOptions());

    expect(defaults.clustering).not.toHaveProperty('symbol');
    expect(defaults).not.toHaveProperty('clusters');
    expect(defaults).not.toHaveProperty('markers');
    expect(defaults.marker).toEqual({ attributes: {}, className: '', title: true });
    expect(defaults.track).toEqual({ className: '' });
    expect(defaults.updates?.interval).toEqual({ delay: 1000, enabled: false });
    expect(defaults.viewport).toEqual({ className: '', enabled: true });
    expect(result.warnings).toHaveLength(0);
  });

  it('normalizes root CSS variable patches and removes null tombstones', () => {
    const previousOptions = createDefaultOptions();

    previousOptions.cssVariables = {
      '--app-tone': 'old',
      '--rxtt-marker-bg': 'red',
    };

    const inputOptions = {
      cssVariables: {
        '--app-space': ' ',
        '--app-tone': null,
        '--rxtt-marker-bg': 'blue',
      },
    };
    const result = validateOptions(normalizeOptions(inputOptions, { currentOptions: previousOptions }), {
      inputOptions,
      previousOptions,
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.options.cssVariables).toEqual({
      '--app-space': ' ',
      '--rxtt-marker-bg': 'blue',
    });
  });

  it('rejects a numeric value for an otherwise valid application root CSS variable', () => {
    const inputOptions = {
      cssVariables: {
        '--app-scale': 1,
      },
    };
    const result = validateOptions(normalizeOptions(inputOptions), { inputOptions });

    // A valid application-owned name isolates the value contract: the only
    // rejection must be the non-string/non-null value, addressed by its exact
    // diagnostic path rather than by a shared warning code.
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'invalid-css-variable-value',
        details: expect.objectContaining({
          name: '--app-scale',
          path: 'cssVariables.--app-scale',
          value: 1,
        }),
      }),
    ]);
  });

  it('normalizes application classes and rejects the service namespace', () => {
    const validInput = {
      marker: { className: ' marker:active  marker:active\tmodule_hash ' },
      markerLayer: { className: ' layer  layer ' },
      track: { className: ' root-theme  root-theme ' },
    };
    const validResult = validateOptions(normalizeOptions(validInput), { inputOptions: validInput });
    const invalidInput = { viewport: { className: 'custom rxtt__viewport' } };
    const invalidResult = validateOptions(normalizeOptions(invalidInput), { inputOptions: invalidInput });

    expect(validResult.warnings).toHaveLength(0);
    expect(validResult.options.track?.className).toBe('root-theme');
    expect(validResult.options.markerLayer?.className).toBe('layer');
    expect(validResult.options.marker?.className).toBe('marker:active module_hash');
    expect(invalidResult.warnings.map((warning) => warning.code)).toContain('reserved-class-name');
  });

  it('patches global marker attributes by normalized name', () => {
    const previousOptions = createDefaultOptions();

    previousOptions.marker!.attributes = {
      'aria-label': 'Previous',
      'data-state': 'old',
    };

    const inputOptions = {
      marker: {
        attributes: {
          'DATA-State': null,
          'data-count': 2,
          Role: ' button ',
        },
      },
    };
    const result = validateOptions(normalizeOptions(inputOptions, { currentOptions: previousOptions }), {
      inputOptions,
      previousOptions,
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.options.marker?.attributes).toEqual({
      'aria-label': 'Previous',
      'data-count': '2',
      role: 'button',
    });
  });

  it('rejects marker attribute collisions after ASCII lowercasing', () => {
    const inputOptions = {
      marker: {
        attributes: {
          'data-State': 'first',
          'DATA-state': 'second',
        },
      },
    };
    const result = validateOptions(normalizeOptions(inputOptions), { inputOptions });

    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-marker-attribute-collision');
  });

  it('accepts mutation dependencies as effective observation types', () => {
    const inputOptions = {
      updates: {
        mutation: {
          options: {
            attributeFilter: ['class'],
            attributes: false,
            characterData: false,
            childList: false,
          },
        },
      },
    };
    const result = validateOptions(normalizeOptions(inputOptions), { inputOptions });

    expect(result.options.updates?.mutation?.options).toMatchObject(inputOptions.updates.mutation.options);
    expect(result.warnings.map((warning) => warning.code)).not.toContain('invalid-option-value');
  });

  it('rejects an empty mutation attributeFilter and restores the previous value', () => {
    const previousOptions = createDefaultOptions();

    previousOptions.updates!.mutation!.options!.attributeFilter = ['class'];

    const inputOptions = {
      updates: {
        mutation: {
          options: {
            attributeFilter: [],
          },
        },
      },
    };
    const result = validateOptions(normalizeOptions(inputOptions, { currentOptions: previousOptions }), {
      inputOptions,
      previousOptions,
    });

    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-option-value');
    expect(result.options.updates?.mutation?.options?.attributeFilter).toEqual(['class']);
  });

  it('accepts finite numeric clustering thresholds as percentage points', () => {
    const normalizedOptions = normalizeOptions({
      clustering: {
        threshold: 2.5,
      },
    });
    const result = validateOptions(normalizedOptions, {
      inputOptions: {
        clustering: {
          threshold: 2.5,
        },
      },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.options.clustering?.threshold).toBe(2.5);
  });

  it('rejects CSS length clustering thresholds and preserves the previous valid value', () => {
    const previousOptions = createDefaultOptions();

    previousOptions.clustering!.threshold = 7;

    const normalizedOptions = normalizeOptions(
      {
        clustering: {
          threshold: '2px',
        },
      },
      {
        currentOptions: previousOptions,
      },
    );
    const result = validateOptions(normalizedOptions, {
      inputOptions: {
        clustering: {
          threshold: '2px',
        },
      },
      previousOptions,
    });

    expect(result.errors).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-option-value');
    expect(result.options.clustering?.threshold).toBe(7);
  });

  it('applies the fallback placement silently when placement is missing for a valid orientation', () => {
    const result = validateOptions(
      { orientation: 'horizontal' },
      {
        inputOptions: { orientation: 'horizontal' },
        previousOptions: { orientation: 'horizontal' },
      },
    );

    expect(result.warnings.map((warning) => warning.code)).not.toContain('invalid-orientation-placement');
    expect(result.options.placement).toBe('top');
  });

  it('silently replaces an inherited placement when only orientation changes', () => {
    const previousOptions = createDefaultOptions();

    previousOptions.orientation = 'vertical';
    previousOptions.placement = 'right';

    const inputOptions = { orientation: 'horizontal' } as const;
    const normalizedOptions = normalizeOptions(inputOptions, { currentOptions: previousOptions });
    const result = validateOptions(normalizedOptions, { inputOptions, previousOptions });

    expect(result.options.placement).toBe('top');
    expect(result.warnings.map((warning) => warning.code)).not.toContain('invalid-orientation-placement');
  });

  it('uses static orientation-specific placement fallbacks without overriding compatible explicit values', () => {
    expect(getPlacement()).toBe('left');
    expect(getPlacement({ orientation: 'vertical', placement: 'right' })).toBe('right');
    expect(getPlacement({ orientation: 'horizontal' })).toBe('top');
    expect(getPlacement({ orientation: 'horizontal', placement: 'bottom' })).toBe('bottom');
  });

  it('normalizes semantic activation and drag independently', () => {
    const options = normalizeOptions({ interaction: { activation: false, drag: true } });

    expect(options.interaction).toEqual({ activation: false, drag: true });
  });

  it('rejects invalid diagnostics outputs and preserves the previous sink', () => {
    const previousOptions = createDefaultOptions();
    const output = { warn: vi.fn() };

    previousOptions.diagnostics!.output = output;

    const inputOptions = { diagnostics: { output: { warn: 'not-a-function' } } };
    const result = validateOptions(normalizeOptions(inputOptions, { currentOptions: previousOptions }), {
      inputOptions,
      previousOptions,
    });

    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-option-value');
    expect(result.options.diagnostics?.output).toEqual(output);
  });

  it('rejects an unknown top-level option', () => {
    const inputOptions = { unknownSection: {} };
    const result = validateOptions(normalizeOptions(inputOptions as never), { inputOptions });

    expect(result.warnings.map((warning) => warning.code)).toContain('WARN_TRACKER_UNKNOWN_OPTION');
  });

  it('rejects a null option container and restores the previous object', () => {
    const previousOptions = createDefaultOptions();
    const inputOptions = { clustering: null };
    const result = validateOptions(normalizeOptions(inputOptions as never, { currentOptions: previousOptions }), {
      inputOptions,
      previousOptions,
    });

    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-option-value');
    expect(result.warnings.map((warning) => warning.details?.path)).toContain('clustering');
    expect(result.options.clustering).toEqual(previousOptions.clustering);
  });

  it('rejects Tracker construction with a null option container', () => {
    expect(() => createTrackerStateIntegration({ options: { clustering: null } as never, rules: [] })).toThrow(
      expect.objectContaining({ name: TrackerConfigurationError.name }),
    );
  });
});
