/**
 * Browser-test entrypoint for the shared rethrowing Angular {@link ErrorHandler}
 * provider. The implementation lives with the Angular package test support so
 * package and browser Angular fixtures install the exact same handler.
 */
export { RETHROWING_TEST_ERROR_HANDLER_PROVIDER as RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from '../../../packages/angular/src/__tests__/testErrorHandler.ts';
