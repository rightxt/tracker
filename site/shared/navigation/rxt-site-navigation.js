import { getNavigationLinks, getSourceAction } from './model.js';

/** Adds route-depth-safe navigation to one generated site page. */
function installSiteNavigation() {
  if (document.querySelector('.site-navigation') !== null) {
    return;
  }
  const page = Reflect.get(globalThis, 'RXT_SITE_PAGE');
  const hasValidSourceUrl =
    page !== null &&
    typeof page === 'object' &&
    (page.sourceUrl === undefined || (typeof page.sourceUrl === 'string' && page.sourceUrl.length > 0));
  if (
    page === null ||
    typeof page !== 'object' ||
    typeof page.route !== 'string' ||
    typeof page.trackerVersion !== 'string' ||
    page.trackerVersion.length === 0 ||
    !hasValidSourceUrl
  ) {
    throw new Error('Generated site page descriptor is missing or invalid.');
  }

  const navigation = document.createElement('nav');
  navigation.className = 'site-navigation';
  navigation.setAttribute('aria-label', 'Site navigation');

  const identity = document.createElement('span');
  identity.className = 'site-navigation__identity';
  const brand = document.createElement('span');
  brand.className = 'site-navigation__brand';
  brand.textContent = 'RXT Tracker';
  const version = document.createElement('span');
  version.className = 'site-navigation__version';
  version.textContent = `v${page.trackerVersion}`;
  identity.append(brand, version);

  const links = document.createElement('span');
  links.className = 'site-navigation__links';
  for (const { label, href } of getNavigationLinks(page.route)) {
    const link = document.createElement('a');
    link.className = 'site-navigation__link';
    link.href = href;
    link.textContent = label;
    links.append(link);
  }
  navigation.append(identity, links);
  const bar = document.createElement('div');
  bar.className = 'site-bar';
  bar.append(navigation);
  const source = getSourceAction(page);
  if (source !== undefined) {
    const link = document.createElement('a');
    link.className = 'site-source';
    link.href = source.href;
    link.textContent = source.label;
    bar.append(link);
  }
  const skip = document.querySelector('.docs-skip');
  if (skip === null) {
    document.body.prepend(bar);
  } else {
    skip.after(bar);
  }
}

installSiteNavigation();

export { installSiteNavigation };
