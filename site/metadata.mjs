import rootManifest from '../package.json' with { type: 'json' };

import { PUBLIC_URL } from './config.mjs';

/** Shared identity and document defaults for every published HTML file. */
const SITE_METADATA = Object.freeze({
  author: rootManifest.author,
  baseUrl: PUBLIC_URL,
  language: 'en',
  locale: 'en_US',
  name: 'RXT Tracker',
  robots: 'max-image-preview:large',
  viewport: 'width=device-width, initial-scale=1',
  image: Object.freeze({
    alt: 'RXT Tracker social preview with JavaScript, Web Components, Vue, Angular, and React logos.',
    height: '630',
    path: 'assets/social-preview.jpg',
    source: 'shared/social-preview.jpg',
    type: 'image/jpeg',
    width: '1200',
  }),
});

/** Explicit public document metadata for the landing page. */
const HOME_METADATA = Object.freeze({
  description:
    'RXT Tracker adds a visual overview to scrollable pages and containers with viewport indicators, markers, clustering, and navigation.',
  kind: 'home',
  route: '',
  documentTitle: 'RXT Tracker — Visual Scroll-Position Tracker',
});

export { HOME_METADATA, SITE_METADATA };
