import { getOwnerDocument } from './context.js';

/** Internal root purpose. */
type InternalDomRootKind = 'probe' | 'render';

/** Strongly enumerable registry state. */
type InternalDomRegistrationState = 'active' | 'quarantined';

/** Active or quarantined internal-root registration. */
interface InternalDomRegistration {
  /** Internal root purpose. */
  kind: InternalDomRootKind;
  /** Current strongly enumerable state. */
  state: InternalDomRegistrationState;
}

/** One scheduled retirement checkpoint with realm-matched cancellation. */
interface RetirementTimer {
  /** Cancels the checkpoint through the realm that scheduled it. */
  cancel: () => void;
}

/** Timer operations bound to one document realm. */
interface RetirementTimerOwner {
  /** Schedules a retirement release after the current task. */
  schedule: (callback: () => void) => RetirementTimer;
}

/** Registries keyed weakly by their owning document. */
const REGISTRIES = new WeakMap<Document, InternalDomRegistry>();

/**
 * Creates timer operations owned by the document's browsing context.
 *
 * @param document - Registry document.
 * @returns Realm-bound timer operations.
 */
function createRetirementTimerOwner(document: Document): RetirementTimerOwner {
  const view = document.defaultView;

  return {
    schedule(callback) {
      if (view !== null) {
        try {
          const timer = view.setTimeout(callback, 0);

          return {
            cancel() {
              try {
                view.clearTimeout(timer);
              } catch {
                // A discarded browsing context has already cancelled its tasks.
              }
            },
          };
        } catch {
          // Firefox retains defaultView after iframe removal but rejects new tasks.
        }
      }

      const timer = globalThis.setTimeout(callback, 0);

      return {
        cancel: () => globalThis.clearTimeout(timer),
      };
    },
  };
}

/**
 * Tracks internal DOM roots for one document without retaining released roots.
 *
 * Active and quarantined roots are enumerable query and mutation exclusions.
 * Disconnected retired roots are weak mutation-only records that expire after
 * one task checkpoint.
 */
class InternalDomRegistry {
  /** Document owning every accepted registration. */
  readonly #document: Document;

  /** Active and quarantined roots. */
  readonly #registrations = new Map<Node, InternalDomRegistration>();

  /** Disconnected roots retained for pending mutation delivery only. */
  readonly #retiredRoots = new WeakSet<Node>();

  /** Timer operations bound to the owning document realm. */
  readonly #retirementTimerOwner: RetirementTimerOwner;

  /** Scheduled retirement releases keyed weakly by root. */
  readonly #retirementTimers = new WeakMap<Node, RetirementTimer>();

  /**
   * @param document - Document owning this registry.
   */
  constructor(document: Document) {
    this.#document = document;
    this.#retirementTimerOwner = createRetirementTimerOwner(document);
  }

  /** Number of active and quarantined roots retained by the registry. */
  get activeCount(): number {
    this.#releaseDisconnectedQuarantine();

    return this.#registrations.size;
  }

  /**
   * Returns the current enumerable state for a root.
   *
   * @param root - Candidate internal root.
   * @returns Registration state or null.
   */
  getRegistrationState(root: Node): InternalDomRegistrationState | null {
    this.#releaseDisconnectedQuarantine();

    return this.#registrations.get(root)?.state ?? null;
  }

  /**
   * Registers a root before it is inserted or queried.
   *
   * @param root - Internal root.
   * @param kind - Internal root purpose.
   * @returns True when the root belongs to this registry document.
   */
  register(root: Node, kind: InternalDomRootKind): boolean {
    if (getOwnerDocument(root) !== this.#document) {
      return false;
    }

    this.#releaseDisconnectedQuarantine();
    this.#clearRetirement(root);

    if (this.#registrations.has(root)) {
      return false;
    }

    this.#registrations.set(root, { kind, state: 'active' });

    return true;
  }

  /**
   * Keeps a diagnosed connected cleanup failure isolated.
   *
   * @param root - Non-compliant internal root.
   * @param kind - Internal root purpose.
   * @returns True when the root belongs to this registry document.
   */
  quarantine(root: Node, kind: InternalDomRootKind = 'render'): boolean {
    if (getOwnerDocument(root) !== this.#document) {
      return false;
    }

    this.#clearRetirement(root);
    this.#registrations.set(root, { kind, state: 'quarantined' });

    return true;
  }

  /**
   * Retires a disconnected root through the pending mutation-delivery window.
   *
   * Connected roots are released immediately because retired state is only
   * meaningful for disconnected removal records.
   *
   * @param root - Previously active internal root.
   */
  retire(root: Node): void {
    this.#registrations.delete(root);
    this.#clearRetirement(root);

    if (root.isConnected) {
      return;
    }

    this.#retiredRoots.add(root);

    const timer = this.#retirementTimerOwner.schedule(() => {
      this.#retiredRoots.delete(root);
      this.#retirementTimers.delete(root);
    });

    this.#retirementTimers.set(root, timer);
  }

  /**
   * Fully releases a root to ordinary application semantics.
   *
   * @param root - Root to release.
   */
  release(root: Node): void {
    this.#registrations.delete(root);
    this.#clearRetirement(root);
  }

  /**
   * Checks whether a node is inside an active or quarantined internal root.
   *
   * @param node - Node to classify.
   * @returns True when queries and mutations must ignore the node.
   */
  isNodeExcluded(node: Node): boolean {
    this.#releaseDisconnectedQuarantine();

    if (getOwnerDocument(node) !== this.#document) {
      return false;
    }

    for (const root of this.#registrations.keys()) {
      if (node === root || root.contains(node)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks whether a node belongs to a finite retired subtree.
   *
   * @param node - Node to classify.
   * @returns True during the pending mutation-delivery window.
   */
  isNodeRetired(node: Node): boolean {
    let current: Node | null = node;

    while (current !== null) {
      if (this.#retiredRoots.has(current)) {
        return true;
      }

      current = current.parentNode;
    }

    return false;
  }

  /**
   * Checks whether one mutation record contains only internal DOM changes.
   *
   * @param mutation - Mutation record.
   * @returns True when the record must not invalidate source queries.
   */
  isMutationInternal(mutation: MutationRecord): boolean {
    if (this.isNodeExcluded(mutation.target) || this.isNodeRetired(mutation.target)) {
      return true;
    }

    if (mutation.type !== 'childList') {
      return false;
    }

    const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];

    return (
      changedNodes.length > 0 && changedNodes.every((node) => this.isNodeExcluded(node) || this.isNodeRetired(node))
    );
  }

  /**
   * Clears a finite retirement record and its checkpoint.
   *
   * @param root - Root whose retirement is cancelled.
   */
  #clearRetirement(root: Node): void {
    const timer = this.#retirementTimers.get(root);

    if (timer !== undefined) {
      timer.cancel();
      this.#retirementTimers.delete(root);
    }

    this.#retiredRoots.delete(root);
  }

  /** Lazily releases disconnected quarantine without background monitoring. */
  #releaseDisconnectedQuarantine(): void {
    this.#registrations.forEach((registration, root) => {
      if (registration.state === 'quarantined' && !root.isConnected) {
        this.retire(root);
      }
    });
  }
}

/**
 * Returns the registry for one document.
 *
 * @param document - Active document.
 * @returns Document-scoped registry.
 */
function getInternalDomRegistry(document: Document): InternalDomRegistry {
  const existingRegistry = REGISTRIES.get(document);

  if (existingRegistry !== undefined) {
    return existingRegistry;
  }

  const registry = new InternalDomRegistry(document);

  REGISTRIES.set(document, registry);

  return registry;
}

export { InternalDomRegistry, getInternalDomRegistry };
export type { InternalDomRegistration, InternalDomRegistrationState, InternalDomRootKind };
