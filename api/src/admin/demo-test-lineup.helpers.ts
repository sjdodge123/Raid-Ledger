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
 * Archive every lineup not already archived (ROK-1147).
 *
 * Smoke specs that share the singleton "active lineup" race when running
 * in parallel workers — one worker's `archiveActiveLineup` invalidates
 * another worker's just-created lineup mid-test. Each lineup-* spec calls
 * this once per worker in `beforeAll` so the worker starts from a known
 * empty state. Returns `archivedCount` for visibility/debugging.
 */
export async function resetLineupsForTest(
  db: Db,
): Promise<{ archivedCount: number }> {
  const result = await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(sql`${schema.communityLineups.status} <> 'archived'`)
    .returning({ id: schema.communityLineups.id });
  return { archivedCount: result.length };
}
