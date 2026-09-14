import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tracker } from '@rightxt/tracker-react';
import '@rightxt/tracker-react/style.css';
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
 * @param {{ profile: (typeof CONTAINER_PROFILES)[keyof typeof CONTAINER_PROFILES], scrollerRef: (node: HTMLElement | null) => void }} props Fixture props.
 * @returns {import('react').ReactElement} External container fixture.
 */
function ContainerFixture({ profile, scrollerRef }) {
  return (
    <section className="container-source" aria-labelledby={`${profile.id}-heading`}>
      <h2 id={`${profile.id}-heading`}>{profile.label}</h2>
      <div
        id={profile.id}
        className="container-scroller"
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-labelledby={`${profile.id}-heading`}
      >
        {Array.from({ length: profile.targetCount }, (_, index) => {
          const targetNumber = index + 1;
          return (
            <article className="container-target" key={targetNumber}>
              <strong>
                {profile.prefix} · Target {targetNumber}
              </strong>
              <p>This block is queried and positioned relative to its external element scroller.</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Demonstrates element-mode root replacement without recreating the React Tracker component. */
function App() {
  /** Selects which committed DOM element both root props receive. */
  const [activeId, setActiveId] = useState('a');
  /** Holds the committed Container A element. */
  const [containerA, setContainerA] = useState(null);
  /** Holds the committed Container B element. */
  const [containerB, setContainerB] = useState(null);
  /** Resolves the immutable DOM value supplied to both Tracker root props. */
  const activeContainer = activeId === 'a' ? containerA : containerB;
  /** Supplies deterministic labels and counts to the teaching UI. */
  const activeProfile = CONTAINER_PROFILES[activeId];

  /**
   * Selects both runtime roots from the represented-container radio group.
   *
   * @param {import('react').ChangeEvent<HTMLInputElement>} event Radio change event.
   */
  function selectContainer(event) {
    setActiveId(event.currentTarget.value);
  }

  return (
    <>
      <section className="container-controls" aria-labelledby="represented-container-heading">
        <fieldset>
          <legend id="represented-container-heading">Represented container</legend>
          {Object.entries(CONTAINER_PROFILES).map(([id, profile]) => (
            <label key={id}>
              <input
                type="radio"
                name="react-container-source"
                value={id}
                checked={activeId === id}
                onChange={selectContainer}
              />
              {profile.label}
            </label>
          ))}
        </fieldset>
      </section>

      <section
        id="container-context"
        className="container-context"
        aria-labelledby="current-context-heading"
        data-active-container={activeId}
        data-framework="react"
      >
        <h2 id="current-context-heading">Current context</h2>
        <dl>
          <div>
            <dt>Framework Tracker component</dt>
            <dd>same</dd>
          </div>
          <div>
            <dt>Renderer location</dt>
            <dd>same</dd>
          </div>
          <div>
            <dt>
              <code>sourceRoot</code>
            </dt>
            <dd>{activeProfile.label}</dd>
          </div>
          <div>
            <dt>
              <code>scrollRoot</code>
            </dt>
            <dd>{activeProfile.label}</dd>
          </div>
          <div>
            <dt>Core scroll mode</dt>
            <dd>element</dd>
          </div>
        </dl>
        <p id="container-status" role="status">
          Representing {activeProfile.label}: {activeProfile.targetCount} sources and {activeProfile.targetCount}{' '}
          markers.
        </p>
      </section>

      <div className="container-experiment">
        <section className="container-sources" aria-labelledby="external-containers-heading">
          <h2 id="external-containers-heading">External containers</h2>
          <div className="container-sources__grid">
            <ContainerFixture profile={CONTAINER_PROFILES.a} scrollerRef={setContainerA} />
            <ContainerFixture profile={CONTAINER_PROFILES.b} scrollerRef={setContainerB} />
          </div>
        </section>

        <section className="container-renderer" aria-labelledby="renderer-heading">
          <h2 id="renderer-heading">Framework-owned Tracker view</h2>
          <p>Represents {activeProfile.label}; remains here.</p>
          <div className="container-tracker-view" data-render-owner="react">
            <Tracker
              options={TRACKER_OPTIONS}
              rules={RULES}
              sourceRoot={activeContainer}
              scrollRoot={activeContainer}
            />
          </div>
        </section>
      </div>

      <aside className="container-support-note">
        <h2>Supported element-scroll profile</h2>
        <ul>
          <li>Block-like scroll container</li>
          <li>
            <code>overflow-y: auto</code>
          </li>
          <li>No scroll snap</li>
          <li>Ordinary physical-axis origin</li>
        </ul>
      </aside>
    </>
  );
}

/** DOM mount point owned by the React demo application. */
const mount = document.querySelector('#react-app');
if (!(mount instanceof HTMLElement)) {
  throw new Error('React container root is missing.');
}
/** React root that preserves framework ownership of the demo subtree. */
const root = createRoot(mount);
root.render(<App />);

/** Releases the framework application when the page is discarded. */
function unmountApplication() {
  root.unmount();
}

window.addEventListener('pagehide', unmountApplication, { once: true });
