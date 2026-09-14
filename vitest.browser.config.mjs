import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config.mjs';

/** Unit-test project whose Angular compiler plugins are also required by browser tests. */
const angularProject = baseConfig.test.projects.find((project) => project.test?.name === 'angular');

if (angularProject === undefined) {
  throw new Error('The browser test configuration requires the Angular Vitest project.');
}

/** Browser-only project isolated from the unit-test project matrix. */
const browserProject = {
  ...angularProject,
  test: {
    ...angularProject.test,
    name: 'browser',
    include: ['tests/browser/**/*.browser.test.js'],
    exclude: [],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
      viewport: {
        width: 1280,
        height: 720,
      },
    },
  },
};

export default defineConfig({
  ...baseConfig,
  optimizeDeps: {
    include: [
      '@angular/compiler',
      '@angular/core',
      '@angular/platform-browser',
      'react',
      'react/jsx-dev-runtime',
      'react-dom/client',
      'vue',
    ],
  },
  resolve: {
    ...baseConfig.resolve,
    dedupe: ['@angular/compiler', '@angular/core', '@angular/platform-browser', 'react', 'react-dom', 'vue'],
  },
  test: {
    ...baseConfig.test,
    projects: [browserProject],
  },
});
