import { describe, expect, it } from 'vitest';

import { normalizeTrackerRenderer } from '../renderer.js';

import type { TrackerRendererLike } from '../../types.js';

type CapturedWarning = { code: string; message: string; details?: Record<string, unknown> | undefined };

describe('core tracker renderer facade', () => {
  it('observes a rejected thenable from a forwarded renderer hook without an unhandled rejection', async () => {
    // vi.fn() wraps async implementations with its own promise tracking, which
    // masks unhandled rejections from Node's detection — a plain function is
    // required to observe the real defect.
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const warnings: CapturedWarning[] = [];
      const diagnostics = {
        warn: (code: string, message: string, details?: Record<string, unknown>) =>
          warnings.push({ code, message, details }),
      };
      const source: TrackerRendererLike = {
        destroy: () => {},
        mount: () => null,
        renderTrack: async () => {
          throw new Error('async renderTrack failed');
        },
      };
      const renderer = normalizeTrackerRenderer(source, diagnostics);

      renderer.renderTrack({} as never);

      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(unhandledRejections).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('renderer-hook-returned-thenable');
      expect(warnings[0]?.message).toContain('renderTrack');
      expect(warnings[0]?.details?.error).toBe('async renderTrack failed');
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('observes rejected thenables from reversible and permanent renderer cleanup without unhandled rejections', async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const warnings: CapturedWarning[] = [];
      const diagnostics = {
        warn: (code: string, message: string, details?: Record<string, unknown>) =>
          warnings.push({ code, message, details }),
      };
      const source: TrackerRendererLike = {
        destroy: async () => {
          throw new Error('async destroy failed');
        },
        mount: () => null,
        unmount: async () => {
          throw new Error('async unmount failed');
        },
      };
      const renderer = normalizeTrackerRenderer(source, diagnostics);

      // One active mount cycle so reversible cleanup routes through source
      // unmount() rather than the per-cycle destroy fallback.
      renderer.mount({ target: { host: {}, kind: 'host' } } as never, {} as never);
      renderer.unmount();
      renderer.destroy();

      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(unhandledRejections).toHaveLength(0);
      expect(warnings).toHaveLength(2);
      expect(warnings.every((warning) => warning.code === 'renderer-hook-returned-thenable')).toBe(true);

      const unmountWarning = warnings.find((warning) => warning.message.includes('"unmount"'));
      const destroyWarning = warnings.find((warning) => warning.message.includes('"destroy"'));

      expect(unmountWarning?.details?.error).toBe('async unmount failed');
      expect(destroyWarning?.details?.error).toBe('async destroy failed');
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
