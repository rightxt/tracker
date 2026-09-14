import { getOwnerDocument } from '../dom/context.js';
import { isElement, isNode } from '../dom/element.js';
import { getInternalDomRegistry } from '../dom/internalDomRegistry.js';
import type { TrackerRuntimeContext } from '../tracker/mountContext.js';
import type {
  TrackerDiagnosticCode,
  TrackerObserverTarget,
  TrackerObserverTargetsContext,
  TrackerObserverTargetsReason,
  TrackerObserverTargetsResolver,
  TrackerObserverType,
} from '../types.js';
import { getErrorMessage } from '../utils/diagnostic.js';

/** Supported observer target resolver types. */
const OBSERVER_TYPES = Object.freeze({
  MUTATION: 'mutation',
  RESIZE: 'resize',
} as const);

interface ObserverTargetResolverDiagnostics {
  /** Warning reporter. */
  warn?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
}

interface ResolveObserverTargetsParams {
  /** Observer target resolver. */
  targets: TrackerObserverTargetsResolver | unknown;
  /** Lazily resolved default targets. */
  defaultTargets: TrackerObserverTarget[];
  /** Staged or committed runtime context. */
  runtimeContext: TrackerRuntimeContext;
  /** Resolution reason. */
  reason: TrackerObserverTargetsReason;
  /** Observer type. */
  observerType: TrackerObserverType;
  /** Diagnostics layer. */
  diagnostics?: ObserverTargetResolverDiagnostics | null;
}

/**
 * Checks whether an observer type is supported.
 *
 * @param observerType - Observer type candidate.
 * @returns True when observer type is supported.
 */
function isSupportedObserverType(observerType: unknown): observerType is TrackerObserverType {
  return observerType === OBSERVER_TYPES.MUTATION || observerType === OBSERVER_TYPES.RESIZE;
}

/**
 * Checks whether a target is valid for one observer type.
 *
 * @param target - Target candidate.
 * @param observerType - Observer type.
 * @returns True when the target has the required DOM type.
 */
function isValidObserverTarget(target: unknown, observerType: TrackerObserverType): boolean {
  return observerType === OBSERVER_TYPES.MUTATION ? isNode(target) : isElement(target);
}

/**
 * Describes a rejected observer target or option candidate for diagnostics.
 *
 * Raw DOM nodes and other external references are never embedded directly
 * into diagnostic `details`: nodes collapse to their `nodeType`/`nodeName`
 * plus whether they share the active realm document, and every other
 * candidate collapses to a small, always-serializable shape (`bigint`s stringify,
 * `symbol`s reduce to their description). This keeps `console.warn` output, the
 * public `warning` event payload, and retained diagnostics stats equally safe
 * to log, forward or serialize, regardless of what a caller-supplied `targets`
 * option or resolver actually returned. Reading a candidate's `constructor`
 * cannot throw and abort diagnostics: a hostile Proxy with a throwing
 * `constructor` getter still yields a description instead of a new exception.
 *
 * @param value - Rejected candidate value.
 * @param document - Realm document used to compare node ownership.
 * @returns Compact, serialization-safe candidate description.
 */
function describeObserverTargetCandidate(value: unknown, document: Document): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { candidateType: value === null ? 'null' : 'undefined' };
  }

  if (isNode(value)) {
    return {
      candidateType: 'node',
      nodeType: value.nodeType,
      nodeName: value.nodeName,
      ownerDocumentMatches: getOwnerDocument(value) === document,
    };
  }

  if (Array.isArray(value)) {
    return { candidateType: 'array', length: value.length };
  }

  if (typeof value === 'bigint') {
    return { candidateType: 'bigint', value: value.toString() };
  }

  if (typeof value === 'symbol') {
    return { candidateType: 'symbol', description: value.description ?? null };
  }

  if (typeof value === 'function') {
    return { candidateType: 'function' };
  }

  if (typeof value === 'object') {
    let constructorName = 'Object';

    try {
      constructorName = typeof value.constructor?.name === 'string' ? value.constructor.name : 'Object';
    } catch {
      constructorName = 'Unknown';
    }

    return { candidateType: 'object', constructorName };
  }

  return { candidateType: typeof value, value };
}

/**
 * Filters observer targets while preserving first-occurrence order.
 *
 * The runtime's own render root stays a valid resize target: box changes of
 * the actual renderer output are a normative default resize signal. Every
 * other internal-root node, including the render root as a mutation target,
 * remains excluded to prevent render feedback loops.
 *
 * @param targets - Copied target candidates.
 * @param runtimeContext - Active runtime identities.
 * @param observerType - Observer type.
 * @param diagnostics - Diagnostics layer.
 * @returns Valid same-realm non-internal targets.
 */
function filterObserverTargets(
  targets: unknown[],
  runtimeContext: TrackerRuntimeContext,
  observerType: TrackerObserverType,
  diagnostics: ObserverTargetResolverDiagnostics | null,
): TrackerObserverTarget[] {
  const seenTargets = new Set<unknown>();
  const registry = getInternalDomRegistry(runtimeContext.document);

  return targets.reduce<TrackerObserverTarget[]>((result, target) => {
    if (!isValidObserverTarget(target, observerType)) {
      diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_INVALID_TARGET',
        `Invalid ${observerType} observer target was ignored.`,
        {
          observerType,
          reason: 'wrong-target-type',
          target: describeObserverTargetCandidate(target, runtimeContext.document),
        },
      );

      return result;
    }

    if (getOwnerDocument(target) !== runtimeContext.document) {
      diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_FOREIGN_REALM_TARGET',
        `Resolved ${observerType} observer target belongs to another realm and was ignored.`,
        { observerType },
      );

      return result;
    }

    const isOwnRenderRootResizeTarget = observerType === OBSERVER_TYPES.RESIZE && target === runtimeContext.renderRoot;

    if (!isOwnRenderRootResizeTarget && registry.isNodeExcluded(target as Node)) {
      diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_INVALID_TARGET',
        'Internal Tracker DOM cannot be used as an observer target.',
        {
          observerType,
          reason: 'internal-root',
          target: describeObserverTargetCandidate(target, runtimeContext.document),
        },
      );

      return result;
    }

    if (!seenTargets.has(target)) {
      seenTargets.add(target);
      result.push(target as TrackerObserverTarget);
    }

    return result;
  }, []);
}

/**
 * Resolves, copies, validates, and deduplicates observer targets.
 *
 * Resolver failures and invalid collection results fall back to a fresh copy
 * of runtime defaults. An explicit empty array remains empty so the caller can
 * skip that observer type with its stable warning.
 *
 * @param params - Resolver inputs and active runtime context.
 * @param params.targets - Optional resolver candidate.
 * @param params.defaultTargets - Runtime-owned fallback targets.
 * @param params.runtimeContext - Staged or committed runtime identities.
 * @param params.reason - Resolution trigger.
 * @param params.observerType - Observer type being resolved.
 * @param params.diagnostics - Optional diagnostics sink.
 * @returns Final observer target list.
 */
function resolveObserverTargets({
  targets,
  defaultTargets,
  runtimeContext,
  reason,
  observerType,
  diagnostics = null,
}: ResolveObserverTargetsParams): TrackerObserverTarget[] {
  const normalizedObserverType = isSupportedObserverType(observerType) ? observerType : OBSERVER_TYPES.MUTATION;
  const fallbackTargets = Array.isArray(defaultTargets) ? [...defaultTargets] : [];
  let candidates: unknown[];

  if (targets === undefined) {
    candidates = [...fallbackTargets];
  } else if (typeof targets !== 'function') {
    diagnostics?.warn?.(
      'WARN_TRACKER_OBSERVER_INVALID_RESULT',
      `${normalizedObserverType} observer targets option must be a function. Default targets were used.`,
      {
        observerType: normalizedObserverType,
        reason: 'resolver-not-function',
        targets: describeObserverTargetCandidate(targets, runtimeContext.document),
      },
    );
    candidates = [...fallbackTargets];
  } else {
    const resolverContext: TrackerObserverTargetsContext = {
      observerType: normalizedObserverType,
      sourceRoot: runtimeContext.sourceRoot,
      scrollRoot: runtimeContext.scrollRoot,
      scrollMode: runtimeContext.scrollMode,
      renderRoot: runtimeContext.renderRoot,
      document: runtimeContext.document,
      window: runtimeContext.window,
      defaultTargets: [...fallbackTargets],
      reason,
    };

    try {
      const resolvedTargets = targets(resolverContext);

      if (!Array.isArray(resolvedTargets)) {
        diagnostics?.warn?.(
          'WARN_TRACKER_OBSERVER_INVALID_RESULT',
          `${normalizedObserverType} observer targets resolver must return an array. Default targets were used.`,
          {
            observerType: normalizedObserverType,
            reason: 'non-array-result',
            resolvedTargets: describeObserverTargetCandidate(resolvedTargets, runtimeContext.document),
          },
        );
        candidates = [...fallbackTargets];
      } else {
        candidates = [...resolvedTargets];
      }
    } catch (error) {
      diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_RESOLVER_FAILED',
        `${normalizedObserverType} observer targets resolver failed. Default targets were used.`,
        { observerType: normalizedObserverType, error: getErrorMessage(error) },
      );
      candidates = [...fallbackTargets];
    }
  }

  return filterObserverTargets(candidates, runtimeContext, normalizedObserverType, diagnostics);
}

export { describeObserverTargetCandidate, resolveObserverTargets };
