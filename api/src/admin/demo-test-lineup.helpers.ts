/**
 * DEMO_MODE-only helpers for Community Lineup smoke-test fixtures (ROK-1081).
 *
 * Extracted from demo-test.service.ts to keep that file under the 300-line
 * limit. These helpers perform raw DB writes intentionally — they must not
 * pass through the normal LineupsService guards so tests can set up and
 * tear down lineups regardless of status-transition rules.
 */
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Create a new community lineup in `building` status. */
export async function createBuildingLineupForTest(
  db: Db,
  createdByUserId: number,
): Promise<{ lineupId: number }> {
  const [row] = await db
    .insert(schema.communityLineups)
    .values({
      title: 'Smoke Test Lineup',
      status: 'building',
      createdBy: createdByUserId,
    })
    .returning({ id: schema.communityLineups.id });
  return { lineupId: row.id };
}

/** Insert a lineup entry directly (bypasses service caps). Idempotent. */
export async function nominateGameForTest(
  db: Db,
  lineupId: number,
  gameId: number,
  userId: number,
): Promise<void> {
  await db
    .insert(schema.communityLineupEntries)
    .values({ lineupId, gameId, nominatedBy: userId })
    .onConflictDoNothing();
}

/** Archive a specific lineup. No-op when the lineup doesn't exist. */
export async function archiveLineupForTest(
  db: Db,
  lineupId: number,
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}

/** Archive any lineup currently in `building` or `voting` status. */
export async function archiveActiveLineupForTest(db: Db): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(sql`${schema.communityLineups.status} IN ('building', 'voting')`);
}

/**
 * Archive lineups that are blocking the singleton "active lineup" slot
 * (ROK-1147). Only `building` and `voting` lineups are archived — those
 * are the ones that prevent `POST /lineups` from succeeding due to the
 * one-active-lineup constraint.
 *
 * Crucially, lineups already in `decided` or `scheduling` status are
 * left alone: those belong to whichever sibling worker advanced them
 * past voting, and that worker's tests still need to navigate to them.
 * This is the difference that makes parallel-worker setup safe.
 *
 * Returns `archivedCount` for visibility/debugging.
 */
export async function resetLineupsForTest(
  db: Db,
): Promise<{ archivedCount: number }> {
  const result = await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(
      sql`${schema.communityLineups.status} IN ('building', 'voting')`,
    )
    .returning({ id: schema.communityLineups.id });
  return { archivedCount: result.length };
}
