/**
 * Process-wide ITAD request pacing + `Retry-After` parsing.
 *
 * Every ITAD call (price sync, early-access sync, IGDB enrichment, user-facing
 * search) shares this one pacer, so concurrent callers are spaced by
 * `ITAD_RATE_LIMIT_MS` instead of all reading the same "last call" timestamp
 * and firing together. A 429 pauses the whole queue, not just the caller that
 * received it — ITAD's limit is per API key, so every caller must back off.
 */
import { ITAD_RATE_LIMIT_MS, ITAD_RETRY_AFTER_MAX_MS } from './itad.constants';

/** Start time of the most recently granted slot. */
let lastStartAt = 0;
/** No slot is granted before this wall-clock time (set by a 429). */
let pausedUntil = 0;
/** Bumped on every pause so a waiter that is already sleeping re-checks. */
let pauseEpoch = 0;
/** Tail of the FIFO of callers waiting for a slot. */
let queue: Promise<void> = Promise.resolve();

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function nextAllowedAt(): number {
  return Math.max(lastStartAt + ITAD_RATE_LIMIT_MS, pausedUntil);
}

/**
 * Wait until this caller may start. Re-checks after each sleep only when a
 * pause was raised meanwhile, so a 429 that lands while a queued caller is
 * already sleeping still holds that caller.
 */
async function waitForTurn(): Promise<void> {
  let seenEpoch = -1;
  while (seenEpoch !== pauseEpoch) {
    seenEpoch = pauseEpoch;
    const waitMs = nextAllowedAt() - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  }
  lastStartAt = Date.now();
}

/**
 * Reserve the next request slot. Callers are served strictly in arrival order
 * and each start is at least `ITAD_RATE_LIMIT_MS` after the previous one.
 */
export function acquireItadSlot(): Promise<void> {
  const turn = queue.then(waitForTurn);
  queue = turn.catch(() => undefined);
  return turn;
}

/** Hold every ITAD caller for `ms` from now (never shortens a longer pause). */
export function pauseItadRequests(ms: number): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
  pauseEpoch++;
}

/**
 * Parse a `Retry-After` header into a wait in ms, capped at
 * `ITAD_RETRY_AFTER_MAX_MS`. Accepts delta-seconds (`"30"`) and an HTTP-date
 * (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Returns null when the header is
 * missing, unparseable, or yields no positive wait (e.g. a date already in the
 * past through clock skew) so the caller falls back to its own backoff.
 */
export function parseRetryAfterMs(
  header: string | null,
  now: number = Date.now(),
): number | null {
  const value = header?.trim();
  if (!value) return null;
  const ms = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, ITAD_RETRY_AFTER_MAX_MS);
}
