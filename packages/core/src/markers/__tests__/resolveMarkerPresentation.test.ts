// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import type { TrackerMarkerRecord, TrackerNormalizedMarkerAttributes, TrackerRenderRecord } from '../../types.js';
import { resolveMarkerPresentation } from '../resolveMarkerPresentation.js';

/**
 * Creates a minimal marker record with normalized presentation data.
 *
 * @param params - Marker record fields.
 * @param params.attributes - Rule attribute values.
 * @param params.className - Rule class tokens.
 * @param params.cssVariables - Rule CSS custom properties.
 * @param params.key - Marker key.
 * @param params.label - Source label.
 * @param params.removals - Rule attribute tombstones.
 * @param params.title - Rule title override.
 * @returns Marker record.
 */
function createMarkerRecord({
  attributes = {},
  className = '',
  cssVariables = {},
  key,
  label = null,
  removals = [],
  title,
}: {
  attributes?: Record<string, string>;
  className?: string;
  cssVariables?: Record<string, string>;
  key: string;
  label?: string | null;
  removals?: string[];
  title?: boolean;
}): TrackerMarkerRecord {
  const normalizedAttributes: TrackerNormalizedMarkerAttributes = {
    removals: new Set(removals),
    values: attributes,
  };

  return {
    cluster: null,
    element: document.createElement('div'),
    focus: {
      enabled: false,
      target: 'self',
    },
    key,
    kind: 'marker',
    label,
    rule: {
      focus: {
        enabled: false,
        target: 'self',
      },
      index: 0,
      label: null,
      marker: {
        attributes: normalizedAttributes,
        className,
        cssVariables,
        title,
      },
      scroll: {
        align: 'start',
        behavior: 'auto',
        enabled: false,
        target: 'self',
      },
      selector: '.source',
      source: { selector: '.source' },
    },
    ruleIndex: 0,
    scroll: {
      align: 'start',
      behavior: 'auto',
      enabled: false,
      target: 'self',
    },
    selector: '.source',
  };
}

/**
 * Wraps one marker in a marker render record.
 *
 * @param marker - Marker record.
 * @returns Marker render record.
 */
function createMarkerRenderRecord(marker: TrackerMarkerRecord): TrackerRenderRecord {
  return {
    end: 20,
    key: marker.key,
    kind: 'marker',
    marker,
    orientation: 'vertical',
    size: 10,
    start: 10,
  };
}

describe('resolveMarkerPresentation', () => {
  it('composes classes and applies rule attribute precedence and tombstones', () => {
    const renderRecord = createMarkerRenderRecord(
      createMarkerRecord({
        attributes: {
          'data-rule': 'rule',
          'data-shared': 'rule',
        },
        className: 'shared rule-marker',
        cssVariables: {
          '--rxtt-marker-bg': 'rebeccapurple',
        },
        key: 'marker',
        label: 'Source label',
        removals: ['data-suppressed'],
      }),
    );

    expect(
      resolveMarkerPresentation(
        {
          attributes: {
            'data-global': 'global',
            'data-shared': 'global',
            'data-suppressed': 'global',
          },
          className: 'global-marker shared',
          title: true,
        },
        renderRecord,
      ),
    ).toEqual({
      attributes: {
        'data-global': 'global',
        'data-rule': 'rule',
        'data-shared': 'rule',
      },
      className: 'global-marker shared rule-marker',
      cssVariables: {
        '--rxtt-marker-bg': 'rebeccapurple',
      },
      title: 'Source label',
    });
  });

  it('uses the cluster primary marker and honors its title override', () => {
    const secondary = createMarkerRecord({
      className: 'secondary',
      key: 'secondary',
      label: 'Secondary label',
    });
    const primary = createMarkerRecord({
      attributes: { 'data-primary': 'true' },
      className: 'primary',
      key: 'primary',
      label: 'Primary label',
      title: false,
    });
    const cluster: TrackerRenderRecord = {
      count: 2,
      end: 30,
      key: 'cluster',
      kind: 'cluster',
      markers: [secondary, primary],
      orientation: 'vertical',
      primaryMarker: primary,
      size: 20,
      start: 10,
    };

    expect(resolveMarkerPresentation({ className: 'global', title: true }, cluster)).toEqual({
      attributes: { 'data-primary': 'true' },
      className: 'global primary',
      cssVariables: {},
      title: null,
    });
  });
});
