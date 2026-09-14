import { TrackerLifecycleError } from '../errors.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import type { TrackerDiagnosticCode } from '../types.js';

/** Maximum deferred operations drained before yielding back through an error. */
const MAX_DEFERRED_OPERATIONS_PER_DRAIN = 1000;

/** Stable and transitional internal lifecycle states. */
type TrackerLifecycleState = 'unmounted' | 'mounting' | 'mounted' | 'unmounting' | 'destroying' | 'destroyed';

/** Deferred state-changing operation. */
interface TrackerDeferredOperation {
  /** Whether this entry is a Projection adapter transaction boundary. */
  adapterTransaction?: boolean | undefined;
  /** Diagnostic operation name. */
  name: string;
  /** Deferred operation body. */
  run: () => unknown;
  /**
   * Cleanup invoked exactly once regardless of how the operation exits:
   * run synchronously, drained later, rejected before being queued (a
   * transition-in-progress throw), or dropped by the reentrancy-limit wipe.
   */
  cleanup?: (() => void) | undefined;
  /** Terminal lifecycle transition that must survive a queue-limit wipe. */
  terminal?: 'unmount' | 'destroy' | undefined;
}

/** Minimal per-instance enclosing-operation state. */
interface TrackerOperationCoordinator {
  /** Current Projection adapter transaction depth. */
  adapterTransactionDepth: number;
  /** Current nested core operation depth. */
  operationDepth: number;
  /** Current public event/snapshot subscriber dispatch depth. */
  publicDispatchDepth: number;
  /** FIFO deferred-operation queue. */
  deferredOperations: TrackerDeferredOperation[];
  /** Prevents recursive queue drains. */
  draining: boolean;
  /** Active ownership state after the ordinary drain budget is exhausted. */
  emergency: TrackerEmergencyState | null;
}

/** Monotonic terminal intent and bounded nonterminal cleanup owned by one emergency drain. */
interface TrackerEmergencyState {
  /** Operations whose bodies were dropped and whose cleanup is still owed. */
  cleanupQueue: TrackerDeferredOperation[];
  /** Whether one meaningful destroy transition has already been attempted. */
  destroyAttempted: boolean;
  /** Prevents rejected cleanup from creating unbounded direct cleanup recursion. */
  finalizingRejectedNonterminal: boolean;
  /** Number of newly generated nonterminal operations that may still be accepted for cleanup. */
  nonterminalAdmissionsRemaining: number;
  /** Strongest pending destroy operation, retained outside the ordinary FIFO. */
  pendingDestroy: TrackerDeferredOperation | undefined;
  /** Pending unmount operation, retained only while no destroy dominates it. */
  pendingUnmount: TrackerDeferredOperation | undefined;
  /** Whether one meaningful unmount transition has already been attempted. */
  unmountAttempted: boolean;
}

interface CoordinatedTrackerInstance {
  /** Current internal lifecycle state. */
  lifecycleState: TrackerLifecycleState;
  /** Per-instance coordinator. */
  operationCoordinator: TrackerOperationCoordinator;
  /** Diagnostics layer used for queued failures. */
  diagnostics: {
    error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  };
}

interface CoordinateTrackerOperationOptions<TResult> {
  /** Result returned immediately when the operation is queued. */
  deferredResult: TResult;
  /**
   * Cleanup invoked exactly once regardless of how the operation exits. See
   * {@link TrackerDeferredOperation.cleanup} for the guaranteed-once contract.
   */
  cleanup?: (() => void) | undefined;
  /** Marks a terminal lifecycle operation for queue-limit prioritization. */
  terminal?: 'unmount' | 'destroy' | undefined;
}

interface CoordinateTrackerAdapterTransactionOptions {
  /** Cleanup invoked exactly once after execution, rejection, or queue removal. */
  cleanup?: (() => void) | undefined;
}

/** Captured outcome of a callback that may throw any JavaScript value. */
type TrackerCallbackFailure = { readonly threw: false } | { readonly error: unknown; readonly threw: true };

/**
 * Creates empty per-instance enclosing-operation state.
 *
 * @returns Operation coordinator.
 */
function createTrackerOperationCoordinator(): TrackerOperationCoordinator {
  return {
    adapterTransactionDepth: 0,
    operationDepth: 0,
    publicDispatchDepth: 0,
    deferredOperations: [],
    draining: false,
    emergency: null,
  };
}

/**
 * Returns whether one lifecycle state is transitional and externally non-reentrant.
 *
 * @param state - Internal lifecycle state.
 * @returns True for acquisition or cleanup states.
 */
function isTrackerLifecycleTransition(state: TrackerLifecycleState): boolean {
  return state === 'mounting' || state === 'unmounting' || state === 'destroying';
}

/**
 * Creates the stable public transition-in-progress error.
 *
 * @param operationName - Reentrant operation name.
 * @returns Lifecycle error.
 */
function createTransitionInProgressError(operationName: string): TrackerLifecycleError {
  return new TrackerLifecycleError(`Tracker cannot run ${operationName} during a lifecycle transition.`, {
    code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS',
  });
}

/**
 * Creates an error for a non-terminating synchronous public feedback loop.
 *
 * @param scope - Reentrancy queue that exhausted its batch budget.
 * @returns Lifecycle error.
 */
function createReentrancyLimitError(scope: string): TrackerLifecycleError {
  return new TrackerLifecycleError(`Tracker stopped a non-terminating ${scope} feedback loop.`, {
    code: 'ERR_TRACKER_REENTRANCY_LIMIT',
  });
}

/**
 * Invokes one optional finalizer and retains its exact thrown value.
 *
 * @param callback - Finalizer to invoke, when present.
 * @returns Whether the callback threw and, if so, its exact thrown value.
 */
function captureTrackerCallbackFailure(callback: (() => void) | undefined): TrackerCallbackFailure {
  try {
    callback?.();
    return { threw: false };
  } catch (error) {
    return { error, threw: true };
  }
}

/**
 * Propagates captured failures without replacing a sole original value.
 *
 * @param failures - Failures in primary-to-secondary order.
 * @param aggregateMessage - Message used when several phases failed.
 */
function throwTrackerCallbackFailures(failures: readonly TrackerCallbackFailure[], aggregateMessage: string): void {
  const errors = failures.flatMap((failure) => (failure.threw ? [failure.error] : []));

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, aggregateMessage);
  }
}

/**
 * Releases one deferred operation without letting cleanup failure stop queue handling.
 *
 * @param instance - Coordinated Tracker instance.
 * @param operation - Deferred operation to release.
 */
function cleanupTrackerDeferredOperation(
  instance: CoordinatedTrackerInstance,
  operation: TrackerDeferredOperation,
): void {
  const cleanupFailure = captureTrackerCallbackFailure(operation.cleanup);

  if (cleanupFailure.threw) {
    instance.diagnostics.error?.('operation-cleanup-error', 'Tracker deferred operation cleanup failed.', {
      operationName: operation.name,
      error: getErrorMessage(cleanupFailure.error),
    });
  }
}

/** Maximum newly generated nonterminal cleanup entries owned by one emergency drain. */
const MAX_EMERGENCY_NONTERMINAL_ADMISSIONS = MAX_DEFERRED_OPERATIONS_PER_DRAIN * 2;

/**
 * Adds terminal work to the monotonic emergency lattice without using the live FIFO.
 *
 * Superseded or semantically satisfied operation objects move to the cleanup
 * queue so each accepted object retains its own exactly-once cleanup ownership.
 *
 * @param instance - Coordinated Tracker instance.
 * @param operation - Accepted terminal operation.
 */
function retainTrackerEmergencyTerminalOperation(
  instance: CoordinatedTrackerInstance,
  operation: TrackerDeferredOperation,
): void {
  const emergency = instance.operationCoordinator.emergency!;

  if (operation.terminal === 'destroy') {
    if (instance.lifecycleState === 'destroyed' || emergency.destroyAttempted) {
      emergency.cleanupQueue.push(operation);
      return;
    }

    if (emergency.pendingDestroy === undefined) {
      emergency.pendingDestroy = operation;

      if (emergency.pendingUnmount !== undefined) {
        emergency.cleanupQueue.push(emergency.pendingUnmount);
        emergency.pendingUnmount = undefined;
      }
    } else {
      emergency.cleanupQueue.push(operation);
    }

    return;
  }

  if (
    instance.lifecycleState !== 'mounted' ||
    emergency.unmountAttempted ||
    emergency.destroyAttempted ||
    emergency.pendingDestroy !== undefined
  ) {
    emergency.cleanupQueue.push(operation);
    return;
  }

  if (emergency.pendingUnmount === undefined) {
    emergency.pendingUnmount = operation;
  } else {
    emergency.cleanupQueue.push(operation);
  }
}

/**
 * Finalizes nonterminal work refused at the emergency admission boundary.
 *
 * One refused operation receives its ordinary operation-class cleanup. A
 * nonterminal operation synchronously created by that rejected finalizer is a
 * direct recursion attempt rather than deferred feedback and is stopped by the
 * stable limit error. Terminal requests remain admissible throughout.
 *
 * @param instance - Coordinated Tracker instance.
 * @param operation - Nonterminal operation refused before queue ownership.
 */
function finalizeRejectedTrackerEmergencyOperation(
  instance: CoordinatedTrackerInstance,
  operation: TrackerDeferredOperation,
): void {
  const emergency = instance.operationCoordinator.emergency!;

  if (emergency.finalizingRejectedNonterminal) {
    throw createReentrancyLimitError('emergency nonterminal finalization');
  }

  emergency.finalizingRejectedNonterminal = true;

  try {
    cleanupTrackerDeferredOperation(instance, operation);
  } finally {
    emergency.finalizingRejectedNonterminal = false;
  }
}

/**
 * Takes ownership of an operation created while emergency reconciliation is active.
 *
 * Terminal admission is unconditional and independent of the nonterminal
 * budget. Newly generated nonterminal work is cleanup-only and is refused
 * before entering any queue once its finite admission count is exhausted.
 *
 * @param instance - Coordinated Tracker instance.
 * @param operation - Newly generated operation.
 */
function admitTrackerEmergencyOperation(
  instance: CoordinatedTrackerInstance,
  operation: TrackerDeferredOperation,
): void {
  const emergency = instance.operationCoordinator.emergency!;

  if (operation.terminal !== undefined) {
    retainTrackerEmergencyTerminalOperation(instance, operation);
    return;
  }

  if (emergency.nonterminalAdmissionsRemaining === 0) {
    finalizeRejectedTrackerEmergencyOperation(instance, operation);
    return;
  }

  emergency.nonterminalAdmissionsRemaining -= 1;
  emergency.cleanupQueue.push(operation);
}

/**
 * Releases all currently owned cleanup-only work, including finite reentrant feedback.
 *
 * @param instance - Coordinated Tracker instance.
 */
function drainTrackerEmergencyCleanup(instance: CoordinatedTrackerInstance): void {
  const emergency = instance.operationCoordinator.emergency!;

  while (emergency.cleanupQueue.length > 0) {
    const batch = emergency.cleanupQueue.splice(0);

    batch.forEach((operation) => cleanupTrackerDeferredOperation(instance, operation));
  }
}

/**
 * Reconciles all accepted overflow work to a finite lifecycle fixed point.
 *
 * The live deferred FIFO is adopted once and remains empty during emergency
 * processing. Terminal intent lives in dedicated unmount/destroy slots, while
 * newly generated nonterminal work can only enter the bounded cleanup queue.
 *
 * @param instance - Coordinated Tracker instance.
 * @param overflowOperations - Accepted FIFO residue at the ordinary body limit.
 * @returns Strongest terminal kind observed for diagnostics.
 */
function reconcileTrackerEmergencyOperations(
  instance: CoordinatedTrackerInstance,
  overflowOperations: readonly TrackerDeferredOperation[],
): 'unmount' | 'destroy' | null {
  const coordinator = instance.operationCoordinator;
  const emergency: TrackerEmergencyState = {
    cleanupQueue: [],
    destroyAttempted: false,
    finalizingRejectedNonterminal: false,
    nonterminalAdmissionsRemaining: MAX_EMERGENCY_NONTERMINAL_ADMISSIONS,
    pendingDestroy: undefined,
    pendingUnmount: undefined,
    unmountAttempted: false,
  };
  let strongestTerminal: 'unmount' | 'destroy' | null = null;

  coordinator.emergency = emergency;

  try {
    overflowOperations.forEach((operation) => {
      if (operation.terminal === undefined) {
        emergency.cleanupQueue.push(operation);
      } else {
        strongestTerminal = operation.terminal === 'destroy' ? 'destroy' : (strongestTerminal ?? 'unmount');
        retainTrackerEmergencyTerminalOperation(instance, operation);
      }
    });

    while (true) {
      drainTrackerEmergencyCleanup(instance);

      if (emergency.pendingDestroy !== undefined) {
        const destroyOperation = emergency.pendingDestroy;

        emergency.pendingDestroy = undefined;
        emergency.destroyAttempted = true;
        strongestTerminal = 'destroy';
        runTrackerDeferredTerminalOperation(instance, destroyOperation);
        continue;
      }

      if (emergency.pendingUnmount !== undefined) {
        const unmountOperation = emergency.pendingUnmount;

        emergency.pendingUnmount = undefined;

        if (instance.lifecycleState === 'mounted' && !emergency.unmountAttempted) {
          emergency.unmountAttempted = true;
          strongestTerminal ??= 'unmount';
          runTrackerDeferredTerminalOperation(instance, unmountOperation);
        } else {
          emergency.cleanupQueue.push(unmountOperation);
        }

        continue;
      }

      if (emergency.cleanupQueue.length === 0) {
        break;
      }
    }

    return strongestTerminal;
  } finally {
    coordinator.emergency = null;
  }
}

/**
 * Attempts one terminal deferred operation and always releases its projection.
 *
 * Raises `operationDepth` around the direct call so a non-terminal mutation
 * triggered synchronously from within the terminal operation body (for example
 * from a custom renderer's `destroy()`/`unmount()` hook) is still subject to
 * the same transition-reentrancy guard as ordinary coordinated execution,
 * instead of running as an unguarded fresh top-level operation.
 *
 * @param instance - Coordinated Tracker instance.
 * @param operation - Terminal operation to attempt.
 */
function runTrackerDeferredTerminalOperation(
  instance: CoordinatedTrackerInstance,
  operation: TrackerDeferredOperation,
): void {
  const coordinator = instance.operationCoordinator;

  coordinator.operationDepth += 1;

  try {
    operation.run();
  } catch (error) {
    instance.diagnostics.error?.('deferred-operation-error', 'Deferred terminal Tracker operation failed.', {
      operation: operation.name,
      error: getErrorMessage(error),
    });
  } finally {
    coordinator.operationDepth -= 1;
    cleanupTrackerDeferredOperation(instance, operation);
  }
}

/**
 * Drains deferred operations in FIFO order and diagnoses their failures.
 *
 * @param instance - Coordinated Tracker instance.
 */
function drainTrackerDeferredOperations(instance: CoordinatedTrackerInstance): void {
  const coordinator = instance.operationCoordinator;

  if (coordinator.draining || coordinator.adapterTransactionDepth !== 0 || coordinator.operationDepth !== 0) {
    return;
  }

  coordinator.draining = true;
  let processedOperations = 0;

  try {
    while (coordinator.deferredOperations.length > 0) {
      if (processedOperations >= MAX_DEFERRED_OPERATIONS_PER_DRAIN) {
        const overflowOperations = coordinator.deferredOperations.splice(0);
        const overflowOperationCount = overflowOperations.length;
        const terminalOperation = reconcileTrackerEmergencyOperations(instance, overflowOperations);

        instance.diagnostics.error?.(
          'ERR_TRACKER_REENTRANCY_LIMIT',
          'Tracker stopped a non-terminating deferred-operation feedback loop.',
          {
            droppedOperations: overflowOperationCount - (terminalOperation !== null ? 1 : 0),
            processedOperations,
            terminalOperation,
          },
        );

        throw createReentrancyLimitError('deferred-operation');
      }

      const operation = coordinator.deferredOperations.shift()!;

      processedOperations += 1;

      try {
        if (operation.adapterTransaction === true) {
          coordinateTrackerAdapterTransaction(instance, operation.name, operation.run, {
            cleanup: operation.cleanup,
          });
        } else {
          coordinateTrackerOperation(instance, operation.name, operation.run, {
            deferredResult: undefined,
            cleanup: operation.cleanup,
            terminal: operation.terminal,
          });
        }
      } catch (error) {
        // Error normalization and diagnostics may invoke caller-owned code. Keep
        // this drain semantically busy so that reentrant work joins its live FIFO
        // behind every operation that was accepted earlier.
        coordinator.operationDepth += 1;

        try {
          instance.diagnostics.error?.('deferred-operation-error', 'Deferred Tracker operation failed.', {
            operation: operation.name,
            error: getErrorMessage(error),
          });
        } catch {
          // Deferred failure reporting is best-effort and cannot abort the FIFO.
        } finally {
          coordinator.operationDepth -= 1;
        }
      }
    }
  } finally {
    coordinator.draining = false;
  }
}

/**
 * Runs or defers one Projection adapter transaction in Core's FIFO.
 *
 * The transaction itself does not raise `operationDepth`. Its body may therefore
 * call the narrow Projection integration's ordinary Core operations and receive
 * their actual synchronous success or failure. `adapterTransactionDepth` still
 * prevents a nested queue drain, so no later operation can interleave between
 * those calls or an adapter-owned commit/rollback.
 *
 * @param instance - Coordinated Tracker instance.
 * @param operationName - Diagnostic transaction name.
 * @param transaction - Adapter transaction body.
 * @param options - Settlement cleanup.
 */
function coordinateTrackerAdapterTransaction(
  instance: CoordinatedTrackerInstance,
  operationName: string,
  transaction: () => void,
  options: CoordinateTrackerAdapterTransactionOptions = {},
): void {
  const coordinator = instance.operationCoordinator;

  if (coordinator.emergency !== null) {
    if (isTrackerLifecycleTransition(instance.lifecycleState) && coordinator.publicDispatchDepth === 0) {
      const transitionError = createTransitionInProgressError(operationName);
      const cleanupFailure = captureTrackerCallbackFailure(options.cleanup);

      throwTrackerCallbackFailures(
        [{ error: transitionError, threw: true }, cleanupFailure],
        'Tracker adapter transaction rejection and settlement both failed.',
      );
      return;
    }

    admitTrackerEmergencyOperation(instance, {
      adapterTransaction: true,
      name: operationName,
      run: transaction,
      cleanup: options.cleanup,
    });
    return;
  }

  if (
    coordinator.adapterTransactionDepth > 0 ||
    coordinator.operationDepth > 0 ||
    coordinator.publicDispatchDepth > 0
  ) {
    if (isTrackerLifecycleTransition(instance.lifecycleState) && coordinator.publicDispatchDepth === 0) {
      const transitionError = createTransitionInProgressError(operationName);
      const cleanupFailure = captureTrackerCallbackFailure(options.cleanup);

      throwTrackerCallbackFailures(
        [{ error: transitionError, threw: true }, cleanupFailure],
        'Tracker adapter transaction rejection and settlement both failed.',
      );
      return;
    }

    coordinator.deferredOperations.push({
      adapterTransaction: true,
      name: operationName,
      run: transaction,
      cleanup: options.cleanup,
    });
    return;
  }

  coordinator.adapterTransactionDepth += 1;
  const transactionFailure = captureTrackerCallbackFailure(transaction);

  coordinator.adapterTransactionDepth -= 1;

  const cleanupFailure = captureTrackerCallbackFailure(options.cleanup);
  const drainFailure = captureTrackerCallbackFailure(() => drainTrackerDeferredOperations(instance));

  throwTrackerCallbackFailures(
    [transactionFailure, cleanupFailure, drainFailure],
    'Tracker adapter transaction body, settlement, or deferred drain failed.',
  );
}

/**
 * Runs or defers one state-changing core operation.
 *
 * A call from a transitional custom callback fails immediately. A call made
 * while public subscribers are being dispatched is queued. Stable reentrancy
 * during another core operation is also queued until the outermost boundary.
 *
 * @param instance - Coordinated Tracker instance.
 * @param operationName - Diagnostic operation name.
 * @param operation - Operation body.
 * @param options - Deferred return value.
 * @returns Direct result or the configured deferred result.
 */
function coordinateTrackerOperation<TResult>(
  instance: CoordinatedTrackerInstance,
  operationName: string,
  operation: () => TResult,
  options: CoordinateTrackerOperationOptions<TResult>,
): TResult {
  const coordinator = instance.operationCoordinator;

  if (coordinator.emergency !== null) {
    if (
      isTrackerLifecycleTransition(instance.lifecycleState) &&
      coordinator.publicDispatchDepth === 0 &&
      options.terminal === undefined
    ) {
      options.cleanup?.();
      throw createTransitionInProgressError(operationName);
    }

    admitTrackerEmergencyOperation(instance, {
      name: operationName,
      run: operation,
      cleanup: options.cleanup,
      terminal: options.terminal,
    });
    return options.deferredResult;
  }

  if (coordinator.operationDepth > 0 || coordinator.publicDispatchDepth > 0) {
    if (
      isTrackerLifecycleTransition(instance.lifecycleState) &&
      coordinator.publicDispatchDepth === 0 &&
      options.terminal === undefined
    ) {
      options.cleanup?.();
      throw createTransitionInProgressError(operationName);
    }

    coordinator.deferredOperations.push({
      name: operationName,
      run: operation,
      cleanup: options.cleanup,
      terminal: options.terminal,
    });

    return options.deferredResult;
  }

  coordinator.operationDepth += 1;
  let directError: unknown;
  let directThrew = false;
  let drainError: unknown;
  let drainThrew = false;
  let result!: TResult;

  try {
    result = operation();
  } catch (error) {
    directThrew = true;
    directError = error;
  } finally {
    coordinator.operationDepth -= 1;
    options.cleanup?.();

    try {
      drainTrackerDeferredOperations(instance);
    } catch (error) {
      drainThrew = true;
      drainError = error;
    }
  }

  if (directThrew) {
    throw directError;
  }

  if (drainThrew) {
    throw drainError;
  }

  return result;
}

/**
 * Marks one captured event or snapshot subscriber invocation as public dispatch.
 *
 * @param instance - Coordinated Tracker instance.
 * @param dispatch - Subscriber invocation.
 * @returns Subscriber result.
 */
function runTrackerPublicDispatch<TResult>(instance: CoordinatedTrackerInstance, dispatch: () => TResult): TResult {
  const coordinator = instance.operationCoordinator;

  coordinator.publicDispatchDepth += 1;

  try {
    return dispatch();
  } finally {
    coordinator.publicDispatchDepth -= 1;

    if (coordinator.operationDepth === 0 && coordinator.publicDispatchDepth === 0) {
      drainTrackerDeferredOperations(instance);
    }
  }
}

export {
  MAX_DEFERRED_OPERATIONS_PER_DRAIN,
  MAX_EMERGENCY_NONTERMINAL_ADMISSIONS,
  coordinateTrackerAdapterTransaction,
  coordinateTrackerOperation,
  createTrackerOperationCoordinator,
  createTransitionInProgressError,
  isTrackerLifecycleTransition,
  runTrackerPublicDispatch,
};
export type { TrackerLifecycleState, TrackerOperationCoordinator };
