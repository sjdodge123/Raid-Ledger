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
 * Lineup phases that may be archived by the test-only reset helper. Mirrors
 * `community_lineups.status` enum (`api/src/drizzle/schema/community-lineups.ts`).
 */
export type ResetLineupPhase =
  | 'building'
  | 'voting'
  | 'decided'
  | 'archived';

const DEFAULT_RESET_PHASES: ResetLineupPhase[] = ['building', 'voting'];

/**
 * Archive lineups whose title starts with `titlePrefix` (ROK-1147). Scoped
 * per worker so sibling workers' lineups are untouched.
 *
 * The caller's prefix is escaped against LIKE wildcards (`%`, `_`, `\`)
 * before a trailing `%` is appended, so callers cannot inject patterns
 * that would match other workers' titles.
 *
 * `phases` defaults to `['building', 'voting']` for back-compat (ROK-1070).
 * Pass a broader array (e.g. `['building', 'voting', 'decided']`) when
 * fixtures depend on archiving lineups already past `voting` — for example
 * scheduling-poll fixtures attach to `decided` lineups.
 *
 * Returns `archivedCount` for visibility/debugging.
 */
export async function resetLineupsForTest(
  db: Db,
  titlePrefix: string,
  phases?: ResetLineupPhase[],
): Promise<{ archivedCount: number }> {
  const escapedPrefix = titlePrefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `${escapedPrefix}%`;
  const effectivePhases =
    phases && phases.length > 0 ? phases : DEFAULT_RESET_PHASES;
  // Phase values are constrained to the `ResetLineupPhase` union (validated
  // upstream by Zod). Building the IN-list via `sql.join` keeps the column
  // reference parameterised while inlining the safe enum literals.
  const phaseLiterals = effectivePhases.map((p) => sql`${p}`);
  const result = await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(
      and(
        sql`${schema.communityLineups.status} IN (${sql.join(phaseLiterals, sql`, `)})`,
        like(schema.communityLineups.title, pattern),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  return { archivedCount: result.length };
}
