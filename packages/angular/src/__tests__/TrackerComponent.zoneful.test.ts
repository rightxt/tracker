// @vitest-environment jsdom

import 'zone.js';
import '@angular/compiler';

import { NgZone, provideZoneChangeDetection } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { expect, it, vi } from 'vitest';

import { TrackerComponent } from '../TrackerComponent.js';
import { defineTrackerComponentTests, ensureTestResizeObserver } from './projectionComponentTestBody.js';
import { RETHROWING_TEST_ERROR_HANDLER_PROVIDER } from './testErrorHandler.js';

import type { MountedTrackerComponent } from './projectionComponentTestBody.js';

/** Bootstraps one zone.js-backed Tracker fixture. */
async function mountTracker(): Promise<MountedTrackerComponent<TrackerComponent>> {
  ensureTestResizeObserver();
  const application = await createApplication({
    providers: [provideZoneChangeDetection(), RETHROWING_TEST_ERROR_HANDLER_PROVIDER],
  });
  const host = document.createElement('rxt-tracker-angular-zoneful-test');

  document.body.appendChild(host);

  const component = application.bootstrap(TrackerComponent, host);
  const detectChanges = (): void => component.changeDetectorRef.detectChanges();

  detectChanges();
  await Promise.resolve();
  detectChanges();

  return { application, component, detectChanges, host };
}

defineTrackerComponentTests(mountTracker);

it("schedules requested Core refresh work outside Angular's zone and re-enters the zone for its output", async () => {
  const mounted = await mountTracker();
  const ngZone = mounted.application.injector.get(NgZone);
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const schedulingZoneStates: boolean[] = [];
  let outputZoneState: boolean | undefined;

  mounted.component.instance.syncEnd.subscribe(() => {
    outputZoneState = NgZone.isInAngularZone();
  });

  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
    schedulingZoneStates.push(NgZone.isInAngularZone());
    return originalRequestAnimationFrame(callback);
  });

  ngZone.run(() => mounted.component.instance.requestRefresh());

  await new Promise<void>((resolve) => {
    originalRequestAnimationFrame(() => resolve());
  });
  await Promise.resolve();

  // The requested refresh schedules its Core work through the animation frame scheduler
  // outside Angular's zone. How many frames the scheduler needs is not a contract, so this
  // asserts only that scheduling was observed and that every observed entry was zone-external.
  expect(schedulingZoneStates.length).toBeGreaterThanOrEqual(1);
  expect(schedulingZoneStates.every((inAngularZone) => inAngularZone === false)).toBe(true);
  // A representative completion output is re-entered into Angular's zone for delivery.
  expect(outputZoneState).toBe(true);

  mounted.application.destroy();
  mounted.host.remove();
});
