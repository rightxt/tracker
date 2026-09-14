import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';

// A selector that is unparseable CSS syntax (an unclosed functional
// pseudo-class) rather than merely an unsupported-but-valid pseudo-class.
// Every evergreen engine (Chromium, Firefox, WebKit) already implements the
// same modern selector set (:is/:where/:has), so there is currently no
// selector that is syntactically valid CSS yet accepted by one engine and
// rejected by another - "engine-specific unsupported selector" is not a
// reproducible axis on today's evergreen engines. What *is* reproducible,
// and is the actual contract under test, is that Tracker's response (thrown
// error code, rollback, absence of a rendered marker) is identical no matter
// which engine's querySelector() rejects the selector.
const INVALID_SELECTOR = '.selector-validation-target:not(';
const VALID_SELECTOR = ':is(.selector-validation-target)';

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Builds one realm scenario: a source root (where the selector is
 * matched and revalidated at mount time) plus the render scope (where a
 * successfully mounted Tracker root is expected to land, given the
 * `renderHost` chosen for that scenario) used for containment assertions.
 *
 * @returns {Promise<{ name: string, mountRequest: object, scope: () => ParentNode }>[]}
 */
function buildScenarios() {
  return [
    {
      name: 'Document',
      async setup() {
        const target = document.createElement('div');

        target.className = 'selector-validation-target';
        document.body.appendChild(target);
        return { mountRequest: { sourceRoot: document }, scope: () => document.body };
      },
    },
    {
      name: 'Element',
      async setup() {
        const container = document.createElement('div');
        const target = document.createElement('div');

        target.className = 'selector-validation-target';
        container.appendChild(target);
        document.body.appendChild(container);
        return { mountRequest: { sourceRoot: container, renderHost: container }, scope: () => container };
      },
    },
    {
      name: 'ShadowRoot',
      async setup() {
        const host = document.createElement('div');

        document.body.appendChild(host);

        const shadowRoot = host.attachShadow({ mode: 'open' });
        const target = document.createElement('div');

        target.className = 'selector-validation-target';
        shadowRoot.appendChild(target);
        // `renderHost` requires an HTMLElement (a ShadowRoot cannot be used
        // directly), so the render root lands as a light-DOM child of the
        // shadow host, while the selector is still matched and revalidated
        // against the shadow root realm via `sourceRoot`.
        return { mountRequest: { sourceRoot: shadowRoot, renderHost: host }, scope: () => host };
      },
    },
    {
      name: 'same-origin iframe',
      async setup() {
        const iframe = await loadInlineFrame(`
          <!doctype html>
          <html>
            <body style="margin: 0;">
              <div class="selector-validation-target">target</div>
            </body>
          </html>
        `);
        const frameWindow = iframe.contentWindow;
        const frameDocument = iframe.contentDocument;

        if (frameWindow === null || frameDocument?.body == null) {
          throw new Error('Expected a complete selector-validation frame.');
        }

        return {
          mountRequest: { scrollRoot: frameWindow, sourceRoot: frameDocument.body },
          scope: () => frameDocument.body,
        };
      },
    },
  ];
}

describe('selector validation across Document, Element, ShadowRoot, and iframe realms', () => {
  buildScenarios().forEach((scenario) => {
    it(`${scenario.name}: validates selectors in its own realm and recovers after an invalid selector rollback`, async () => {
      const { mountRequest, scope } = await scenario.setup();
      const deterministicOptions = {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      };

      // Phase 1 - the realm's native selector engine accepts the supported
      // modern selector through `sourceRoot` and renders a marker.
      const validTracker = new Tracker({
        options: deterministicOptions,
        rules: [{ selector: VALID_SELECTOR }],
      });

      expect(() => validTracker.mount(mountRequest)).not.toThrow();
      expect(validTracker.mounted).toBe(true);
      expect(scope().querySelector('.rxtt__marker')).not.toBeNull();

      validTracker.destroy();

      // Phase 2 - a syntactically invalid selector fails mount against the
      // same realm fixture with a stable configuration code and rolls the
      // provisional renderer root back completely.
      const recoveringTracker = new Tracker({
        options: deterministicOptions,
        rules: [{ selector: INVALID_SELECTOR }],
      });

      let caughtError = null;

      expect(scope().querySelector('.rxtt')).toBeNull();

      try {
        recoveringTracker.mount(mountRequest);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.code).toBe('ERR_TRACKER_INVALID_CONFIGURATION');
      expect(recoveringTracker.mounted).toBe(false);
      // Full rollback: no provisional renderer root at all, not merely an
      // empty marker set.
      expect(scope().querySelector('.rxtt')).toBeNull();
      expect(scope().querySelector('.rxtt__marker')).toBeNull();

      // Phase 3 - correcting the same failed instance and mounting again
      // against the same realm succeeds, proving rollback left no residual
      // state. A failed mount keeps the invalid rule, so it must be replaced.
      recoveringTracker.removeRuleBySelector(INVALID_SELECTOR);
      recoveringTracker.addRule({ selector: VALID_SELECTOR });
      expect(() => recoveringTracker.mount(mountRequest)).not.toThrow();
      expect(recoveringTracker.mounted).toBe(true);
      expect(scope().querySelector('.rxtt__marker')).not.toBeNull();

      recoveringTracker.destroy();
    });
  });
});
