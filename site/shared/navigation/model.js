/**
 * Returns a deployment-depth-safe link to the aggregate catalog.
 *
 * @param {string} route Current root-relative route, empty for the catalog.
 * @returns {string} Relative catalog href.
 */
function getHomeHref(route) {
  const depth = route.split('/').filter(Boolean).length;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/**
 * Shared navigation destinations for static markup and optional browser installation.
 *
 * @param {string} route Current root-relative route.
 * @returns {{ label: string, href: string }[]} Ordered visible navigation actions.
 */
function getNavigationLinks(route) {
  const home = getHomeHref(route);
  return [
    { label: 'Home', href: home },
    { label: 'Docs', href: `${home}docs/` },
    { label: 'Demos', href: `${home}#demos` },
    { label: 'Theme Builder', href: `${home}tools/theme-builder/` },
  ];
}

/**
 * Resolves the optional demo action independently of global navigation.
 *
 * @param {{ kind?: string, showSource?: boolean, sourceUrl?: string }} page Page capability and destination.
 * @returns {{ label: string, href: string } | undefined} Configured demo Source action only.
 */
function getSourceAction(page) {
  return page.kind === 'demo' && page.showSource !== false && page.sourceUrl !== undefined
    ? { label: 'Source', href: page.sourceUrl }
    : undefined;
}

export { getHomeHref, getNavigationLinks, getSourceAction };
