/**
 * Constants for the LFG intents module (ROK-1451, extended by ROK-1479).
 *
 * The expiry horizon is a SINGLE global constant (AC13) — never inline
 * `14` anywhere, and never express it as a SQL default. `computeExpiresAt`
 * is the only place the arithmetic lives.
 */

import type { LfgNowTtl, LfgUrgency } from '@raid-ledger/contract';

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

/** Milliseconds in a minute. */
const MINUTE_MS = 60 * 1000;

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The only TTLs a `now` intent may hold (mirrors the DB CHECK constraint). */
export const LFG_NOW_TTL_MINUTES = [30, 60] as const;

/** Urgency classes an intent row can hold (mirrors the DB CHECK constraint). */
export const LFG_URGENCIES = ['week', 'now'] as const;

/** `{urgency:'now'}` with no `ttlMinutes` means the shorter of the two. */
export const LFG_DEFAULT_NOW_TTL_MINUTES: (typeof LFG_NOW_TTL_MINUTES)[number] = 30;

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

/** Scheduler-registry name for the expiry sweep. */
export const LFG_EXPIRY_JOB_NAME = 'LfgExpiryService_expireIntents';

/**
 * Every 5 minutes (ROK-1479 D6 / operator ruling A4).
 *
 * The sweep is the ONLY thing that tells Discord a group died of old age, so
 * its cadence bounds how long a dead group keeps advertising itself. Hourly
 * left a 30-minute group's forum post live for up to 59 minutes — twice the
 * group's own lifetime. 5 minutes caps that at a sixth of the shortest TTL and
 * costs one partial-index scan per run.
 */
export const LFG_EXPIRY_CRON_EXPRESSION = '0 */5 * * * *';

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
  /**
   * Urgency of the intent that COMPLETED the pair (ROK-1479 D7) — an additive
   * field on the existing payload, deliberately not a new event type, so the
   * affinity DM and the LFM embed can pick "now" copy without a second
   * subscription.
   */
  urgency: LfgUrgency;
  /**
   * TTL of that same row, in minutes — `null` on a `week` row, which has no
   * TTL at all (ROK-1479 D10). Required rather than optional so a consumer
   * quoting the horizon ("Playing in the next N minutes") cannot silently
   * fall back to a default the group never chose: an emitter that forgets it
   * fails to compile.
   */
  ttlMinutes: LfgNowTtl | null;
}

/** Why a group changed shape. Exactly one per emit. */
export type LfgGroupChangedReason =
  | 'joined'
  | 'withdrawn'
  | 'converted'
  | 'expired'
  /** A member flipped their own intent's urgency on a group already at LFM. */
  | 'bumped';

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

/**
 * Compute a `now` intent's expiry: `from` (default now) plus its own TTL.
 *
 * The counterpart to {@link computeExpiresAt} — the two are the ONLY places
 * either horizon's arithmetic lives.
 *
 * @param ttlMinutes - Minutes the intent lives for; one of
 *   {@link LFG_NOW_TTL_MINUTES}.
 * @param from - Instant to measure from. Defaults to the current time.
 * @returns The expiry instant.
 */
export function computeNowExpiresAt(
  ttlMinutes: number,
  from: Date = new Date(),
): Date {
  return new Date(from.getTime() + ttlMinutes * MINUTE_MS);
}
