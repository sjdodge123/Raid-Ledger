/**
 * Retry helpers for smoke test runner.
 * Extracted to avoid importing the full runner in unit tests.
 */
import { SmokeAssertionError } from './assert.js';

/**
 * Returns true if the error is a retriable timeout (not an assertion failure).
 * SmokeAssertionError indicates a real test failure that should not be retried.
 */
export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err instanceof SmokeAssertionError) return false;
  return err.message.includes('timed out');
}
