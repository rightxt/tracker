import { computed, createApp, defineComponent, h, ref, shallowRef } from 'vue';
import { Tracker } from '@rightxt/tracker-vue';
import '@rightxt/tracker-vue/style.css';
import './shared/base.css';
import './styles.css';

/** Shared deterministic fixture profiles used by every framework variant. */
const CONTAINER_PROFILES = {
  a: { id: 'container-a', label: 'Container A', prefix: 'A', targetCount: 5 },
  b: { id: 'container-b', label: 'Container B', prefix: 'B', targetCount: 3 },
};

/** One rule maps each visible fixture target to one independently activatable marker. */
const RULES = [
  {
    selector: '.container-target',
    label: (element) => element.querySelector('strong')?.textContent?.trim() ?? null,
    scroll: { align: 'start', behavior: 'auto', enabled: true },
  },
];

/** Shared element-mode presentation and interaction options. */
const TRACKER_OPTIONS = {
  a11y: { label: 'External container targets' },
  clustering: { enabled: false },
  interaction: { drag: true },
  placement: 'right',
  track: { className: 'container-track' },
};

/**
 * Renders a framework-owned external element scroller.
 *
 * @param {(typeof CONTAINER_PROFILES)[keyof typeof CONTAINER_PROFILES]} profile Container profile.
 * @param {(element: Element | null) => void} scrollerRef Vue template-ref callback.
 * @returns {import('vue').VNode} External container fixture.
 */
function renderContainerFixture(profile, scrollerRef) {
  return h('section', { 'aria-labelledby': `${profile.id}-heading`, class: 'container-source' }, [
    h('h2', { id: `${profile.id}-heading` }, profile.label),
    h(
      'div',
      {
        class: 'container-scroller',
        id: profile.id,
        ref: scrollerRef,
        tabindex: 0,
        role: 'region',
        'aria-labelledby': `${profile.id}-heading`,
      },
      Array.from({ length: profile.targetCount }, (_, index) => {
        const targetNumber = index + 1;
        return h('article', { class: 'container-target', key: targetNumber }, [
          h('strong', `${profile.prefix} · Target ${String(targetNumber)}`),
          h('p', 'This block is queried and positioned relative to its external element scroller.'),
        ]);
      }),
    ),
  ]);
}

/**
 * Keeps shallow refs limited to actual HTMLElements.
 *
 * @param {import('vue').ShallowRef<HTMLElement | null>} target Destination ref.
 * @returns {(element: Element | null) => void} Vue template-ref callback.
 */
function createScrollerRef(target) {
  return (element) => {
    target.value = element instanceof HTMLElement ? element : null;
  };
}

/** Vue application that keeps the Tracker renderer stable while replacing its DOM-reference props. */
const App = defineComponent({
  name: 'VueContainerApp',
  setup() {
    /** Selects which committed DOM element both root props receive. */
    const activeId = ref('a');
    /** Holds the committed Container A element without deep proxying DOM state. */
    const containerA = shallowRef(null);
    /** Holds the committed Container B element without deep proxying DOM state. */
    const containerB = shallowRef(null);
    /** Resolves the real HTMLElement supplied to both Tracker root props. */
    const activeContainer = computed(() => (activeId.value === 'a' ? containerA.value : containerB.value));
    /** Supplies deterministic labels and counts to the teaching UI. */
    const activeProfile = computed(() => CONTAINER_PROFILES[activeId.value]);
    /** Stable template-ref callback that commits Container A's HTMLElement. */
    const registerContainerA = createScrollerRef(containerA);
    /** Stable template-ref callback that commits Container B's HTMLElement. */
    const registerContainerB = createScrollerRef(containerB);

    /**
     * Selects both runtime roots from the represented-container radio group.
     *
     * @param {Event} event Radio change event.
     */
    function selectContainer(event) {
      const input = event.currentTarget;
      if (input instanceof HTMLInputElement && (input.value === 'a' || input.value === 'b')) {
        activeId.value = input.value;
      }
    }

    return () =>
      h('div', [
        h('section', { 'aria-labelledby': 'represented-container-heading', class: 'container-controls' }, [
          h('fieldset', [
            h('legend', { id: 'represented-container-heading' }, 'Represented container'),
            ...Object.entries(CONTAINER_PROFILES).map(([id, profile]) =>
              h('label', { key: id }, [
                h('input', {
                  checked: activeId.value === id,
                  name: 'vue-container-source',
                  onChange: selectContainer,
                  type: 'radio',
                  value: id,
                }),
                profile.label,
              ]),
            ),
          ]),
        ]),
        h(
          'section',
          {
            'aria-labelledby': 'current-context-heading',
            class: 'container-context',
            'data-active-container': activeId.value,
            'data-framework': 'vue',
            id: 'container-context',
          },
          [
            h('h2', { id: 'current-context-heading' }, 'Current context'),
            h(
              'dl',
              [
                ['Framework Tracker component', 'same'],
                ['Renderer location', 'same'],
                [h('code', 'sourceRoot'), activeProfile.value.label],
                [h('code', 'scrollRoot'), activeProfile.value.label],
                ['Core scroll mode', 'element'],
              ].map(([term, value], index) => h('div', { key: index }, [h('dt', term), h('dd', value)])),
            ),
            h(
              'p',
              { id: 'container-status', role: 'status' },
              `Representing ${activeProfile.value.label}: ${String(activeProfile.value.targetCount)} sources and ${String(activeProfile.value.targetCount)} markers.`,
            ),
          ],
        ),
        h('div', { class: 'container-experiment' }, [
          h('section', { 'aria-labelledby': 'external-containers-heading', class: 'container-sources' }, [
            h('h2', { id: 'external-containers-heading' }, 'External containers'),
            h('div', { class: 'container-sources__grid' }, [
              renderContainerFixture(CONTAINER_PROFILES.a, registerContainerA),
              renderContainerFixture(CONTAINER_PROFILES.b, registerContainerB),
            ]),
          ]),
          h('section', { 'aria-labelledby': 'renderer-heading', class: 'container-renderer' }, [
            h('h2', { id: 'renderer-heading' }, 'Framework-owned Tracker view'),
            h('p', `Represents ${activeProfile.value.label}; remains here.`),
            h(
              'div',
              { class: 'container-tracker-view', 'data-render-owner': 'vue' },
              h(Tracker, {
                options: TRACKER_OPTIONS,
                rules: RULES,
                scrollRoot: activeContainer.value,
                sourceRoot: activeContainer.value,
              }),
            ),
          ]),
        ]),
        h('aside', { class: 'container-support-note' }, [
          h('h2', 'Supported element-scroll profile'),
          h('ul', [
            h('li', 'Block-like scroll container'),
            h('li', [h('code', 'overflow-y: auto')]),
            h('li', 'No scroll snap'),
            h('li', 'Ordinary physical-axis origin'),
          ]),
        ]),
      ]);
  },
});

/** DOM mount point owned by the Vue demo application. */
const mount = document.querySelector('#vue-app');
if (!(mount instanceof HTMLElement)) {
  throw new Error('Vue container root is missing.');
}
/** Vue application instance that preserves ownership of the Tracker subtree. */
const app = createApp(App);
app.mount(mount);

/** Releases the framework application when the page is discarded. */
function unmountApplication() {
  app.unmount();
}

window.addEventListener('pagehide', unmountApplication, { once: true });
