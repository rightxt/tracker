// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { DebugDiagnostics } from '../DebugDiagnostics.js';

const originalPerformance = globalThis.performance;

afterEach(() => {
  Object.defineProperty(globalThis, 'performance', {
    value: originalPerformance,
    configurable: true,
    writable: true,
  });
});

describe('core debug diagnostics', () => {
  it('records trace entries with cloned payloads and timestamps', () => {
    const diagnostics = new DebugDiagnostics();
    const payload = { nested: { value: 1 } };

    diagnostics.trace('render', payload);
    payload.nested.value = 2;

    const trace = diagnostics.getTrace();

    expect(trace).toHaveLength(1);
    expect(trace[0].type).toBe('render');
    expect(trace[0].payload).toEqual({ nested: { value: 1 } });
    expect(trace[0].timestamp).toEqual(expect.any(Number));
  });

  it('sanitizes DOM nodes and other object graphs instead of retaining live references', () => {
    const diagnostics = new DebugDiagnostics();
    const element = document.createElement('div');
    element.id = 'target';
    const handler = (): void => {};

    diagnostics.trace('render', { element, handler, nested: { count: 1 } });

    const trace = diagnostics.getTrace();

    expect(trace[0].payload).toEqual({
      element: '[Element div#target]',
      handler: '[Function]',
      nested: { count: 1 },
    });
  });

  it('normalizes invalid trace types and missing payloads', () => {
    const diagnostics = new DebugDiagnostics();

    diagnostics.trace('');
    diagnostics.trace(null as never);

    const trace = diagnostics.getTrace();

    expect(trace.map((entry) => entry.type)).toEqual(['unknown', 'unknown']);
    expect(trace.map((entry) => entry.payload)).toEqual([{}, {}]);
  });

  it('stores a null timestamp when the performance API is unavailable', () => {
    Object.defineProperty(globalThis, 'performance', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const diagnostics = new DebugDiagnostics();

    diagnostics.trace('render');

    expect(diagnostics.getTrace()[0].timestamp).toBeNull();
  });

  it('returns trace snapshots detached from internal state', () => {
    const diagnostics = new DebugDiagnostics();

    diagnostics.trace('render');

    const snapshot = diagnostics.getTrace();

    snapshot.pop();

    expect(diagnostics.getTrace()).toHaveLength(1);
  });

  it('trims trace entries to a bounded default limit', () => {
    const diagnostics = new DebugDiagnostics();

    for (let index = 0; index < 105; index += 1) {
      diagnostics.trace(`entry-${index}`);
    }

    const trace = diagnostics.getTrace();

    expect(trace).toHaveLength(100);
    expect(trace[0].type).toBe('entry-5');
    expect(trace[trace.length - 1].type).toBe('entry-104');
    expect(diagnostics.getStats().debug).toEqual({ traceLength: 100, traceLimit: 100 });
  });

  it('exposes debug metadata alongside base stats', () => {
    const diagnostics = new DebugDiagnostics();

    diagnostics.trace('render');

    const stats = diagnostics.getStats();

    expect(stats.renders.requested).toBe(0);
    expect(stats.debug).toEqual({ traceLength: 1, traceLimit: 100 });
  });

  it('clears the trace on reset and destroy', () => {
    const diagnostics = new DebugDiagnostics();

    diagnostics.trace('render');
    diagnostics.recordRenderRequested();
    diagnostics.resetStats();

    expect(diagnostics.getTrace()).toHaveLength(0);
    expect(diagnostics.getStats().renders.requested).toBe(0);

    diagnostics.trace('render');
    diagnostics.destroy();

    expect(diagnostics.getTrace()).toHaveLength(0);
  });
});
