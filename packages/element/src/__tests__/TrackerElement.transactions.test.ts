// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { CLASS_NAMES, createTrackerElement, stubLayout } from './TrackerElement.testSupport.js';

describe('TrackerElement root and transaction contract', () => {
  it('rejects foreign sourceRoot and scrollRoot identities before they can corrupt the current mount', () => {
    const iframe = document.createElement('iframe');
    const mainTarget = document.createElement('div');
    const element = createTrackerElement();

    mainTarget.className = 'foreign-root-target';
    document.body.append(iframe, mainTarget);

    const foreignRoot = iframe.contentDocument?.body;

    if (!foreignRoot) {
      throw new Error('Expected an iframe document body.');
    }

    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { warnings: false },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.foreign-root-target' }]);
    document.body.appendChild(element);

    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);

    // sourceRoot: a foreign-realm identity is rejected in the mount-request
    // preflight at the original setter call, before the property is committed or
    // any remount transaction begins.
    expect(() => {
      element.sourceRoot = foreignRoot;
    }).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_REALM_MISMATCH',
        name: 'TrackerLifecycleError',
      }),
    );
    expect(element.sourceRoot).toBeUndefined();
    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);
    expect(element.getStats()?.errors.byCode['invalid-mount-context']).toBe(1);

    // scrollRoot: the same foreign identity is rejected through the same
    // preflight, again leaving the committed property and current mount intact.
    expect(() => {
      element.scrollRoot = foreignRoot;
    }).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH' }));
    expect(element.scrollRoot).toBeUndefined();
    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);

    element.remove();
    mainTarget.remove();
    iframe.remove();
  });

  it('rejects a connected options patch whose orientation is unsupported by the active scroll root', () => {
    const scrollRoot = document.createElement('div');
    const sourceRoot = document.createElement('div');
    const target = document.createElement('div');
    const element = createTrackerElement();

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    stubLayout(scrollRoot);
    target.className = 'orientation-target';
    sourceRoot.appendChild(target);
    scrollRoot.appendChild(sourceRoot);
    document.body.append(scrollRoot, element);

    element.replaceOptions({
      clustering: { enabled: false },
      orientation: 'vertical',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.orientation-target' }]);
    element.sourceRoot = sourceRoot;
    element.scrollRoot = scrollRoot;

    // The active element-scroll root supports only the vertical represented axis,
    // so a connected patch to horizontal is rejected synchronously at the Element
    // call boundary, before the transaction is accepted. Unrelated committed
    // configuration is preserved because patchOptions() is used.
    expect(() => {
      element.patchOptions({ orientation: 'horizontal' });
    }).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT' }));

    expect(element.getOptions().orientation).toBe('vertical');
    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation')).toBe('vertical');
    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);

    element.remove();
    scrollRoot.remove();
  });

  it('stages cross-kind Element transactions during a forwarded event and commits both after dispatch', () => {
    const firstSourceRoot = document.createElement('div');
    const secondSourceRoot = document.createElement('div');
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    const element = createTrackerElement();
    const transactionErrors: unknown[] = [];

    firstTarget.className = 'forwarded-transaction-target';
    secondTarget.className = 'forwarded-transaction-target';
    firstSourceRoot.appendChild(firstTarget);
    secondSourceRoot.appendChild(secondTarget);
    document.body.append(firstSourceRoot, secondSourceRoot);
    element.replaceOptions({
      clustering: { enabled: false },
      placement: 'right',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.forwarded-transaction-target' }]);
    element.sourceRoot = firstSourceRoot;
    document.body.appendChild(element);
    element.addEventListener(
      'sync:end',
      () => {
        try {
          element.sourceRoot = secondSourceRoot;
        } catch (error) {
          transactionErrors.push(error);
        }

        try {
          element.patchOptions({ placement: 'left' });
        } catch (error) {
          transactionErrors.push(error);
        }

        // A root operation and a configuration operation share one Element host
        // gate: both are accepted here but neither commits while this forwarded
        // sync:end dispatch is still active.
        expect(element.sourceRoot).toBe(firstSourceRoot);
        expect(element.getOptions().placement).toBe('right');
      },
      { once: true },
    );

    element.render();

    expect(transactionErrors).toHaveLength(0);
    expect(element.sourceRoot).toBe(secondSourceRoot);
    expect(element.getOptions().placement).toBe('left');
    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);
    expect(element.getStats()?.errors.byCode['deferred-operation-error']).toBeUndefined();

    element.remove();
    firstSourceRoot.remove();
    secondSourceRoot.remove();
  });

  it('reports (without throwing to the caller) a queued scrollRoot commit invalidated by an earlier queued orientation change ahead of it', () => {
    const scrollRoot = document.createElement('div');
    const sourceRoot = document.createElement('div');
    const target = document.createElement('div');
    const element = createTrackerElement();
    const errorOutput = vi.fn();

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    stubLayout(scrollRoot);
    target.className = 'reentrant-catch-target';
    sourceRoot.appendChild(target);
    scrollRoot.appendChild(sourceRoot);
    document.body.append(scrollRoot, element);

    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { output: { error: errorOutput }, warnings: false },
      orientation: 'vertical',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.reentrant-catch-target' }]);
    element.sourceRoot = sourceRoot;

    element.addEventListener(
      'sync:end',
      () => {
        // Both calls are accepted while the page-mode scroll root is still current and
        // 'vertical' is still committed, so each passes its own pre-flight check and is
        // queued, in order, behind this still in-flight render dispatch.
        element.patchOptions({ orientation: 'horizontal' });
        element.scrollRoot = scrollRoot;
      },
      { once: true },
    );

    expect(() => element.render()).not.toThrow();

    // The orientation change committed first and normally.
    expect(element.getOptions().orientation).toBe('horizontal');
    // The scrollRoot change, queued behind it, only becomes genuinely incompatible once
    // it is its own turn to commit — against the orientation the first change just
    // landed — a failure pre-flight validation at accept time could not have foreseen.
    // A queued (reentrant) commit failure is reported, not thrown to the caller, and the
    // element recovers the previous mount.
    expect(errorOutput).toHaveBeenCalledWith(
      'element-lifecycle-error',
      'TrackerElement host transaction "change scrollRoot" failed.',
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(element.scrollRoot).toBeUndefined();
    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);

    element.remove();
    scrollRoot.remove();
    sourceRoot.remove();
  });

  it('keeps reporting-time reentrant host work behind every older accepted transaction', () => {
    const scrollRoot = document.createElement('div');
    const sourceRoot = document.createElement('div');
    const target = document.createElement('div');
    const element = createTrackerElement();
    const errorOutput = vi.fn((code: string) => {
      if (code === 'element-lifecycle-error') {
        element.patchOptions({ placement: 'bottom' }, { render: false });
      }
    });

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    stubLayout(scrollRoot);
    target.className = 'reporting-reentrancy-target';
    sourceRoot.appendChild(target);
    scrollRoot.appendChild(sourceRoot);
    document.body.append(scrollRoot, element);
    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { output: { error: errorOutput }, warnings: false },
      orientation: 'vertical',
      placement: 'right',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.reporting-reentrancy-target' }]);
    element.sourceRoot = sourceRoot;
    element.addEventListener(
      'sync:end',
      () => {
        element.patchOptions({ orientation: 'horizontal', placement: 'bottom' });
        element.scrollRoot = scrollRoot;
        element.patchOptions({ placement: 'top' }, { render: false });
      },
      { once: true },
    );

    expect(() => element.render()).not.toThrow();

    expect(errorOutput.mock.calls.filter(([code]) => code === 'element-lifecycle-error')).toEqual([
      [
        'element-lifecycle-error',
        'TrackerElement host transaction "change scrollRoot" failed.',
        expect.objectContaining({ error: expect.any(String) }),
      ],
    ]);
    expect(element.getOptions().orientation).toBe('horizontal');
    expect(element.scrollRoot).toBeUndefined();
    // The reporting-time patch requested 'bottom'; the earlier accepted patch
    // requested 'top'. Final 'bottom' proves the reentrant work stayed behind it.
    expect(element.getOptions().placement).toBe('bottom');

    element.remove();
    scrollRoot.remove();
    sourceRoot.remove();
  });

  it('contains a throwing diagnostics error getter without aborting the host FIFO', () => {
    const scrollRoot = document.createElement('div');
    const sourceRoot = document.createElement('div');
    const replacementSourceRoot = document.createElement('div');
    const target = document.createElement('div');
    const replacementTarget = document.createElement('div');
    const element = createTrackerElement();
    const sinkResolutionError = new Error('sink getter failed');
    let throwOnSinkRead = false;
    const outputError = vi.fn((code: string) => {
      if (code === 'mount-failure') {
        throwOnSinkRead = true;
      }
    });
    const output = Object.defineProperty({}, 'error', {
      get() {
        if (!throwOnSinkRead) {
          return outputError;
        }

        throw sinkResolutionError;
      },
    });

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    stubLayout(scrollRoot);
    target.className = 'reporting-getter-target';
    replacementTarget.className = 'reporting-getter-target';
    sourceRoot.appendChild(target);
    replacementSourceRoot.appendChild(replacementTarget);
    scrollRoot.append(sourceRoot, replacementSourceRoot);
    document.body.append(scrollRoot, element);
    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { output: output as never, warnings: false },
      orientation: 'vertical',
      placement: 'right',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.reporting-getter-target' }]);
    element.sourceRoot = sourceRoot;
    element.addEventListener(
      'sync:end',
      () => {
        element.patchOptions({ orientation: 'horizontal', placement: 'bottom' });
        element.scrollRoot = scrollRoot;
        element.sourceRoot = replacementSourceRoot;
      },
      { once: true },
    );

    expect(() => element.render()).not.toThrow();

    // The original diagnostics sink handled the preceding failure before its
    // getter became hostile.
    expect(outputError.mock.calls.map(([code]) => code)).toContain('mount-failure');
    // A reporting-path getter that then throws cannot abort the host FIFO: the
    // older accepted config transaction stays committed, the later accepted
    // sourceRoot transaction still commits, and the failed scrollRoot does not.
    expect(element.getOptions().placement).toBe('bottom');
    expect(element.sourceRoot).toBe(replacementSourceRoot);
    expect(element.scrollRoot).toBeUndefined();

    element.remove();
    scrollRoot.remove();
    replacementSourceRoot.remove();
    sourceRoot.remove();
  });

  it('rolls back a queued (reentrant) options commit invalidated by an earlier queued scrollRoot change ahead of it', () => {
    const scrollRoot = document.createElement('div');
    const sourceRoot = document.createElement('div');
    const target = document.createElement('div');
    const element = createTrackerElement();
    const errorOutput = vi.fn();

    scrollRoot.style.display = 'block';
    scrollRoot.style.overflowY = 'auto';
    stubLayout(scrollRoot);
    target.className = 'reentrant-options-rollback-target';
    sourceRoot.appendChild(target);
    scrollRoot.appendChild(sourceRoot);
    document.body.append(scrollRoot, element);

    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { output: { error: errorOutput }, warnings: false },
      orientation: 'vertical',
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.reentrant-options-rollback-target' }]);
    element.sourceRoot = sourceRoot;

    element.addEventListener(
      'sync:end',
      () => {
        // Both calls are accepted while orientation is still 'vertical' and the scroll
        // root is still page-mode default, so each passes its own pre-flight check and
        // is queued, in order, behind this still in-flight render dispatch.
        element.scrollRoot = scrollRoot;
        element.patchOptions({ orientation: 'horizontal' });
      },
      { once: true },
    );

    expect(() => element.render()).not.toThrow();

    // The scrollRoot change committed first and normally.
    expect(element.scrollRoot).toBe(scrollRoot);
    // The orientation change, queued behind it, only becomes genuinely incompatible once
    // it is its own turn to commit — against the scrollRoot the first change just landed.
    // Committed options and rules are rolled back to their previous values, Core's own
    // configuration is rolled back to match, and the failure is reported instead of
    // thrown to the caller.
    expect(errorOutput).toHaveBeenCalledWith(
      'element-lifecycle-error',
      'TrackerElement host transaction "patch options" failed.',
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(element.getOptions().orientation).toBe('vertical');
    expect(element.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation')).toBe('vertical');
    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);

    element.remove();
    scrollRoot.remove();
  });

  it('creates a fresh runtime when an invalid initial sourceRoot is corrected while still connected', () => {
    const iframe = document.createElement('iframe');
    const target = document.createElement('div');
    const element = createTrackerElement();
    const errorOutput = vi.fn();

    target.className = 'reconnect-target';
    document.body.append(iframe, target);

    const foreignSourceRoot = iframe.contentDocument?.body;

    if (!foreignSourceRoot) {
      throw new Error('Expected iframe source root.');
    }

    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { output: { error: errorOutput }, warnings: false },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.reconnect-target' }]);
    element.sourceRoot = foreignSourceRoot;
    document.body.appendChild(element);

    expect(errorOutput).toHaveBeenCalledWith(
      'element-lifecycle-error',
      'TrackerElement connection and rollback both failed.',
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(element.querySelector('.rxtt')).toBeNull();
    expect(element.getStats()).toBeNull();

    // Correcting the root property while the host stays connected reaches the
    // runtime-null recovery path through the root-property setter and mounts a
    // fresh runtime synchronously.
    expect(() => {
      element.sourceRoot = undefined;
    }).not.toThrow();

    expect(element.querySelector(`.${CLASS_NAMES.MARKER}`)).toBeInstanceOf(HTMLElement);
    expect(element.getStats()).not.toBeNull();

    element.remove();
    target.remove();
    iframe.remove();
  });

  it('throws an uncontended host-transaction commit failure to its caller instead of reporting it', () => {
    const iframe = document.createElement('iframe');
    const target = document.createElement('div');
    const element = createTrackerElement();
    const errorOutput = vi.fn();

    target.className = 'still-broken-target';
    document.body.append(iframe, target);

    const foreignSourceRoot = iframe.contentDocument?.body;

    if (!foreignSourceRoot) {
      throw new Error('Expected iframe source root.');
    }

    element.replaceOptions({
      clustering: { enabled: false },
      diagnostics: { output: { error: errorOutput }, warnings: false },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    });
    element.replaceRules([{ selector: '.still-broken-target' }]);
    element.sourceRoot = foreignSourceRoot;
    document.body.appendChild(element);

    // Connection failed above (reported through connectedCallback's own channel, not this
    // call), leaving the element connected with no runtime. sourceRoot is left unresolved,
    // so a direct call enters the otherwise-uncontended host-transaction gate, whose
    // commit retries the connection and hits the same failure. That path throws directly
    // to the current caller rather than reporting, and rolls the property change back.
    expect(() => element.patchOptions({ orientation: 'horizontal' })).toThrow();
    expect(element.getOptions().orientation).not.toBe('horizontal');
    expect(element.querySelector('.rxtt')).toBeNull();

    element.remove();
    target.remove();
    iframe.remove();
  });
});
