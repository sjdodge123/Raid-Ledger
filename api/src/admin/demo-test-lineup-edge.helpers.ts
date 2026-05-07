/**
 * DEMO_MODE-only helpers for the ROK-1069 lineup edge-case smoke fixtures.
 *
 * Sibling to demo-test-lineup.helpers.ts. Each helper performs a raw DB
 * write so the smoke tests can pin a lineup into a particular shape that
 * the normal LineupsService API would reject (e.g. forcing a building
 * lineup with zero nominations into voting).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Force a lineup into `voting` status with zero nominations. Used to
 * verify the empty-participation edge case (operators can still see the
 * page, advance/abort buttons render correctly, no vote rows exist).
 *
 * Bypasses LineupsService guards intentionally so the smoke setup does
 * not depend on the normal "must have ≥N nominations" rule.
 */
export async function advanceLineupToVotingForTest(
  db: Db,
  lineupId: number,
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({ status: 'voting', updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}

/**
 * Insert a single vote row for `userId` against `gameId` on the lineup.
 * Idempotent against the unique (lineupId, userId, gameId) constraint.
 */
export async function castVoteForTest(
  db: Db,
  lineupId: number,
  gameId: number,
  userId: number,
): Promise<void> {
  await db
    .insert(schema.communityLineupVotes)
    .values({ lineupId, gameId, userId })
    .onConflictDoNothing();
}

/** Set `visibility` on a lineup. */
export async function setLineupVisibilityForTest(
  db: Db,
  lineupId: number,
  visibility: 'public' | 'private',
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}

/**
 * Set `channelOverrideId` directly. Pass a known-bad snowflake (e.g.
 * `'999999999999999999'`) to simulate the bot losing post permissions
 * on the override channel — the resolver falls back to the bound
 * channel and warns once. Pass null to clear the override.
 */
export async function setLineupChannelOverrideForTest(
  db: Db,
  lineupId: number,
  channelOverrideId: string | null,
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({ channelOverrideId, updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}
