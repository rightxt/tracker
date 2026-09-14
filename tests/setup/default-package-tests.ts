/**
 * Inert ResizeObserver used by ordinary jsdom package tests.
 *
 * Observer-specific tests replace `window.ResizeObserver` explicitly when they
 * exercise unavailable, throwing, or callback-delivery behavior.
 */
class InertResizeObserver implements ResizeObserver {
  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}
}

if (typeof window !== 'undefined' && window.ResizeObserver === undefined) {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: InertResizeObserver,
    writable: true,
  });
}
