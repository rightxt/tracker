/* eslint-disable import/no-duplicates -- Vite raw and side-effect CSS imports exercise separate style-scope contracts. */

import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../../packages/core/src/styles/rxt-tracker.css';
import canonicalTrackerCss from '../../packages/core/src/styles/rxt-tracker.css?raw';

/**
 * Creates the standard tracker DOM needed for computed-style assertions.
 *
 * @returns {{ marker: HTMLElement, markerLayer: HTMLElement, root: HTMLElement, viewport: HTMLElement }}
 */
function createStandardTrackerTree() {
  const root = document.createElement('div');
  const viewport = document.createElement('div');
  const markerLayer = document.createElement('div');
  const marker = document.createElement('div');

  root.className = 'rxtt';
  root.dataset.rxttOrientation = 'vertical';
  root.dataset.rxttPlacement = 'right';
  viewport.className = 'rxtt__viewport';
  markerLayer.className = 'rxtt__markers';
  marker.className = 'rxtt__marker';
  marker.style.setProperty('--rxtt-marker-size', '0%');
  markerLayer.append(marker);
  root.append(viewport, markerLayer);

  return { marker, markerLayer, root, viewport };
}

/**
 * Installs one application stylesheet that is removed after the current test.
 *
 * @param {string} cssText - Application CSS.
 * @returns {HTMLStyleElement} Installed style element.
 */
function installTestStyle(cssText) {
  const style = document.createElement('style');

  style.dataset.rxttTestStyle = '';
  style.textContent = cssText;
  document.head.append(style);

  return style;
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll('[data-rxtt-test-style]').forEach((style) => {
    style.remove();
  });
});

describe('Light DOM CSS use-site defaults', () => {
  it('provides the default appearance without declaring public tokens on the root', () => {
    const { marker, root, viewport } = createStandardTrackerTree();

    document.body.append(root);

    const rootStyle = getComputedStyle(root);

    expect(root.style.length).toBe(0);
    expect(rootStyle.getPropertyValue('--rxtt-track-bg')).toBe('');
    expect(rootStyle.backgroundColor).toBe('rgb(248, 249, 250)');
    expect(rootStyle.borderLeftWidth).toBe('1px');
    expect(rootStyle.borderLeftStyle).toBe('solid');
    expect(rootStyle.right).toBe('0px');
    expect(rootStyle.top).toBe('0px');
    expect(rootStyle.width).toBe('16px');
    expect(getComputedStyle(viewport).backgroundColor).toBe('rgba(108, 117, 125, 0.3)');
    expect(getComputedStyle(marker).backgroundColor).toBe('rgb(220, 53, 69)');
    expect(getComputedStyle(marker).borderTopWidth).toBe('0px');
    expect(getComputedStyle(marker).borderTopStyle).toBe('solid');
    expect(getComputedStyle(marker).minHeight).toBe('0px');
    expect(marker.getBoundingClientRect().height).toBe(2);

    root.tabIndex = 0;
    root.focus();
    expect(root.matches(':focus-visible')).toBe(true);
    expect(getComputedStyle(root).outlineStyle).toBe('solid');

    root.style.setProperty('--rxtt-track-border-style', 'dotted');
    expect(getComputedStyle(root).borderLeftStyle).toBe('dotted');
  });

  it('lets ancestor tokens override use-site defaults through inheritance', () => {
    const theme = document.createElement('div');
    const { marker, root } = createStandardTrackerTree();

    theme.style.setProperty('--rxtt-marker-bg', 'rgb(1 2 3)');
    theme.style.setProperty('--rxtt-track-thickness', '24px');
    theme.append(root);
    document.body.append(theme);

    expect(root.style.getPropertyValue('--rxtt-track-thickness')).toBe('');
    expect(getComputedStyle(root).width).toBe('24px');
    expect(getComputedStyle(marker).backgroundColor).toBe('rgb(1, 2, 3)');
  });

  it('lets unlayered application paint override the internal theme layer', () => {
    const { marker, root, viewport } = createStandardTrackerTree();

    installTestStyle(`
      .rxtt {
        background-color: rgb(10 20 30);
      }

      .rxtt > .rxtt__viewport {
        background-color: rgb(40 50 60);
      }

      .rxtt > .rxtt__markers > .rxtt__marker {
        background-color: rgb(70 80 90);
      }
    `);
    document.body.append(root);

    expect(getComputedStyle(root).backgroundColor).toBe('rgb(10, 20, 30)');
    expect(getComputedStyle(viewport).backgroundColor).toBe('rgb(40, 50, 60)');
    expect(getComputedStyle(marker).backgroundColor).toBe('rgb(70, 80, 90)');
  });

  it('keeps inline public variables authoritative over inherited variables and cleans them deterministically', () => {
    const theme = document.createElement('div');
    const { marker, root } = createStandardTrackerTree();

    theme.style.setProperty('--rxtt-marker-bg', 'rgb(1 2 3)');
    root.style.setProperty('--rxtt-marker-bg', 'rgb(4 5 6)');
    theme.append(root);
    document.body.append(theme);

    expect(getComputedStyle(marker).backgroundColor).toBe('rgb(4, 5, 6)');

    root.style.removeProperty('--rxtt-marker-bg');

    expect(getComputedStyle(marker).backgroundColor).toBe('rgb(1, 2, 3)');
  });

  it('supports count, symbol, none, and reset cluster content through one custom property', () => {
    const { marker, root } = createStandardTrackerTree();

    marker.dataset.rxttKind = 'cluster';
    marker.dataset.rxttCount = '7';
    document.body.append(root);

    expect(getComputedStyle(marker, '::after').content).toMatch(/7|attr\(data-rxtt-count\)/u);

    root.style.setProperty('--rxtt-cluster-content', '"★"');
    expect(getComputedStyle(marker, '::after').content).toContain('★');

    root.style.setProperty('--rxtt-cluster-content', 'none');
    expect(getComputedStyle(marker, '::after').content).toBe('none');

    root.style.removeProperty('--rxtt-cluster-content');
    expect(getComputedStyle(marker, '::after').content).toMatch(/7|attr\(data-rxtt-count\)/u);
  });

  it('applies static marker borders to markers and clusters without expanding marker geometry', () => {
    const { marker, markerLayer, root } = createStandardTrackerTree();
    const cluster = document.createElement('div');

    cluster.className = 'rxtt__marker';
    cluster.dataset.rxttKind = 'cluster';
    cluster.style.setProperty('--rxtt-marker-size', '0%');
    markerLayer.append(cluster);
    root.style.setProperty('--rxtt-marker-min-size', '12px');
    document.body.append(root);

    const heightBeforeBorder = marker.getBoundingClientRect().height;
    root.style.setProperty('--rxtt-marker-border-color', 'rgb(1 2 3)');
    root.style.setProperty('--rxtt-marker-border-width', '3px');
    root.style.setProperty('--rxtt-marker-border-style', 'dashed');

    for (const item of [marker, cluster]) {
      const style = getComputedStyle(item);
      expect(style.borderTopColor).toBe('rgb(1, 2, 3)');
      expect(style.borderTopWidth).toBe('3px');
      expect(style.borderTopStyle).toBe('dashed');
    }
    expect(marker.getBoundingClientRect().height).toBe(heightBeforeBorder);
    expect(getComputedStyle(marker).boxSizing).toBe('border-box');
  });

  it('uses base interaction rings as hover fallbacks and accepts hover-specific overrides', async () => {
    const { marker, root } = createStandardTrackerTree();

    root.style.setProperty('--rxtt-marker-ring-color', 'rgb(1 2 3)');
    root.style.setProperty('--rxtt-marker-ring-width', '2px');
    document.body.append(root);

    await userEvent.hover(marker);
    expect(getComputedStyle(marker).boxShadow).toContain('rgb(1, 2, 3)');
    expect(getComputedStyle(marker).boxShadow).toContain('2px');

    root.style.setProperty('--rxtt-marker-hover-ring-color', 'rgb(4 5 6)');
    root.style.setProperty('--rxtt-marker-hover-ring-width', '3px');
    expect(getComputedStyle(marker).boxShadow).toContain('rgb(4, 5, 6)');
    expect(getComputedStyle(marker).boxShadow).toContain('3px');
  });

  it('uses base interaction rings as selected fallbacks and lets selected styling win over hover styling', async () => {
    const { marker, root } = createStandardTrackerTree();

    root.tabIndex = 0;
    marker.dataset.rxttSelected = 'true';
    root.style.setProperty('--rxtt-marker-ring-color', 'rgb(1 2 3)');
    root.style.setProperty('--rxtt-marker-ring-width', '2px');
    root.style.setProperty('--rxtt-marker-hover-ring-color', 'rgb(4 5 6)');
    root.style.setProperty('--rxtt-marker-hover-ring-width', '3px');
    document.body.append(root);

    root.focus();
    expect(root.matches(':focus-visible')).toBe(true);
    await userEvent.hover(marker);
    expect(getComputedStyle(marker).boxShadow).toContain('rgb(1, 2, 3)');
    expect(getComputedStyle(marker).boxShadow).toContain('2px');

    root.style.setProperty('--rxtt-marker-selected-ring-color', 'rgb(7 8 9)');
    root.style.setProperty('--rxtt-marker-selected-ring-width', '4px');
    expect(getComputedStyle(marker).boxShadow).toContain('rgb(7, 8, 9)');
    expect(getComputedStyle(marker).boxShadow).toContain('4px');
  });

  it('lets focus outline style complement the existing focus outline properties', () => {
    const { root } = createStandardTrackerTree();

    root.tabIndex = 0;
    root.style.setProperty('--rxtt-focus-outline-color', 'rgb(1 2 3)');
    root.style.setProperty('--rxtt-focus-outline-width', '3px');
    root.style.setProperty('--rxtt-focus-outline-offset', '4px');
    root.style.setProperty('--rxtt-focus-outline-style', 'dashed');
    document.body.append(root);
    root.focus();

    const style = getComputedStyle(root);
    expect(root.matches(':focus-visible')).toBe(true);
    expect(style.outlineColor).toBe('rgb(1, 2, 3)');
    expect(style.outlineOffset).toBe('4px');
    expect(style.outlineStyle).toBe('dashed');
    expect(style.outlineWidth).toBe('3px');
  });

  it('exposes containment and overflow opt-outs without weakening structural positioning', () => {
    const { marker, markerLayer, root } = createStandardTrackerTree();

    document.body.append(root);

    expect(getComputedStyle(root).contain).toBe('layout paint');
    expect(getComputedStyle(root).overflow).toBe('hidden');

    root.style.setProperty('--rxtt-track-contain', 'none');
    root.style.setProperty('--rxtt-track-overflow', 'visible');

    expect(getComputedStyle(root).contain).toBe('none');
    expect(getComputedStyle(root).overflow).toBe('visible');
    expect(getComputedStyle(markerLayer).position).toBe('absolute');
    expect(getComputedStyle(marker).position).toBe('absolute');
  });

  it('keeps the selected ring inside default paint containment in every placement', () => {
    const placements = [
      { orientation: 'vertical', placement: 'left' },
      { orientation: 'vertical', placement: 'right' },
      { orientation: 'horizontal', placement: 'top' },
      { orientation: 'horizontal', placement: 'bottom' },
    ];

    placements.forEach(({ orientation, placement }) => {
      const { marker, root } = createStandardTrackerTree();

      root.dataset.rxttOrientation = orientation;
      root.dataset.rxttPlacement = placement;
      root.tabIndex = 0;
      marker.dataset.rxttSelected = 'true';
      document.body.append(root);
      root.focus();

      expect(root.matches(':focus-visible')).toBe(true);
      expect(getComputedStyle(marker).boxShadow).toContain('inset');
      expect(getComputedStyle(root).contain).toBe('layout paint');

      root.remove();
    });
  });

  it('protects structural invariants from representative generic application resets', () => {
    const { marker, markerLayer, root, viewport } = createStandardTrackerTree();

    installTestStyle(`
      * {
        box-sizing: content-box;
        margin: 13px;
        padding: 11px;
      }

      div {
        direction: rtl;
        display: inline;
        pointer-events: none;
        position: static;
        writing-mode: vertical-rl;
      }
    `);
    document.body.append(root);

    expect(getComputedStyle(root).boxSizing).toBe('border-box');
    expect(getComputedStyle(root).direction).toBe('ltr');
    expect(getComputedStyle(root).display).toBe('block');
    expect(getComputedStyle(root).marginTop).toBe('0px');
    expect(getComputedStyle(root).paddingTop).toBe('0px');
    expect(getComputedStyle(root).position).toBe('fixed');
    expect(getComputedStyle(root).writingMode).toBe('horizontal-tb');
    expect(getComputedStyle(viewport).position).toBe('absolute');
    expect(getComputedStyle(markerLayer).pointerEvents).toBe('none');
    expect(getComputedStyle(marker).boxSizing).toBe('border-box');
    expect(getComputedStyle(marker).display).toBe('block');
    expect(getComputedStyle(marker).marginTop).toBe('0px');
    expect(getComputedStyle(marker).paddingTop).toBe('0px');
    expect(getComputedStyle(marker).pointerEvents).toBe('auto');
    expect(getComputedStyle(marker).position).toBe('absolute');
  });

  it('styles only the documented direct-child service tree', () => {
    const detachedMarker = document.createElement('div');
    const wrapper = document.createElement('div');
    const nestedMarkerLayer = document.createElement('div');
    const nestedMarker = document.createElement('div');
    const { marker, root } = createStandardTrackerTree();

    detachedMarker.className = 'rxtt__marker';
    nestedMarkerLayer.className = 'rxtt__markers';
    nestedMarker.className = 'rxtt__marker';
    nestedMarkerLayer.append(nestedMarker);
    wrapper.append(nestedMarkerLayer);
    root.append(wrapper);
    document.body.append(root, detachedMarker);

    expect(getComputedStyle(marker).position).toBe('absolute');
    expect(getComputedStyle(nestedMarker).position).toBe('static');
    expect(getComputedStyle(detachedMarker).position).toBe('static');
  });

  it('requires the canonical stylesheet in each user-managed ShadowRoot style scope', () => {
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const firstTree = createStandardTrackerTree();

    shadowRoot.append(firstTree.root);
    document.body.append(host);

    expect(getComputedStyle(firstTree.root).backgroundColor).toBe('rgba(0, 0, 0, 0)');

    const localStyle = document.createElement('style');
    const secondTree = createStandardTrackerTree();

    localStyle.textContent = canonicalTrackerCss;
    shadowRoot.replaceChildren(localStyle, secondTree.root);

    expect(getComputedStyle(secondTree.root).backgroundColor).toBe('rgb(248, 249, 250)');
    expect(getComputedStyle(secondTree.marker).backgroundColor).toBe('rgb(220, 53, 69)');
  });
});
