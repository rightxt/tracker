/** Enhances the static TOC for this document's lifetime without owning navigation. */
function enhanceDocumentationToc() {
  if (!('IntersectionObserver' in window)) {
    return;
  }
  const links = new Map(
    [...document.querySelectorAll('.docs-toc a[href^="#"]')].map((link) => [
      decodeURIComponent(link.hash.slice(1)),
      link,
    ]),
  );
  const headings = [...document.querySelectorAll('.docs-content h2[id], .docs-content h3[id]')].filter((heading) =>
    links.has(heading.id),
  );
  if (headings.length === 0) {
    return;
  }
  const pagination = document.querySelector('.docs-pagination');
  let activeLink;
  let headingObserver;
  let observedSize = '';

  /** Selects the last heading at the reading edge, or the final section at the document end. */
  function updateCurrentSection() {
    const readingEdge = 32;
    let heading = headings.findLast((target) => target.getBoundingClientRect().top <= readingEdge);
    if (heading && pagination && pagination.getBoundingClientRect().top <= window.innerHeight) {
      heading = headings.at(-1);
    }
    const nextLink = heading ? links.get(heading.id) : undefined;
    if (nextLink !== activeLink) {
      activeLink?.removeAttribute('aria-current');
      nextLink?.setAttribute('aria-current', 'location');
      activeLink = nextLink;
    }
  }

  /** Keeps the observer's reading edge stable through resizing and content reflow. */
  function observeHeadings() {
    const height = document.documentElement.scrollHeight;
    const size = `${height}:${window.innerHeight}`;
    if (size !== observedSize) {
      observedSize = size;
      headingObserver?.disconnect();
      // Extend above the whole document so even a jump past a heading changes its intersection state.
      headingObserver = new IntersectionObserver(updateCurrentSection, {
        rootMargin: `${height}px 0px ${32 - window.innerHeight}px 0px`,
      });
      for (const heading of headings) {
        headingObserver.observe(heading);
      }
    }
    updateCurrentSection();
  }

  const endObserver = new IntersectionObserver(updateCurrentSection);
  if (pagination) {
    endObserver.observe(pagination);
  }
  const resizeObserver = new ResizeObserver(observeHeadings);
  resizeObserver.observe(document.body);
  window.addEventListener('resize', observeHeadings);
  window.addEventListener('hashchange', updateCurrentSection);
  observeHeadings();
}

enhanceDocumentationToc();
