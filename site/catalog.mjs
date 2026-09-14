/** Authoritative Tracker build profile selected by each demo kind. */
const TRACKER_PROFILE_BY_DEMO_KIND = Object.freeze({
  playground: 'debug',
  recipe: 'production',
  scenario: 'debug',
});

/** Site catalog definitions before demo-owned Tracker profiles are attached. */
const siteEntryDefinitions = [
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs',
    source: 'README.md',
    navGroup: 'overview',
    navOrder: 0,
    navTitle: 'Overview',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/packages/core',
    source: 'packages/core/README.md',
    navGroup: 'packages',
    navOrder: 0,
    navTitle: 'Core',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/packages/vanilla',
    source: 'packages/vanilla/README.md',
    navGroup: 'packages',
    navOrder: 1,
    navTitle: 'Vanilla',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/packages/element',
    source: 'packages/element/README.md',
    navGroup: 'packages',
    navOrder: 2,
    navTitle: 'Element',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/packages/react',
    source: 'packages/react/README.md',
    navGroup: 'packages',
    navOrder: 3,
    navTitle: 'React',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/packages/vue',
    source: 'packages/vue/README.md',
    navGroup: 'packages',
    navOrder: 4,
    navTitle: 'Vue',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/packages/angular',
    source: 'packages/angular/README.md',
    navGroup: 'packages',
    navOrder: 5,
    navTitle: 'Angular',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/guides/environments',
    source: 'docs/guides/environments.md',
    navGroup: 'guides',
    navOrder: 0,
    navTitle: 'Environments',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/guides/updates-and-refresh',
    source: 'docs/guides/updates-and-refresh.md',
    navGroup: 'guides',
    navOrder: 1,
    navTitle: 'Updates and manual refresh',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/guides/rules-and-marker-behavior',
    source: 'docs/guides/rules-and-marker-behavior.md',
    navGroup: 'guides',
    navOrder: 2,
    navTitle: 'Rules and marker behavior',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/guides/custom-integration',
    source: 'docs/guides/custom-integration.md',
    navGroup: 'guides',
    navOrder: 3,
    navTitle: 'Custom integration',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/guides/cdn',
    source: 'docs/guides/cdn.md',
    navGroup: 'guides',
    navOrder: 4,
    navTitle: 'CDN',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/reference/styling',
    source: 'docs/reference/styling.md',
    navGroup: 'reference',
    navOrder: 0,
    navTitle: 'Styling',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/reference/core-api',
    source: 'docs/reference/core-api.md',
    navGroup: 'reference',
    navOrder: 1,
    navTitle: 'Core API',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/reference/core-rendering',
    source: 'docs/reference/core-rendering.md',
    navGroup: 'reference',
    navOrder: 2,
    navTitle: 'Projection and Direct Renderer',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    route: 'docs/reference/core-runtime',
    source: 'docs/reference/core-runtime.md',
    navGroup: 'reference',
    navOrder: 3,
    navTitle: 'Runtime state, diagnostics and debug',
  },
  {
    buildKind: 'static',
    kind: 'tool',
    description: 'Customize the public RXT Tracker CSS theme contract and export application overrides.',
    route: 'tools/theme-builder',
    showSource: false,
    source: 'tools/theme-builder',
    title: 'Theme Builder',
  },
  {
    buildKind: 'consumer',
    demoKind: 'recipe',
    kind: 'demo',
    description: 'Review outstanding caption timing candidates across a zoomable horizontal audio timeline.',
    integration: 'vanilla',
    route: 'recipes/audio-review',
    source: 'demos/recipes/audio-review',
    title: 'Audio caption review',
  },
  {
    buildKind: 'consumer',
    demoKind: 'recipe',
    kind: 'demo',
    description: 'Navigate unresolved attention and critical events in a bounded live activity stream.',
    integration: 'vanilla',
    route: 'recipes/activity-stream',
    source: 'demos/recipes/activity-stream',
    title: 'Activity stream',
  },
  {
    buildKind: 'consumer',
    demoKind: 'recipe',
    kind: 'demo',
    description: 'Navigate a long, structured report with stable semantic markers.',
    integration: 'vanilla',
    route: 'recipes/document',
    source: 'demos/recipes/document',
    title: 'Long document',
  },
  {
    buildKind: 'consumer',
    demoKind: 'recipe',
    kind: 'demo',
    description: 'Navigate validation errors and completion states in an extended form.',
    integration: 'vanilla',
    route: 'recipes/form',
    source: 'demos/recipes/form',
    title: 'Extended form',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'See how rule priority, computed labels, and activation target resolvers determine marker behavior.',
    integration: 'vanilla',
    route: 'scenarios/rule-resolution',
    source: 'demos/scenarios/rule-resolution',
    title: 'Rule resolution',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Compare equivalent public styling mechanisms and two unconventional page-level themes.',
    integration: 'vanilla',
    route: 'scenarios/styling',
    source: 'demos/scenarios/styling',
    title: 'Styling contract',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'See how nearby physical marker positions merge into clusters and split as the threshold changes.',
    integration: 'vanilla',
    route: 'scenarios/clustering',
    source: 'demos/scenarios/clustering',
    title: 'Marker clustering',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description:
      'Explore accessible rail naming, keyboard selection, activation, and the distinction between focus and Tracker selection.',
    integration: 'vanilla',
    route: 'scenarios/accessibility',
    source: 'demos/scenarios/accessibility',
    title: 'Accessibility and keyboard navigation',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Compare source-scoped mutation observation with explicit body targets.',
    integration: 'vanilla',
    route: 'scenarios/observation',
    source: 'demos/scenarios/observation',
    title: 'Observation scope',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Compare physical Tracker axes across representative CSS writing modes and directions.',
    integration: 'vanilla',
    route: 'scenarios/writing-mode',
    source: 'demos/scenarios/writing-mode',
    title: 'Writing modes',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Bind a React Tracker to an external HTMLElement source and scroll root through DOM refs.',
    integration: 'react',
    route: 'scenarios/container/react',
    source: 'demos/scenarios/container/react',
    title: 'React container',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Bind a Vue Tracker to an external HTMLElement source and scroll root through reactive DOM refs.',
    integration: 'vue',
    route: 'scenarios/container/vue',
    source: 'demos/scenarios/container/vue',
    title: 'Vue container',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Bind an Angular Tracker to an external HTMLElement source and scroll root through signal queries.',
    integration: 'angular',
    route: 'scenarios/container/angular',
    source: 'demos/scenarios/container/angular',
    title: 'Angular container',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Render and observe a Vanilla Tracker entirely inside a user-managed ShadowRoot.',
    integration: 'vanilla',
    route: 'scenarios/shadow-dom-vanilla',
    source: 'demos/scenarios/shadow-dom-vanilla',
    title: 'Vanilla in Shadow DOM',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Track sources inside an open ShadowRoot while the Element renderer remains in Light DOM.',
    integration: 'element',
    route: 'scenarios/shadow-dom-element',
    source: 'demos/scenarios/shadow-dom-element',
    title: 'Element and Shadow DOM',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'See how one parent-owned Vanilla Tracker mounts into same-origin iframe contexts across navigation.',
    integration: 'vanilla',
    route: 'scenarios/iframe-vanilla',
    source: 'demos/scenarios/iframe-vanilla',
    title: 'Iframe document context',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Inspect public runtime events, lifecycle, and handler ownership through the Vanilla API.',
    integration: 'vanilla',
    route: 'scenarios/events/vanilla',
    source: 'demos/scenarios/events/vanilla',
    title: 'Runtime events — Vanilla',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Inspect public runtime events and lifecycle through native Custom Events.',
    integration: 'element',
    route: 'scenarios/events/element',
    source: 'demos/scenarios/events/element',
    title: 'Runtime events — Element',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Inspect public runtime events, callback errors, and teardown through React props.',
    integration: 'react',
    route: 'scenarios/events/react',
    source: 'demos/scenarios/events/react',
    title: 'Runtime events — React',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Inspect public runtime events, listener errors, and teardown through Vue emits.',
    integration: 'vue',
    route: 'scenarios/events/vue',
    source: 'demos/scenarios/events/vue',
    title: 'Runtime events — Vue',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Inspect public runtime events, output errors, and teardown through Angular outputs.',
    integration: 'angular',
    route: 'scenarios/events/angular',
    source: 'demos/scenarios/events/angular',
    title: 'Runtime events — Angular',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Compare recoverable diagnostics, retained stats, and synchronous failure boundaries.',
    integration: 'vanilla',
    route: 'scenarios/diagnostics',
    source: 'demos/scenarios/diagnostics',
    title: 'Diagnostics and failure boundaries',
  },
  {
    buildKind: 'consumer',
    demoKind: 'playground',
    kind: 'demo',
    description:
      'Explore complete configuration, events, rendering commands, and diagnostics through the imperative Vanilla API.',
    integration: 'vanilla',
    route: 'playgrounds/vanilla',
    source: 'demos/playgrounds/vanilla',
    title: 'Vanilla playground',
  },
  {
    buildKind: 'consumer',
    demoKind: 'playground',
    kind: 'demo',
    description: 'Explore Custom Element properties, methods, and native event delivery.',
    integration: 'element',
    route: 'playgrounds/element',
    source: 'demos/playgrounds/element',
    title: 'Element playground',
  },
  {
    buildKind: 'consumer',
    demoKind: 'playground',
    kind: 'demo',
    description: 'Explore immutable React props, callbacks, and the limited ref handle.',
    integration: 'react',
    route: 'playgrounds/react',
    source: 'demos/playgrounds/react',
    title: 'React playground',
  },
  {
    buildKind: 'consumer',
    demoKind: 'playground',
    kind: 'demo',
    description: 'Explore Vue replacement-driven props, emits, and the exposed handle.',
    integration: 'vue',
    route: 'playgrounds/vue',
    source: 'demos/playgrounds/vue',
    title: 'Vue playground',
  },
  {
    buildKind: 'consumer',
    demoKind: 'playground',
    kind: 'demo',
    description: 'Explore Angular signal inputs, outputs, and public component methods.',
    integration: 'angular',
    route: 'playgrounds/angular',
    source: 'demos/playgrounds/angular',
    title: 'Angular playground',
  },
];

/** Immutable site catalog with demo profiles derived exclusively from demo-kind policy. */
const siteEntries = Object.freeze(
  siteEntryDefinitions.map((entry) => {
    if (entry.kind !== 'demo') {
      return Object.freeze({ ...entry });
    }
    if (Object.hasOwn(entry, 'trackerProfile')) {
      throw new Error(`${entry.route} must not override its demo-kind-owned Tracker profile.`);
    }
    const trackerProfile = TRACKER_PROFILE_BY_DEMO_KIND[entry.demoKind];
    if (trackerProfile === undefined) {
      throw new Error(`No Tracker profile is defined for demo kind ${String(entry.demoKind)}.`);
    }
    return Object.freeze({ ...entry, trackerProfile });
  }),
);

const demos = Object.freeze(siteEntries.filter((entry) => entry.kind === 'demo'));

/** Ordered documentation groups; page membership/order remains catalog-owned. */
const DOCUMENTATION_GROUPS = Object.freeze({
  overview: 'Overview',
  packages: 'Packages',
  guides: 'Guides',
  reference: 'Reference',
});

/**
 * Rejects ambiguous routes, source paths, classifications, and navigation positions.
 *
 * @param {object[]} entries Catalog entries to validate.
 * @throws {Error} For unsupported or ambiguous route/build/navigation metadata.
 */
function validateSiteEntries(entries) {
  const routes = new Set();
  const positions = new Set();
  const sources = new Set();
  for (const entry of entries) {
    if (typeof entry.route !== 'string' || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u.test(entry.route)) {
      throw new Error(`Invalid normalized site route: ${String(entry.route)}.`);
    }
    if (routes.has(entry.route)) {
      throw new Error(`Duplicate site route: ${entry.route}.`);
    }
    routes.add(entry.route);
    const buildKind = { demo: 'consumer', tool: 'static', documentation: 'markdown' }[entry.kind];
    if (buildKind === undefined || buildKind !== entry.buildKind) {
      throw new Error(`Unsupported kind/buildKind for ${entry.route}.`);
    }
    if (
      entry.kind === 'demo' &&
      (!Object.hasOwn(TRACKER_PROFILE_BY_DEMO_KIND, entry.demoKind) ||
        entry.trackerProfile !== TRACKER_PROFILE_BY_DEMO_KIND[entry.demoKind])
    ) {
      throw new Error(`Invalid Tracker profile for ${entry.route}.`);
    }
    if (entry.kind === 'documentation') {
      if (typeof entry.source !== 'string' || !/^(?:[\w-]+\/)*[\w-]+\.md$/u.test(entry.source)) {
        throw new Error(`Invalid repository Markdown source for ${entry.route}.`);
      }
      if (sources.has(entry.source)) {
        throw new Error(`Duplicate documentation source: ${entry.source}.`);
      }
      sources.add(entry.source);
      if (
        !Object.hasOwn(DOCUMENTATION_GROUPS, entry.navGroup) ||
        !Number.isInteger(entry.navOrder) ||
        entry.navOrder < 0
      ) {
        throw new Error(`Missing or invalid documentation navigation metadata for ${entry.route}.`);
      }
      const position = `${entry.navGroup}:${entry.navOrder}`;
      if (positions.has(position)) {
        throw new Error(`Duplicate documentation navigation position: ${position}.`);
      }
      positions.add(position);
    }
  }
}

validateSiteEntries(siteEntries);

export { DOCUMENTATION_GROUPS, TRACKER_PROFILE_BY_DEMO_KIND, demos, siteEntries, validateSiteEntries };
