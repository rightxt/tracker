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
    documentTitle: 'Overview · RXT Tracker Docs',
    route: 'docs',
    description: 'Discover RXT Tracker packages, installation options, and the visual scroll-position tracking model.',
    source: 'README.md',
    navGroup: 'overview',
    navOrder: 0,
    navTitle: 'Overview',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: '@rightxt/tracker-core · RXT Tracker Docs',
    route: 'docs/packages/core',
    description: 'Use the shared Tracker runtime for configuration, geometry, markers, and custom integrations.',
    source: 'packages/core/README.md',
    navGroup: 'packages',
    navOrder: 0,
    navTitle: 'Core',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: '@rightxt/tracker-vanilla · RXT Tracker Docs',
    route: 'docs/packages/vanilla',
    description: 'Install and control RXT Tracker through the imperative Vanilla JavaScript API and direct renderer.',
    source: 'packages/vanilla/README.md',
    navGroup: 'packages',
    navOrder: 1,
    navTitle: 'Vanilla',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: '@rightxt/tracker-element · RXT Tracker Docs',
    route: 'docs/packages/element',
    description: 'Integrate the RXT Tracker Custom Element with properties, methods, native events, and Shadow DOM.',
    source: 'packages/element/README.md',
    navGroup: 'packages',
    navOrder: 2,
    navTitle: 'Element',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: '@rightxt/tracker-react · RXT Tracker Docs',
    route: 'docs/packages/react',
    description: 'Integrate RXT Tracker in React with immutable props, callbacks, and the public ref handle.',
    source: 'packages/react/README.md',
    navGroup: 'packages',
    navOrder: 3,
    navTitle: 'React',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: '@rightxt/tracker-vue · RXT Tracker Docs',
    route: 'docs/packages/vue',
    description: 'Integrate RXT Tracker in Vue with reactive props, emitted events, and exposed component methods.',
    source: 'packages/vue/README.md',
    navGroup: 'packages',
    navOrder: 4,
    navTitle: 'Vue',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: '@rightxt/tracker-angular · RXT Tracker Docs',
    route: 'docs/packages/angular',
    description: 'Integrate RXT Tracker in Angular with signal inputs, outputs, and public component methods.',
    source: 'packages/angular/README.md',
    navGroup: 'packages',
    navOrder: 5,
    navTitle: 'Angular',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Environments · RXT Tracker Docs',
    route: 'docs/guides/environments',
    description: 'Configure Tracker for scroll containers, Shadow DOM, iframes, and server-rendered environments.',
    source: 'docs/guides/environments.md',
    navGroup: 'guides',
    navOrder: 0,
    navTitle: 'Environments',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Updates and manual refresh · RXT Tracker Docs',
    route: 'docs/guides/updates-and-refresh',
    description: 'Understand automatic Tracker updates, observation boundaries, and when to request a manual refresh.',
    source: 'docs/guides/updates-and-refresh.md',
    navGroup: 'guides',
    navOrder: 1,
    navTitle: 'Updates and manual refresh',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Rules and marker behavior · RXT Tracker Docs',
    route: 'docs/guides/rules-and-marker-behavior',
    description: 'Define target rules, resolve marker behavior, and control clustering and navigation in Tracker.',
    source: 'docs/guides/rules-and-marker-behavior.md',
    navGroup: 'guides',
    navOrder: 2,
    navTitle: 'Rules and marker behavior',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Custom integration · RXT Tracker Docs',
    route: 'docs/guides/custom-integration',
    description: 'Build a custom Tracker integration using Core lifecycle, projection, and renderer contracts.',
    source: 'docs/guides/custom-integration.md',
    navGroup: 'guides',
    navOrder: 3,
    navTitle: 'Custom integration',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'CDN · RXT Tracker Docs',
    route: 'docs/guides/cdn',
    description: 'Load published Tracker packages and styles from a CDN without a local bundler.',
    source: 'docs/guides/cdn.md',
    navGroup: 'guides',
    navOrder: 4,
    navTitle: 'CDN',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Styling · RXT Tracker Docs',
    route: 'docs/reference/styling',
    description: 'Customize Tracker appearance with public CSS variables, parts, layout rules, and theme overrides.',
    source: 'docs/reference/styling.md',
    navGroup: 'reference',
    navOrder: 0,
    navTitle: 'Styling',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Core API · RXT Tracker Docs',
    route: 'docs/reference/core-api',
    description: 'Reference Core configuration, commands, events, and public types for Tracker integrations.',
    source: 'docs/reference/core-api.md',
    navGroup: 'reference',
    navOrder: 1,
    navTitle: 'Core API',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Projection and Direct Renderer · RXT Tracker Docs',
    route: 'docs/reference/core-rendering',
    description: 'Understand Tracker projection snapshots and direct renderer responsibilities and lifecycle.',
    source: 'docs/reference/core-rendering.md',
    navGroup: 'reference',
    navOrder: 2,
    navTitle: 'Projection and Direct Renderer',
  },
  {
    kind: 'documentation',
    buildKind: 'markdown',
    documentTitle: 'Runtime state, diagnostics and debug · RXT Tracker Docs',
    route: 'docs/reference/core-runtime',
    description: 'Inspect Tracker runtime state, diagnostics, debug statistics, and failure boundaries.',
    source: 'docs/reference/core-runtime.md',
    navGroup: 'reference',
    navOrder: 3,
    navTitle: 'Runtime state, diagnostics and debug',
  },
  {
    buildKind: 'static',
    kind: 'tool',
    description: 'Customize the public RXT Tracker CSS theme contract and export application overrides.',
    documentTitle: 'Theme Builder · RXT Tracker',
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
    documentTitle: 'Audio caption review · RXT Tracker',
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
    documentTitle: 'Activity stream · RXT Tracker',
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
    documentTitle: 'Long document · RXT Tracker',
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
    documentTitle: 'Extended form · RXT Tracker',
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
    documentTitle: 'Rule resolution · RXT Tracker',
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
    documentTitle: 'Styling contract · RXT Tracker',
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
    documentTitle: 'Marker clustering · RXT Tracker',
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
    documentTitle: 'Accessibility and keyboard navigation · RXT Tracker',
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
    documentTitle: 'Mutation observation scope · RXT Tracker',
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
    documentTitle: 'Writing modes · RXT Tracker',
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
    documentTitle: 'React scroll container · RXT Tracker',
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
    documentTitle: 'Vue scroll container · RXT Tracker',
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
    documentTitle: 'Angular scroll container · RXT Tracker',
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
    documentTitle: 'Vanilla in Shadow DOM · RXT Tracker',
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
    documentTitle: 'Element and Shadow DOM · RXT Tracker',
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
    documentTitle: 'Iframe document context · RXT Tracker',
    route: 'scenarios/iframe-vanilla',
    pages: [
      {
        description: 'Tracked child document for the RXT Tracker iframe scenario.',
        documentTitle: 'Tracked iframe child document · RXT Tracker',
        file: 'child.html',
      },
    ],
    source: 'demos/scenarios/iframe-vanilla',
    title: 'Iframe document context',
  },
  {
    buildKind: 'consumer',
    demoKind: 'scenario',
    kind: 'demo',
    description: 'Inspect public runtime events, lifecycle, and handler ownership through the Vanilla API.',
    integration: 'vanilla',
    documentTitle: 'Runtime events — Vanilla · RXT Tracker',
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
    documentTitle: 'Runtime events — Element · RXT Tracker',
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
    documentTitle: 'Runtime events — React · RXT Tracker',
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
    documentTitle: 'Runtime events — Vue · RXT Tracker',
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
    documentTitle: 'Runtime events — Angular · RXT Tracker',
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
    documentTitle: 'Diagnostics and failure boundaries · RXT Tracker',
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
    documentTitle: 'Vanilla playground · RXT Tracker',
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
    documentTitle: 'Element playground · RXT Tracker',
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
    documentTitle: 'React playground · RXT Tracker',
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
    documentTitle: 'Vue playground · RXT Tracker',
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
    documentTitle: 'Angular playground · RXT Tracker',
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
    if (typeof entry.documentTitle !== 'string' || entry.documentTitle.trim() === '') {
      throw new Error(`Missing documentTitle for ${entry.route}.`);
    }
    if (typeof entry.description !== 'string' || entry.description.trim() === '') {
      throw new Error(`Missing page description for ${entry.route}.`);
    }
    if (entry.kind !== 'documentation' && (typeof entry.title !== 'string' || entry.title.trim() === '')) {
      throw new Error(`Missing page title for ${entry.route}.`);
    }
    const files = new Set(['index.html']);
    for (const page of entry.pages ?? []) {
      if (typeof page.file !== 'string' || !/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html$/u.test(page.file)) {
        throw new Error(`Invalid secondary HTML file for ${entry.route}.`);
      }
      if (files.has(page.file)) {
        throw new Error(`Duplicate secondary HTML file for ${entry.route}: ${page.file}.`);
      }
      files.add(page.file);
      if (['documentTitle', 'description'].some((key) => typeof page[key] !== 'string' || page[key].trim() === '')) {
        throw new Error(`Missing secondary HTML metadata for ${entry.route}/${page.file}.`);
      }
    }
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
