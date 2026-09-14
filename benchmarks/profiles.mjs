/** Canonical metadata for every independently runnable benchmark family. */
const BENCHMARK_PROFILES = Object.freeze([
  {
    browser: false,
    buildTarget: 'Core source internals bundled by Vite SSR',
    id: 'projection-boundary',
    name: 'Projection boundary matrix',
    nodeArguments: [],
    preparation: 'source-bundle',
    provenance: 'source-production-mode',
    reportPrefix: 'projection-boundary',
    runner: 'benchmarks/projection-boundary.mjs',
    smoke: true,
  },
  {
    browser: false,
    buildTarget: 'Core Direct Renderer source SPI bundled by Vite SSR',
    id: 'core-render-pipeline',
    name: 'Core render pipeline (JSDOM)',
    nodeArguments: [],
    preparation: 'source-bundle',
    provenance: 'source-production-mode',
    reportPrefix: 'core-render-pipeline',
    runner: 'benchmarks/core-render-pipeline.mjs',
    smoke: true,
  },
  {
    browser: true,
    buildTarget: '@rightxt/tracker-vanilla production dist',
    id: 'styled-light-dom-browser',
    name: 'Styled Light DOM browser benchmark',
    nodeArguments: [],
    preparation: 'production-build',
    provenance: 'production-dist',
    reportPrefix: 'styled-light-dom-browser',
    runner: 'benchmarks/styled-light-dom-browser.mjs',
    smoke: true,
  },
  {
    browser: true,
    buildTarget: '@rightxt/tracker-vanilla production dist',
    id: 'core-render-browser',
    name: 'Core render browser benchmark',
    nodeArguments: [],
    preparation: 'production-build',
    provenance: 'production-dist',
    reportPrefix: 'core-render-browser',
    runner: 'benchmarks/core-render-browser.mjs',
    smoke: true,
  },
  {
    browser: false,
    buildTarget: '@rightxt/tracker-core/projection production dist',
    id: 'retention-memory',
    name: 'Retention/memory benchmark',
    nodeArguments: ['--expose-gc'],
    preparation: 'production-build',
    provenance: 'production-dist',
    reportPrefix: 'retention-memory',
    runner: 'benchmarks/retention-memory.mjs',
    smoke: true,
  },
  {
    browser: true,
    buildTarget: 'framework adapters and Core production dist',
    id: 'adapter-browser',
    name: 'Adapter/framework browser benchmark',
    nodeArguments: [],
    preparation: 'adapter-bridges',
    provenance: 'production-dist',
    reportPrefix: 'adapter-browser',
    runner: 'benchmarks/adapter-browser.mjs',
    smoke: true,
  },
]);

/**
 * Validates registry invariants needed by every benchmark execution.
 *
 * This deliberately checks structural uniqueness and runnable metadata rather
 * than snapshotting the current profile list or profile-specific choices.
 *
 * @param {readonly Record<string, unknown>[]} profiles Registry candidates.
 * @returns {void}
 */
function validateBenchmarkProfiles(profiles) {
  const ids = new Set();
  const reportPrefixes = new Set();

  for (const profile of profiles) {
    for (const field of ['id', 'name', 'preparation', 'provenance', 'reportPrefix', 'runner']) {
      if (typeof profile[field] !== 'string' || profile[field].trim() === '') {
        throw new Error(`Benchmark profile has invalid ${field} metadata.`);
      }
    }
    if (ids.has(profile.id)) {
      throw new Error(`Duplicate benchmark profile id "${profile.id}".`);
    }
    if (reportPrefixes.has(profile.reportPrefix)) {
      throw new Error(`Duplicate benchmark report prefix "${profile.reportPrefix}".`);
    }
    if (!Array.isArray(profile.nodeArguments) || typeof profile.smoke !== 'boolean') {
      throw new Error(`Benchmark profile "${profile.id}" has invalid execution metadata.`);
    }
    ids.add(profile.id);
    reportPrefixes.add(profile.reportPrefix);
  }
}

validateBenchmarkProfiles(BENCHMARK_PROFILES);

/** Returns canonical metadata for a registered profile. */
function getBenchmarkProfile(profileId) {
  const profile = BENCHMARK_PROFILES.find(({ id }) => id === profileId);

  if (profile === undefined) {
    throw new Error(`Unknown benchmark profile "${profileId}".`);
  }

  return profile;
}

export { BENCHMARK_PROFILES, getBenchmarkProfile, validateBenchmarkProfiles };
