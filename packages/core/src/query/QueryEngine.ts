import { isInComposedSubtree } from '../dom/composedTree.js';
import { getOwnerDocument } from '../dom/context.js';
import { isElement } from '../dom/element.js';
import { isSourceRoot } from '../dom/environment.js';
import { getInternalDomRegistry } from '../dom/internalDomRegistry.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import type { TrackerDiagnosticCode, TrackerNormalizedRule, TrackerQueryMatch, TrackerSourceRoot } from '../types.js';

interface QueryEngineDiagnostics {
  /** Error reporter. */
  error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
}

interface QueryEngineContext {
  /** Static query root. */
  root?: TrackerSourceRoot | null;
  /** Dynamic query root provider. */
  getRoot?: (() => TrackerSourceRoot | null) | null | undefined;
  /** Diagnostics layer. */
  diagnostics?: QueryEngineDiagnostics | null;
}

/**
 * Normalizes a query result into an array of render-safe Elements.
 *
 * Beyond internal-DOM exclusion, results are re-filtered at render time so
 * dynamically reparented, disconnected, or outside-subtree elements cannot
 * become marker records.
 *
 * @param nodeList - Query result.
 * @param root - Active query root that scoped the selector search.
 * @returns Element list.
 */
function toQueryElements(nodeList: NodeListOf<Element> | ArrayLike<Element>, root: TrackerSourceRoot): Element[] {
  return Array.from(nodeList).filter((element) => {
    if (!isElement(element) || !element.isConnected || !isInComposedSubtree(element, root)) {
      return false;
    }

    const ownerDocument = getOwnerDocument(element);

    return ownerDocument === null || !getInternalDomRegistry(ownerDocument).isNodeExcluded(element);
  });
}

/**
 * Finds DOM elements by normalized Tracker rules.
 *
 * QueryEngine does not create markers, does not deduplicate elements across
 * rules and does not measure geometry.
 */
class QueryEngine {
  /** Whether the engine has permanently released its context. */
  #destroyed = false;

  /**
   * Query engine context.
   */
  #context: QueryEngineContext;

  /**
   * @param context - Static query root, dynamic root provider and diagnostics.
   * References are retained for the engine lifetime. getRoot() takes priority
   * over the static root; without an explicit root there is no ambient
   * document fallback and queries return no matches. The constructor performs
   * no DOM reads.
   */
  constructor(context: QueryEngineContext = {}) {
    this.#context = {
      root: context.root || null,
      getRoot: typeof context.getRoot === 'function' ? context.getRoot : null,
      diagnostics: context.diagnostics || null,
    };
  }

  /**
   * Executes selector search for every rule in priority order.
   *
   * @param rules - Normalized rules.
   * @returns Ordered matches.
   */
  query(rules: TrackerNormalizedRule[]): TrackerQueryMatch[] {
    const root = this.#resolveRoot();

    if (!root || !Array.isArray(rules) || rules.length === 0) {
      return [];
    }

    return rules.reduce<TrackerQueryMatch[]>((matches, rule, ruleIndex) => {
      if (!rule || typeof rule.selector !== 'string' || rule.selector === '') {
        return matches;
      }

      try {
        const elements = toQueryElements(root.querySelectorAll(rule.selector), root);

        elements.forEach((element) => {
          matches.push({
            element,
            rule,
            ruleIndex,
          });
        });
      } catch (error) {
        this.#context.diagnostics?.error?.(
          'query-selector-error',
          `Rule selector "${rule.selector}" failed during DOM query.`,
          {
            selector: rule.selector,
            error: getErrorMessage(error),
          },
        );
      }

      return matches;
    }, []);
  }

  /**
   * Resolves the active query root.
   *
   * @returns Query root or null.
   */
  #resolveRoot(): TrackerSourceRoot | null {
    if (this.#destroyed) {
      return null;
    }

    if (this.#context.getRoot) {
      const dynamicRoot = this.#context.getRoot();

      return isSourceRoot(dynamicRoot) ? dynamicRoot : null;
    }

    return isSourceRoot(this.#context.root) ? this.#context.root : null;
  }

  /**
   * Releases query root providers and diagnostics references.
   */
  destroy(): void {
    this.#destroyed = true;
    this.#context = {
      root: null,
      getRoot: null,
      diagnostics: null,
    };
  }

  /**
   * Updates query context.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<QueryEngineContext> = {}): void {
    if (this.#destroyed) {
      return;
    }

    this.#context = {
      ...this.#context,
      ...context,
      getRoot:
        'getRoot' in context ? (typeof context.getRoot === 'function' ? context.getRoot : null) : this.#context.getRoot,
    };
  }
}

export { QueryEngine, toQueryElements };
export type { QueryEngineContext, QueryEngineDiagnostics };
