/**
 * ROK-2124: pure helpers for auto-linking a LedgerLink-bound WoW: Forever
 * character to its Battle.net Armory profile.
 *
 * A row is an "auto-link candidate" when it is a Forever character bound to
 * the addon (`addon_guid` set) that is NOT Armory-linked yet (`game_variant`
 * NULL), realmless with a ruleset + region, and not known to be below level
 * 10 (Blizzard 404s those). Candidates and the twice-daily bulk-sync rows
 * (`game_variant IS NOT NULL`) are disjoint by construction.
 */
import { NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';

/** Max due candidates one hourly job run attempts. */
export const AUTOLINK_CAP = 60;
/** Below this level Blizzard's realmless profile route 404s. */
export const AUTOLINK_MIN_LEVEL = 10;
/** Pause between two attempts inside one job run. */
export const AUTOLINK_SPACING_MS = 500;
/** First retry delay; doubles per failure. */
export const AUTOLINK_BASE_BACKOFF_MS = 60 * 60 * 1000;
/** Backoff ceiling — a hidden profile costs at most one call a day. */
export const AUTOLINK_MAX_BACKOFF_MS = 24 * AUTOLINK_BASE_BACKOFF_MS;

/** Why an attempt failed — stored in `last_error`. */
export type AutoLinkErrorKind =
  'not_found' | 'upstream' | 'external_id_conflict';

/** The `characters` columns candidacy depends on. */
export type AutoLinkCandidateRow = Pick<
  typeof schema.characters.$inferSelect,
  | 'gameId'
  | 'addonGuid'
  | 'gameVariant'
  | 'ruleset'
  | 'realm'
  | 'region'
  | 'level'
>;

/**
 * Backoff after `failures` consecutive failures: min(2^(f-1) h, 24 h).
 * A non-positive or non-finite count is treated as the first failure.
 */
export function backoffDelay(failures: number): number {
  const f = Number.isFinite(failures) ? Math.max(1, Math.floor(failures)) : 1;
  // Exponent clamped: 2^5 h already exceeds the 24 h ceiling.
  const doublings = Math.min(f, 6) - 1;
  return Math.min(
    AUTOLINK_BASE_BACKOFF_MS * 2 ** doublings,
    AUTOLINK_MAX_BACKOFF_MS,
  );
}

/** When the next attempt may run after `failures` failures. */
export function nextRetryAt(failures: number, now: Date): Date {
  return new Date(now.getTime() + backoffDelay(failures));
}

/**
 * Classify a thrown fetch error. Only a `NotFoundException` (the realmless
 * 404 — level < 10, never logged out, or hidden) is `not_found`; anything
 * else (502 from a 429/5xx, network, token) is `upstream`.
 */
export function classifyAutoLinkError(
  err: unknown,
): Exclude<AutoLinkErrorKind, 'external_id_conflict'> {
  return err instanceof NotFoundException ? 'not_found' : 'upstream';
}

/** An upstream failure ends the job run so a 429/5xx storm costs one call. */
export function stopsAutoLinkRun(kind: AutoLinkErrorKind): boolean {
  return kind === 'upstream';
}

/** In-memory twin of `autoLinkCandidateWhere` for a re-read row. */
export function isAutoLinkCandidate(
  row: AutoLinkCandidateRow,
  foreverGameId: number,
): boolean {
  return (
    row.gameId === foreverGameId &&
    row.addonGuid !== null &&
    row.gameVariant === null &&
    row.ruleset !== null &&
    row.realm === null &&
    row.region !== null &&
    (row.level === null || row.level >= AUTOLINK_MIN_LEVEL)
  );
}

/** SQL candidacy predicate over `characters` for the Forever game id. */
export function autoLinkCandidateWhere(foreverGameId: number): SQL {
  const c = schema.characters;
  const where = and(
    eq(c.gameId, foreverGameId),
    isNotNull(c.addonGuid),
    isNull(c.gameVariant),
    isNotNull(c.ruleset),
    isNull(c.realm),
    isNotNull(c.region),
    or(isNull(c.level), gte(c.level, AUTOLINK_MIN_LEVEL)),
  );
  return where ?? sql`false`;
}

/**
 * SQL "due" predicate for `characters LEFT JOIN wow_forever_armory_autolink`:
 * no state row yet (backfill / first attempt) or the backoff has elapsed.
 */
export function autoLinkDueWhere(now: Date): SQL {
  const s = schema.wowForeverArmoryAutolink;
  return or(isNull(s.characterId), lte(s.retryAt, now)) ?? sql`true`;
}

/** Job order: never-tried rows first, then by retry time, then oldest. */
export function autoLinkOrderBy(): [SQL, SQL] {
  return [
    sql`${schema.wowForeverArmoryAutolink.retryAt} asc nulls first`,
    asc(schema.characters.createdAt),
  ];
}
