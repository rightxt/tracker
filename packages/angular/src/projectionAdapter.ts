import { Directive, ElementRef, Renderer2, RendererStyleFlags2, effect, inject, input } from '@angular/core';

import { assertValidTrackerConfiguration } from '@rightxt/tracker-core';
import { createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection';
import { createAngularProjectionStores } from './projectionStores.js';

import type { Signal } from '@angular/core';
import type { TrackerOptions, TrackerRule } from '@rightxt/tracker-core';
import type { TrackerElementView, TrackerProjectionIntegration } from '@rightxt/tracker-core/projection';
import type { AngularProjectionStores } from './projectionStores.js';

/** Runtime and domain signals owned by one Angular component generation. */
interface AngularProjectionRuntime {
  /** Narrow Core integration. */
  readonly integration: TrackerProjectionIntegration;
  /** Independently reactive Angular domains. */
  readonly stores: AngularProjectionStores;
}

/** Names most recently applied to one host element by an isolated writer. */
interface AppliedElementViewNames {
  attributeNames: ReadonlySet<string>;
  styleVariableNames: ReadonlySet<string>;
}

/**
 * Runs one adapter-owned cleanup without suppressing subsequent cleanup.
 *
 * @param cleanup - Cleanup operation.
 * @param errors - Mutable error collection.
 */
function attemptAdapterCleanup(cleanup: () => void, errors: unknown[]): void {
  try {
    cleanup();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Throws one lifecycle error directly or combines multiple failures.
 *
 * @param errors - Ordered lifecycle errors.
 * @param message - Aggregate error message.
 */
function throwAdapterLifecycleErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, message);
  }
}

/**
 * Creates and validates an immutable complete configuration.
 *
 * @param options - Tracker options.
 * @param rules - Tracker rules.
 * @returns Validated detached configuration.
 */
function createRuntimeConfiguration(
  options: Partial<TrackerOptions> | undefined,
  rules: readonly TrackerRule[] | undefined,
): { options: Partial<TrackerOptions>; rules: readonly TrackerRule[] } {
  if (options !== null && typeof options === 'object' && Object.hasOwn(options, 'rules')) {
    throw new TypeError('Angular Tracker rules must be passed through the dedicated rules input.');
  }

  const runtimeOptions = options === undefined ? {} : options;
  const runtimeRules = rules === undefined ? [] : rules;
  const configuration = { options: runtimeOptions, rules: runtimeRules };

  assertValidTrackerConfiguration(configuration);

  return { options: { ...runtimeOptions }, rules: [...runtimeRules] };
}

/**
 * Creates one projection runtime and connects its domain commit coordinator.
 *
 * @param configuration - Initial complete configuration.
 * @param configuration.options - Initial Tracker options.
 * @param configuration.rules - Initial Tracker rules.
 * @returns Runtime and Angular domain signals.
 */
function createProjectionRuntime(configuration: {
  options: Partial<TrackerOptions>;
  rules: readonly TrackerRule[];
}): AngularProjectionRuntime {
  const integration = createTrackerProjectionIntegration(configuration);
  const stores = createAngularProjectionStores(integration.getProjection());

  integration.subscribeProjection(stores.applyCommit);

  return { integration, stores };
}

/**
 * Applies one immutable element view through Angular's renderer.
 *
 * @param renderer - Renderer used for every DOM mutation.
 * @param element - Target host element.
 * @param view - Immutable element view to apply.
 * @param applied - Mutable record of names applied on the previous call.
 */
function applyElementView(
  renderer: Renderer2,
  element: HTMLElement,
  view: TrackerElementView,
  applied: AppliedElementViewNames,
): void {
  const nextAttributeNames = new Set(Object.keys(view.attributes));
  const nextStyleVariableNames = new Set(Object.keys(view.styleVars));

  renderer.setAttribute(element, 'class', view.className);

  for (const attributeName of applied.attributeNames) {
    if (!nextAttributeNames.has(attributeName)) {
      renderer.removeAttribute(element, attributeName);
    }
  }

  for (const [attributeName, value] of Object.entries(view.attributes)) {
    renderer.setAttribute(element, attributeName, value);
  }

  for (const variableName of applied.styleVariableNames) {
    if (!nextStyleVariableNames.has(variableName)) {
      renderer.removeStyle(element, variableName, RendererStyleFlags2.DashCase);
    }
  }

  for (const [variableName, value] of Object.entries(view.styleVars)) {
    renderer.setStyle(element, variableName, value, RendererStyleFlags2.DashCase);
  }

  applied.attributeNames = nextAttributeNames;
  applied.styleVariableNames = nextStyleVariableNames;
}

/** Applies one isolated element-view signal to its host element. */
@Directive({
  selector: '[rxtProjectionElement]',
  standalone: true,
})
class TrackerProjectionElementDirective {
  /** Immutable element-view signal supplied by the owning domain. */
  readonly view = input<Signal<TrackerElementView> | undefined>(undefined, { alias: 'rxtProjectionElement' });

  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #renderer = inject(Renderer2);
  readonly #applied: AppliedElementViewNames = { attributeNames: new Set(), styleVariableNames: new Set() };

  constructor() {
    effect(() => {
      const view = this.view();

      if (view !== undefined) {
        applyElementView(this.#renderer, this.#element, view(), this.#applied);
      }
    });
  }
}

export type { AngularProjectionRuntime, AppliedElementViewNames };
export {
  TrackerProjectionElementDirective,
  applyElementView,
  attemptAdapterCleanup,
  createProjectionRuntime,
  createRuntimeConfiguration,
  throwAdapterLifecycleErrors,
};
