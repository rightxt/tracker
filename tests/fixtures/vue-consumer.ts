import { createApp, h, shallowRef } from 'vue';

import { Tracker } from '@rightxt/tracker-vue';
import '@rightxt/tracker-vue/style.css';

import type { TrackerHandle, TrackerProps } from '@rightxt/tracker-vue';
import type { TrackerMarkerActivateEventPayload, TrackerRule } from '@rightxt/tracker-core';

/** Immutable consumer rule list. */
const rules: readonly TrackerRule[] = [{ selector: '.error' }];

/** Public Vue imperative handle. */
const trackerHandle = shallowRef<TrackerHandle | null>(null);

/** Final Vue DOM-reference props support adapter-only null semantics. */
const trackerProps: TrackerProps = {
  scrollRoot: null,
  sourceRoot: null,
};

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

/** Rules embedded in options are rejected by the Vue adapter type contract. */
const invalidOptionsProps: TrackerProps = {
  options: {
    // @ts-expect-error Rules must use the dedicated Vue prop.
    rules: [],
  },
};

const app = createApp({
  render: () =>
    h(Tracker, {
      ref: trackerHandle,
      options: { placement: 'right' },
      rules,
      scrollRoot: trackerProps.scrollRoot,
      sourceRoot: trackerProps.sourceRoot,
      onClusterActivate: () => undefined,
      onMarkerActivate: (payload: TrackerMarkerActivateEventPayload) => payload.selector,
      onSelectionChange: () => undefined,
      onSyncEnd: () => undefined,
      onSyncStart: () => undefined,
      onTrackActivate: () => undefined,
      onWarning: () => undefined,
    }),
});

app.mount(document.createElement('div'));
trackerHandle.value?.refresh();

void invalidOptionsProps;

/** The dedicated rules prop treats an explicit undefined value as omission. */
const omittedRulesProps: TrackerProps = {
  rules: undefined,
};

/** The options, sourceRoot, and scrollRoot props also treat an explicit undefined value as omission. */
const omittedChannelsProps: TrackerProps = {
  options: undefined,
  scrollRoot: undefined,
  sourceRoot: undefined,
};

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

void omittedRulesProps;
void omittedChannelsProps;
void invalidRuleFieldProps;
