/**
 * ROK-2253: the embed-sync processor throws in two places ONLY so BullMQ's
 * `attempts: 3` + backoff re-runs the job — the bot is not connected, or a
 * transient embed edit failed (ROK-2227). Sentry's BullMQ integration would
 * capture that throw on every attempt, so on a NON-final attempt the error is
 * marked for `beforeSend` to drop (same pattern as ROK-2189's calendar sync).
 * The final attempt stays unmarked: exhausted retries still report.
 *
 * The mark lives on the error instance, so each throw site must hand in an
 * error created for this attempt — never a shared or cached one.
 */
import { markExpectedRetry } from '../../sentry/sentry-expected-retry.helpers';

/** The BullMQ job fields that decide whether a retry is still pending. */
export interface EmbedSyncAttemptInfo {
  attemptsMade?: number;
  opts?: { attempts?: number };
}

/**
 * True when this run is the job's last attempt (no retry follows a throw).
 * A job with no `attempts` configured has exactly one.
 *
 * @param job - The running BullMQ job.
 */
export function isFinalEmbedSyncAttempt(job: EmbedSyncAttemptInfo): boolean {
  return (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
}

/**
 * Mark a retry-only error as an expected retry unless this is the final
 * attempt; returns `err` unchanged so the caller can `throw` it.
 *
 * @param err - A fresh error for this attempt.
 * @param job - The running BullMQ job.
 */
export function markEmbedSyncRetry<T extends object>(
  err: T,
  job: EmbedSyncAttemptInfo,
): T {
  return isFinalEmbedSyncAttempt(job) ? err : markExpectedRetry(err);
}
