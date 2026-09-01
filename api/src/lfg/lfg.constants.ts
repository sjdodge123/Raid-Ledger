/**
 * Constants for the LFG intents module (ROK-1451).
 *
 * The expiry horizon is a SINGLE global constant (AC13) — never inline
 * `14` anywhere, and never express it as a SQL default. `computeExpiresAt`
 * is the only place the arithmetic lives.
 */

/** Single global expiry horizon, in days. */
export const LFG_EXPIRY_DAYS = 14;

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Lifecycle states an intent row can hold (mirrors the DB CHECK constraint). */
export const LFG_STATUSES = [
  'active',
  'cleared',
  'converted',
  'expired',
] as const;

/** Relay seam (ROK-274) — only `local` is implemented in v1. */
export const LFG_VISIBILITIES = ['local', 'cross-community'] as const;

/** Every intent this story writes ships as `local`. */
export const LFG_DEFAULT_VISIBILITY: (typeof LFG_VISIBILITIES)[number] =
  'local';

/** Scheduler-registry name for the hourly expiry sweep. */
export const LFG_EXPIRY_JOB_NAME = 'LfgExpiryService_expireIntents';

/** Hourly at :15 — a 14-day horizon swept daily would show dead rows for a day. */
export const LFG_EXPIRY_CRON_EXPRESSION = '0 15 * * * *';

/**
 * Application-level event names for the LFG lifecycle.
 * `LFM_REACHED` fires ONLY on the 1 → 2 transition, post-commit. Consumers
 * (ROK-1454's Discord post) subscribe; nothing in this story acts on it.
 */
export const LFG_EVENTS = {
  LFM_REACHED: 'lfg.lfm-reached',
  /** A Quick Play participant holds an active intent on the session's game. */
  QUICK_PLAY_MATCH: 'lfg.quick-play-match',
} as const;

/** Payload emitted with {@link LFG_EVENTS.LFM_REACHED}. */
export interface LfgLfmReachedPayload {
  gameId: number;
  activeCount: number;
}

/** Payload emitted with {@link LFG_EVENTS.QUICK_PLAY_MATCH}. */
export interface LfgQuickPlayMatchPayload {
  userId: number;
  gameId: number;
  eventId: number;
}

/**
 * Compute an intent's expiry: `from` (default now) plus {@link LFG_EXPIRY_DAYS}.
 *
 * @param from - Instant to measure from. Defaults to the current time.
 * @returns The expiry instant.
 */
export function computeExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + LFG_EXPIRY_DAYS * DAY_MS);
}
