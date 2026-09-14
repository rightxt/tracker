// @vitest-environment jsdom

import '@angular/compiler';

import { Component, ErrorHandler, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { describe, expect, it } from 'vitest';

import { TrackerComponent } from '../TrackerComponent.js';

import type { TrackerRule, TrackerSourceRoot } from '@rightxt/tracker-core';

/** Options that keep server output deterministic and free of observer noise. */
const SERVER_RENDER_OPTIONS = {
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
} as const;

/** Server host that renders a Tracker with a null source root, so Core never mounts. */
@Component({
  selector: 'rxt-angular-server-host',
  standalone: true,
  imports: [TrackerComponent],
  template: ` <rxt-tracker-angular [options]="options" [rules]="rules()" [sourceRoot]="sourceRoot()" /> `,
})
class TrackerServerHost {
  /** Deterministic Tracker options. */
  readonly options = SERVER_RENDER_OPTIONS;

  /** Authoritative Tracker rules. */
  readonly rules = signal<readonly TrackerRule[]>([]);

  /** Null keeps Core from browser-mounting during server rendering. */
  readonly sourceRoot = signal<TrackerSourceRoot | null>(null);
}

/** Server host bound to an explicit null options object, invalid per the Tracker configuration contract. */
@Component({
  selector: 'rxt-angular-invalid-options-server-host',
  standalone: true,
  imports: [TrackerComponent],
  template: ` <rxt-tracker-angular [options]="options" [rules]="rules()" [sourceRoot]="sourceRoot()" /> `,
})
class TrackerInvalidOptionsServerHost {
  /** Explicit null, invalid per the Tracker configuration contract. */
  readonly options: unknown = null;

  /** Authoritative Tracker rules. */
  readonly rules = signal<readonly TrackerRule[]>([]);

  /** Null keeps Core from browser-mounting during server rendering. */
  readonly sourceRoot = signal<TrackerSourceRoot | null>(null);
}

/**
 * Records every error Angular's error-handling channel receives instead of only logging it.
 * Angular's default `ErrorHandler` never rethrows and `renderApplication()` always resolves
 * regardless of internal rendering errors, so a captured error is the only reliable way to
 * prove that a computation actually threw during server rendering.
 */
class CapturingErrorHandler extends ErrorHandler {
  readonly errors: unknown[] = [];

  override handleError(error: unknown): void {
    this.errors.push(error);
  }
}

describe('Angular Tracker server rendering', () => {
  it('renders a deterministic non-mounted Tracker shell on the server', async () => {
    const serverHtml = await renderApplication(
      (context) =>
        bootstrapApplication(
          TrackerServerHost,
          { providers: [provideZonelessChangeDetection(), provideServerRendering()] },
          context,
        ),
      {
        allowedHosts: ['tracker.test'],
        document:
          '<!doctype html><html><head></head><body>' +
          '<rxt-angular-server-host></rxt-angular-server-host></body></html>',
        url: 'https://tracker.test/server',
      },
    );

    const serverDocument = new DOMParser().parseFromString(serverHtml, 'text/html');
    const trackerRoot = serverDocument.querySelector('rxt-angular-server-host .rxtt');

    // The shell exists but advertises that no geometry is available and that it is
    // non-interactive: Core has not mounted on the server.
    expect(trackerRoot).not.toBeNull();
    expect(trackerRoot?.getAttribute('data-rxtt-geometry')).toBe('unavailable');
    expect(trackerRoot?.getAttribute('aria-disabled')).toBe('true');
    expect(serverDocument.querySelectorAll('rxt-angular-server-host .rxtt__marker')).toHaveLength(0);
  });

  it('rejects invalid Tracker options during server rendering before browser-only mounting', async () => {
    const capturingErrorHandler = new CapturingErrorHandler();

    const serverHtml = await renderApplication(
      (context) =>
        bootstrapApplication(
          TrackerInvalidOptionsServerHost,
          {
            providers: [
              provideZonelessChangeDetection(),
              provideServerRendering(),
              { provide: ErrorHandler, useValue: capturingErrorHandler },
            ],
          },
          context,
        ),
      {
        allowedHosts: ['tracker.test'],
        document:
          '<!doctype html><html><head></head><body>' +
          '<rxt-angular-invalid-options-server-host></rxt-angular-invalid-options-server-host></body></html>',
        url: 'https://tracker.test/server',
      },
    );

    // Server rendering still evaluates the Tracker configuration; an invalid options
    // object fails closed with the Core configuration error instead of silently defaulting.
    expect(capturingErrorHandler.errors).toHaveLength(1);
    expect(capturingErrorHandler.errors[0]).toMatchObject({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' });

    const serverDocument = new DOMParser().parseFromString(serverHtml, 'text/html');

    expect(serverDocument.querySelector('rxt-angular-invalid-options-server-host .rxtt')).toBeNull();
  });
});
