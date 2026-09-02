/**
 * DEMO_MODE-only helpers for Steam / game-interest smoke-test fixtures
 * (ROK-966/1054). Extracted from demo-test.service.ts (ROK-1072) to keep the
 * service a thin facade. Pure functions over a passed-in db handle.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { setAutoHeartSteamUrlsPref } from '../discord-bot/listeners/steam-link-interest.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Add a game interest for a user (idempotent, smoke tests). */
export async function addGameInterestForTest(
  db: Db,
  userId: number,
  gameId: number,
  source: string = 'manual',
): Promise<void> {
  await db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source })
    .onConflictDoNothing();
}

/** Clear game interests for a user/game (ROK-966 smoke test). */
export async function clearGameInterestForTest(
  db: Db,
  userId: number,
  gameId: number,
): Promise<void> {
  await db
    .delete(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.userId, userId),
        eq(schema.gameInterests.gameId, gameId),
      ),
    );
}

/** Set steamAppId on a game (ROK-966 smoke test). */
export async function setSteamAppIdForTest(
  db: Db,
  gameId: number,
  steamAppId: number,
): Promise<void> {
  await db
    .update(schema.games)
    .set({ steamAppId })
    .where(eq(schema.games.id, gameId));
}

/** Fetch a game by id for smoke-test fixture setup (ROK-1054). */
export async function getGameForTest(
  db: Db,
  id: number,
): Promise<{ id: number; name: string } | null> {
  const rows = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Set the autoHeartSteamUrls preference for a user (ROK-1054). */
export async function setAutoHeartPrefForTest(
  db: Db,
  userId: number,
  enabled: boolean,
): Promise<void> {
  await setAutoHeartSteamUrlsPref(db, userId, enabled);
}
