import Tracker, { type TrackerHandle, type TrackerProps } from '@rightxt/tracker-react';
import '@rightxt/tracker-react/style.css';
import { createRef } from 'react';

const trackerRef = createRef<TrackerHandle>();

const props: TrackerProps = {
  onClusterActivate: ({ count }) => count,
  onMarkerActivate: ({ selector }) => selector,
  onSelectionChange: ({ selectedKey }) => selectedKey,
  onSyncEnd: ({ markersCount }) => markersCount,
  onSyncStart: ({ scheduled }) => scheduled,
  onTrackActivate: ({ position }) => position,
  onWarning: ({ code }) => code,
  options: { placement: 'right' },
  rules: [{ selector: '.error' }],
  scrollRoot: null,
  sourceRoot: null,
};

const tracker = <Tracker {...props} ref={trackerRef} />;

/**
 * The framework handle exposes only getState/getStats/refresh/
 * requestRefresh/resetStats/whenRuntimeDestroyed. Core event subscription and
 * configuration getters are not part of this contract.
 */
function assertHandleShape(handle: TrackerHandle): void {
  handle.getState();
  handle.getStats();
  handle.refresh();
  handle.requestRefresh();
  handle.resetStats();
  void handle.whenRuntimeDestroyed();

  // @ts-expect-error on() is not part of TrackerHandle.
  handle.on;
  // @ts-expect-error off() is not part of TrackerHandle.
  handle.off;
  // @ts-expect-error getOptions() is not part of TrackerHandle.
  handle.getOptions;
  // @ts-expect-error getRules() is not part of TrackerHandle.
  handle.getRules;
}

void assertHandleShape;

/** There is no framework-native destroy callback; whenRuntimeDestroyed() is authoritative. */
const noDestroyCallbackProps: TrackerProps = {
  // @ts-expect-error onDestroy is not part of TrackerProps.
  onDestroy: () => undefined,
};

void noDestroyCallbackProps;

/** Rules embedded in options are rejected by the React adapter type contract. */
const invalidOptionsProps: TrackerProps = {
  options: {
    // @ts-expect-error Rules must use the dedicated React prop.
    rules: [],
  },
};

void invalidOptionsProps;

/** The dedicated rules prop treats an explicit undefined value as omission. */
const omittedRulesProps: TrackerProps = {
  rules: undefined,
};

void omittedRulesProps;

/** The options, sourceRoot, and scrollRoot props also treat an explicit undefined value as omission. */
const omittedChannelsProps: TrackerProps = {
  options: undefined,
  scrollRoot: undefined,
  sourceRoot: undefined,
};

void omittedChannelsProps;

/** A rule's own undefined field is still rejected inside the rules prop. */
const invalidRuleFieldProps: TrackerProps = {
  rules: [
    // @ts-expect-error Own `undefined` is rejected under exactOptionalPropertyTypes.
    {
      label: undefined,
      selector: '.target',
    },
  ],
};

void invalidRuleFieldProps;

export { tracker };
