import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { loadInvitees } from '../lineups-eligibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Which audience shaped the voter set — reported back in the response DTO. */
export type VoterScopeStrategy = 'community' | 'partial' | 'small_group';

/** Resolved voter set + deterministic hash for cache keying. */
export interface ResolvedVoterScope {
  userIds: number[];
  hash: string;
  strategy: VoterScopeStrategy;
}

/** Subset of the lineup columns the voter-scope resolver needs. */
export interface VoterScopeLineup {
  id: number;
  visibility: 'public' | 'private';
}

/** Opts for `resolveVoterScope`. */
export interface VoterScopeOpts {
  /** When set, voter set is just this user (personalised view). */
  personalizeUserId?: number;
}

/**
 * Deterministic voter-set hash — SHA1 of the unique, sorted user ID list.
 * Same set of users always produces the same hash regardless of insertion
 * order or duplicates. Empty set produces a stable sentinel hash.
 */
export function computeVoterSetHash(userIds: readonly number[]): string {
  const unique = Array.from(new Set(userIds)).sort((a, b) => a - b);
  const payload = unique.join(',');
  return createHash('sha1').update(payload).digest('hex');
}

/**
 * Map voter count to the prompt-scaling strategy.
 *   2-3 → small_group (heavy personalisation)
 *   4-7 → partial (blend community + voter libraries)
 *   8+  → community (community-wide patterns)
 *   0-1 → small_group (treated as personalised — `personalize=me`, or a
 *         degenerate one-user group)
 */
export function classifyVoterScope(count: number): VoterScopeStrategy {
  if (count >= 8) return 'community';
  if (count >= 4) return 'partial';
  return 'small_group';
}

async function filterToUsersWithVector(
  db: Db,
  userIds: number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: schema.playerTasteVectors.userId })
    .from(schema.playerTasteVectors)
    .where(inArray(schema.playerTasteVectors.userId, userIds));
  return rows.map((r) => r.userId);
}

async function resolveNominators(db: Db, lineupId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: schema.communityLineupEntries.nominatedBy })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return rows.map((r) => r.userId);
}

/**
 * Fallback pool (architect Decision A, 2026-04-22): most-recently
 * active community users whose taste vector we know about. `users.lastSeenAt`
 * does not exist in the schema — `player_taste_vectors.computed_at` is the
 * freshest signal we have that a user is producing play data.
 */
async function resolveRecentActiveFallback(db: Db): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.playerTasteVectors.userId })
    .from(schema.playerTasteVectors)
    .where(
      and(
        isNotNull(schema.playerTasteVectors.vector),
        gt(
          schema.playerTasteVectors.computedAt,
          sql`now() - interval '30 days'`,
        ),
      ),
    )
    .orderBy(desc(schema.playerTasteVectors.computedAt))
    .limit(25);
  return rows.map((r) => r.userId);
}

async function resolveGroupUserIds(
  db: Db,
  lineup: VoterScopeLineup,
): Promise<number[]> {
  const source =
    lineup.visibility === 'private'
      ? await loadInvitees(db, lineup.id)
      : await resolveNominators(db, lineup.id);
  const withVector = await filterToUsersWithVector(db, source);
  if (withVector.length > 0) return withVector;
  return resolveRecentActiveFallback(db);
}

/**
 * Resolve the voter set + hash + strategy for an AI suggestions request.
 *
 *   `personalize=me` → single-user set (always `small_group` strategy).
 *   private lineup   → invitees filtered to users-with-vector, else fallback.
 *   public lineup    → nominators filtered to users-with-vector, else fallback.
 */
export async function resolveVoterScope(
  db: Db,
  lineup: VoterScopeLineup,
  opts: VoterScopeOpts = {},
): Promise<ResolvedVoterScope> {
  if (opts.personalizeUserId !== undefined) {
    const ids = await filterToUsersWithVector(db, [opts.personalizeUserId]);
    return {
      userIds: ids,
      hash: computeVoterSetHash(ids),
      strategy: 'small_group',
    };
  }
  const userIds = await resolveGroupUserIds(db, lineup);
  return {
    userIds,
    hash: computeVoterSetHash(userIds),
    strategy: classifyVoterScope(userIds.length),
  };
}
