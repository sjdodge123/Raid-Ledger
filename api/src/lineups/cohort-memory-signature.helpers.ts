/**
 * Cohort signature helpers (ROK-1309, redefined by ROK-1538).
 *
 * A cohort is the *ROSTER* of a lineup —
 * `{community_lineups.created_by} ∪ community_lineup_invitees.user_id
 *  ∪ community_lineup_entries.nominated_by ∪ community_lineup_votes.user_id`
 * — i.e. everyone who is part of the group, not only those who have already
 * clicked something.
 *
 * ## Why the definition changed (operator ruling, 2026-09-13)
 *
 * ROK-1309 keyed cohorts on the *engaged* set (nominators ∪ voters). That
 * made the memory useless exactly when it is most useful: a freshly created
 * lineup has zero nominations and zero votes, so it had no signature at all
 * and could never match a prior cohort. Worse, the signature MUTATED as
 * people engaged — the same group of friends produced a different hash after
 * every nomination, so a lineup rarely matched its own past.
 *
 * The roster is stable from creation: the creator is always present, so a
 * brand-new lineup has a signature immediately. `0183_recompute_cohort_
 * memory_roster.sql` re-derives every pre-existing row under this definition
 * so live-written and historical rows keep agreeing.
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
  /** Distinct ROSTER user ids, sorted numerically ascending. */
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
 * Normalise a roster-user-id list into a cohort signature.
 *
 * Returns `null` for the empty cohort — which, under the ROK-1538 roster
 * definition, only happens for a lineup id that does not exist (every real
 * lineup has a NOT NULL `created_by`). Writers must skip entirely rather
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
 * Read the ENGAGED participant set for one lineup —
 * `union(entries.nominated_by, votes.user_id)`.
 *
 * No longer the cohort key (ROK-1538 promoted the roster); kept because the
 * engaged set is still a meaningful signal on its own and the ROK-1309 unit
 * spec pins its semantics.
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

/**
 * Read the ROSTER participant set for one lineup — the ROK-1538 cohort key.
 *
 * `{created_by} ∪ invitees ∪ nominators ∪ voters`. `UNION` (not `UNION ALL`)
 * dedupes across the four sources — a creator who is also rowed in
 * `community_lineup_invitees` (`addInvitees` does not exclude them) must not
 * skew `cohort_size`, which is exactly the bug ROK-1444 hit on the
 * participant count. The TypeScript pass in `buildCohortSignature` is
 * belt-and-braces on top.
 *
 * `nominated_by` is nullable, hence the explicit NOT NULL guard: a NULL id
 * would otherwise arrive as `Number(null) === 0` and forge a phantom member.
 *
 * `0183_recompute_cohort_memory_roster.sql` carries the IDENTICAL four-way
 * union. The two MUST change together or historical rows stop matching
 * live-written ones.
 */
export async function loadRosterParticipantIds(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db.execute<{ user_id: number }>(sql`
    SELECT user_id
    FROM (
      SELECT created_by AS user_id
      FROM community_lineups
      WHERE id = ${lineupId}
      UNION
      SELECT user_id
      FROM community_lineup_invitees
      WHERE lineup_id = ${lineupId}
      UNION
      SELECT nominated_by AS user_id
      FROM community_lineup_entries
      WHERE lineup_id = ${lineupId} AND nominated_by IS NOT NULL
      UNION
      SELECT user_id
      FROM community_lineup_votes
      WHERE lineup_id = ${lineupId}
    ) roster
    ORDER BY user_id
  `);
  return [...rows].map((row) => Number(row.user_id));
}

/**
 * Convenience: read the ROSTER set and normalise it in one call.
 *
 * The single loader BOTH the read path (`cohort-memory-query.helpers.ts`,
 * `common-ground-cohort.helpers.ts`) and the write path
 * (`cohort-memory-write.helpers.ts`) go through, so the two cannot disagree
 * about what a cohort is.
 */
export async function loadCohortSignature(
  db: Db,
  lineupId: number,
): Promise<CohortSignature | null> {
  return buildCohortSignature(await loadRosterParticipantIds(db, lineupId));
}
