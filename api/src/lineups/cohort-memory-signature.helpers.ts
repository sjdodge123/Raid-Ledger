/**
 * Cohort signature helpers (ROK-1309).
 *
 * A cohort is the *engaged participant set* of a lineup —
 * `union(community_lineup_entries.nominated_by, community_lineup_votes.user_id)`
 * — NOT the invitee list and NOT the linked event's signup roster.
 *
 * The signature encoding is canonical and STRICT: it is the join key between
 * rows written live (here) and rows written by the S3 backfill migration in
 * SQL. See the header block on
 * `api/src/drizzle/schema/community-lineup-cohort-memory.ts` for the two
 * implementations side by side and the pinned parity vector. Changing either
 * side without the other silently orphans every existing row.
 *
 * Sibling style: `common-ground-query.helpers.ts`.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Exact-set lookup key for one cohort. */
export interface CohortSignature {
  /** Distinct engaged user ids, sorted numerically ascending. */
  participantIds: number[];
  /** sha256 hex of `participantIds.join(',')`. */
  participantHash: string;
  /** `participantIds.length`. Paired with the hash on the read path. */
  cohortSize: number;
}

/**
 * Hash an ALREADY-normalised id list (distinct, numerically ascending).
 * Prefer `buildCohortSignature`, which normalises first.
 */
export function hashParticipantIds(sortedIds: readonly number[]): string {
  return createHash('sha256').update(sortedIds.join(',')).digest('hex');
}

/**
 * Normalise an engaged-user-id list into a cohort signature.
 *
 * Returns `null` for the empty cohort — a lineup with zero nominators AND
 * zero voters has no signature, and its writers must skip entirely rather
 * than persist a hash of the empty string.
 */
export function buildCohortSignature(
  ids: readonly number[],
): CohortSignature | null {
  const participantIds = [...new Set(ids)].sort((a, b) => a - b);
  if (participantIds.length === 0) return null;
  return {
    participantIds,
    participantHash: hashParticipantIds(participantIds),
    cohortSize: participantIds.length,
  };
}

/**
 * Read the engaged participant set for one lineup.
 *
 * `UNION` (not `UNION ALL`) already dedupes across the two sources; the
 * TypeScript pass in `buildCohortSignature` is belt-and-braces so a future
 * caller feeding ids from elsewhere cannot skew `cohort_size`.
 */
export async function loadEngagedParticipantIds(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db.execute<{ user_id: number }>(sql`
    SELECT user_id
    FROM (
      SELECT nominated_by AS user_id
      FROM community_lineup_entries
      WHERE lineup_id = ${lineupId}
      UNION
      SELECT user_id
      FROM community_lineup_votes
      WHERE lineup_id = ${lineupId}
    ) engaged
    ORDER BY user_id
  `);
  return [...rows].map((row) => Number(row.user_id));
}

/** Convenience: read the engaged set and normalise it in one call. */
export async function loadCohortSignature(
  db: Db,
  lineupId: number,
): Promise<CohortSignature | null> {
  return buildCohortSignature(await loadEngagedParticipantIds(db, lineupId));
}
