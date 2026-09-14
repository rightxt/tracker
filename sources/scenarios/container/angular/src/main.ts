import { Component, ElementRef, computed, signal, viewChild } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { TrackerComponent } from '@rightxt/tracker-angular';

/** Shared deterministic fixture profiles used by every framework variant. */
const CONTAINER_PROFILES = {
  a: { id: 'container-a', label: 'Container A', prefix: 'A', targetCount: 5 },
  b: { id: 'container-b', label: 'Container B', prefix: 'B', targetCount: 3 },
} as const;

/** Static target identifiers keep Angular template output deterministic. */
const TARGET_NUMBERS = {
  a: [1, 2, 3, 4, 5],
  b: [1, 2, 3],
} as const;

type ContainerId = keyof typeof CONTAINER_PROFILES;

/** Angular application that resolves signal queries into public Tracker root inputs. */
@Component({
  selector: 'angular-container-demo',
  imports: [TrackerComponent],
  template: `
    <section class="container-controls" aria-labelledby="represented-container-heading">
      <fieldset>
        <legend id="represented-container-heading">Represented container</legend>
        <label>
          <input
            type="radio"
            name="angular-container-source"
            [checked]="activeId() === 'a'"
            (change)="selectContainer('a')"
          />
          Container A
        </label>
        <label>
          <input
            type="radio"
            name="angular-container-source"
            [checked]="activeId() === 'b'"
            (change)="selectContainer('b')"
          />
          Container B
        </label>
      </fieldset>
    </section>

    <section
      id="container-context"
      class="container-context"
      aria-labelledby="current-context-heading"
      data-framework="angular"
      [attr.data-active-container]="activeId()"
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
          <dt><code>sourceRoot</code></dt>
          <dd>{{ activeProfile().label }}</dd>
        </div>
        <div>
          <dt><code>scrollRoot</code></dt>
          <dd>{{ activeProfile().label }}</dd>
        </div>
        <div>
          <dt>Core scroll mode</dt>
          <dd>element</dd>
        </div>
      </dl>
      <p id="container-status" role="status">
        Representing {{ activeProfile().label }}: {{ activeProfile().targetCount }} sources and
        {{ activeProfile().targetCount }} markers.
      </p>
    </section>

    <div class="container-experiment">
      <section class="container-sources" aria-labelledby="external-containers-heading">
        <h2 id="external-containers-heading">External containers</h2>
        <div class="container-sources__grid">
          <section class="container-source" aria-labelledby="container-a-heading">
            <h2 id="container-a-heading">Container A</h2>
            <div
              #containerA
              id="container-a"
              class="container-scroller"
              tabindex="0"
              role="region"
              aria-labelledby="container-a-heading"
            >
              @for (targetNumber of targetNumbers.a; track targetNumber) {
                <article class="container-target">
                  <strong>A · Target {{ targetNumber }}</strong>
                  <p>This block is queried and positioned relative to its external element scroller.</p>
                </article>
              }
            </div>
          </section>

          <section class="container-source" aria-labelledby="container-b-heading">
            <h2 id="container-b-heading">Container B</h2>
            <div
              #containerB
              id="container-b"
              class="container-scroller"
              tabindex="0"
              role="region"
              aria-labelledby="container-b-heading"
            >
              @for (targetNumber of targetNumbers.b; track targetNumber) {
                <article class="container-target">
                  <strong>B · Target {{ targetNumber }}</strong>
                  <p>This block is queried and positioned relative to its external element scroller.</p>
                </article>
              }
            </div>
          </section>
        </div>
      </section>

      <section class="container-renderer" aria-labelledby="renderer-heading">
        <h2 id="renderer-heading">Framework-owned Tracker view</h2>
        <p>Represents {{ activeProfile().label }}; remains here.</p>
        <div class="container-tracker-view" data-render-owner="angular">
          <rxt-tracker-angular
            [options]="options"
            [rules]="rules"
            [sourceRoot]="activeContainer()"
            [scrollRoot]="activeContainer()"
          />
        </div>
      </section>
    </div>

    <aside class="container-support-note">
      <h2>Supported element-scroll profile</h2>
      <ul>
        <li>Block-like scroll container</li>
        <li><code>overflow-y: auto</code></li>
        <li>No scroll snap</li>
        <li>Ordinary physical-axis origin</li>
      </ul>
    </aside>
  `,
})
class ContainerDemoComponent {
  /** Selects which queried HTMLElement both Tracker root inputs receive. */
  readonly activeId = signal<ContainerId>('a');
  /** Queries the committed Container A DOM element. */
  readonly containerA = viewChild<ElementRef<HTMLElement>>('containerA');
  /** Queries the committed Container B DOM element. */
  readonly containerB = viewChild<ElementRef<HTMLElement>>('containerB');
  /** Resolves the selected Angular query to its real DOM HTMLElement. */
  readonly activeContainer = computed(() =>
    this.activeId() === 'a' ? (this.containerA()?.nativeElement ?? null) : (this.containerB()?.nativeElement ?? null),
  );
  /** Provides the selected fixture metadata to teaching UI. */
  readonly activeProfile = computed(() => CONTAINER_PROFILES[this.activeId()]);
  /** Shared element-mode presentation and interaction options. */
  readonly options = {
    a11y: { label: 'External container targets' },
    clustering: { enabled: false },
    interaction: { drag: true },
    placement: 'right',
    track: { className: 'container-track' },
  } as const;
  /** Maps each visible fixture target to one independently activatable marker. */
  readonly rules = [
    {
      selector: '.container-target',
      label: (element: Element) => element.querySelector('strong')?.textContent?.trim() ?? null,
      scroll: { align: 'start', behavior: 'auto', enabled: true },
    },
  ] as const;
  /** Exposes stable target identifiers to the framework template. */
  readonly targetNumbers = TARGET_NUMBERS;

  /** Replaces both DOM-reference inputs without recreating the Tracker component. */
  selectContainer(containerId: ContainerId): void {
    this.activeId.set(containerId);
  }
}

await bootstrapApplication(ContainerDemoComponent);
