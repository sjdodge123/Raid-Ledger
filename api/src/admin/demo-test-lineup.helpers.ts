/**
 * DEMO_MODE-only helpers for Community Lineup smoke-test fixtures (ROK-1081).
 *
 * Extracted from demo-test.service.ts to keep that file under the 300-line
 * limit. These helpers perform raw DB writes intentionally — they must not
 * pass through the normal LineupsService guards so tests can set up and
 * tear down lineups regardless of status-transition rules.
 */
import { sql, and, like } from 'drizzle-orm';
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
 * Archive `building`/`voting` lineups whose title starts with `titlePrefix`
 * (ROK-1147). Scoped per worker so sibling workers' lineups are untouched.
 *
 * The caller's prefix is escaped against LIKE wildcards (`%`, `_`, `\`)
 * before a trailing `%` is appended, so callers cannot inject patterns
 * that would match other workers' titles.
 *
 * Returns `archivedCount` for visibility/debugging.
 */
export async function resetLineupsForTest(
  db: Db,
  titlePrefix: string,
): Promise<{ archivedCount: number }> {
  const escapedPrefix = titlePrefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `${escapedPrefix}%`;
  const result = await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(
      and(
        sql`${schema.communityLineups.status} IN ('building', 'voting')`,
        like(schema.communityLineups.title, pattern),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  return { archivedCount: result.length };
}
