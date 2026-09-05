/**
 * Constants for the LFG intents module (ROK-1451).
 *
 * The expiry horizon is a SINGLE global constant (AC13) — never inline
 * `14` anywhere, and never express it as a SQL default. `computeExpiresAt`
 * is the only place the arithmetic lives.
 */

/**
 * Hard cap on every LFG list read (M3).
 *
 * `GET /lfg`, `GET /lfg/hearted` and `GET /lfg/offers` are all unbounded by
 * construction — one row per game with a live intent, per manual heart, per
 * offer. None of them is paginated, so the cap is what stops a pathological
 * result set from becoming a slow query and an oversized response.
 */
export const LFG_LIST_LIMIT = 200;

/** Single global expiry horizon, in days. */
export const LFG_EXPIRY_DAYS = 14;

/**
 * Days of recurring game-time grid the overlap read projects forward from now
 * (ROK-1463 §A). Deliberately independent of {@link LFG_EXPIRY_DAYS} — they
 * happen to share a value today, but one is a lifecycle rule and the other a
 * search horizon.
 */
export const LFG_OVERLAP_HORIZON_DAYS = 14;

/** Hard cap on the overlap windows returned. */
export const LFG_OVERLAP_WINDOWS = 2;

/** Hard cap on history entries returned. */
export const LFG_HISTORY_LIMIT = 20;

/** Hard cap on suggested players returned. */
export const LFG_SUGGESTIONS_LIMIT = 12;

/** How far back a `played` reason counts for a suggestion, in days. */
export const LFG_SUGGESTIONS_PLAYED_DAYS = 90;

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
 * Advisory-lock key for one game's LFG group.
 *
 * `POST /lfg` inserts and then counts; without serialisation those are two
 * statements against a moving target, so concurrent first-posts could both
 * observe `activeCount === 2` (double `LFM_REACHED`) or skip 1 → 2 entirely.
 * Holding `pg_advisory_xact_lock` on this key for the whole insert-then-count
 * makes the post-insert count exact (M2 / Codex P2-b).
 *
 * Uses the ONE-argument `pg_advisory_xact_lock(bigint)` form, whose keyspace is
 * disjoint from the two-argument form `withGameNameLock` (ROK-1438) takes, so
 * the two lock families cannot collide.
 *
 * @param gameId - Game whose group is being written.
 * @returns The string hashed into the advisory-lock key.
 */
export function lfgGroupLockKey(gameId: number): string {
  return `lfg:${gameId}`;
}

/**
 * Application-level event names for the LFG lifecycle.
 * `LFM_REACHED` fires ONLY on the 1 → 2 transition, and only after the
 * insert+count transaction has COMMITTED, so a consumer can never see a group
 * that rolled back. The advisory lock in {@link lfgGroupLockKey} is what makes
 * "exactly once per transition" true rather than best-effort. Consumers
 * (ROK-1454's Discord post) subscribe; nothing in this story acts on it.
 */
export const LFG_EVENTS = {
  LFM_REACHED: 'lfg.lfm-reached',
  /** A Quick Play participant holds an active intent on the session's game. */
  QUICK_PLAY_MATCH: 'lfg.quick-play-match',
  /**
   * A group that has ALREADY reached LFM changed shape (ROK-1454 D1).
   * Deliberately generic — "something moved, re-read". `LFM_REACHED` still
   * owns the 1 -> 2 transition; the two never fire for the same change.
   */
  GROUP_CHANGED: 'lfg.group-changed',
} as const;

/** Payload emitted with {@link LFG_EVENTS.LFM_REACHED}. */
export interface LfgLfmReachedPayload {
  gameId: number;
  activeCount: number;
}

/** Why a group changed shape. Exactly one per emit. */
export type LfgGroupChangedReason =
  'joined' | 'withdrawn' | 'converted' | 'expired';

/**
 * Payload emitted with {@link LFG_EVENTS.GROUP_CHANGED}.
 *
 * Carries NO member count — the consumer re-reads. `pollId` / `eventId` are
 * set ONLY when `reason === 'converted'`, and are the provenance key the
 * converted-group read filters on (ROK-1454 D5), not decoration.
 */
export interface LfgGroupChangedPayload {
  gameId: number;
  reason: LfgGroupChangedReason;
  pollId?: number | null;
  eventId?: number | null;
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
