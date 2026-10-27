/**
 * ROK-1953 review R1 (MAJOR 2) — the Steam stats demo seed owns its game and
 * hub, so no other hub spec can pick them and the seed never mutates a shared
 * game row. The game is a dedicated row holding BG3's Steam app id, created
 * DISABLED so `GET /games/configured` (every hub spec's game picker) never
 * lists it; the hub is "Steam Stats Crew" on that game, which the
 * community-hubs seed reset (scoped to the game it seeds) never touches.
 * Runs inside the caller's `withGameNameLock` transaction (games INSERT rule).
 */
import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { hubNameKey } from '../guilds/community/community-proposals.queries';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import {
  ensureSeedUser,
  seedActiveHub,
} from './demo-test-community-hubs.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const BG3_APP_ID = 1086940;

/** The dedicated demo game (lock key = its name). */
export const STEAM_DEMO_GAME = {
  name: 'Steam Stats Demo (BG3)',
  slug: 'steam-stats-demo-bg3',
} as const;

export const STEAM_DEMO_HUB_NAME = 'Steam Stats Crew';

/** The id of the game row holding `appId` (unique when not null), or null. */
async function appIdHolder(tx: Db, appId: number): Promise<number | null> {
  const gm = schema.games;
  const [row] = await tx
    .select({ id: gm.id })
    .from(gm)
    .where(eq(gm.steamAppId, appId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Find-or-create the demo game with BG3's app id. 409 when another game
 * row already holds that id (`games.steam_app_id` is unique) — the seed
 * refuses rather than re-pointing a real game. Pre-checked, so no statement
 * can violate the unique key inside the transaction.
 */
export async function ensureDemoGame(tx: Db): Promise<number> {
  const found = await findGameByNormalizedName(tx, STEAM_DEMO_GAME.name);
  const holder = await appIdHolder(tx, BG3_APP_ID);
  if (holder !== null && holder !== found?.id) {
    throw new ConflictException(
      `Steam app ${BG3_APP_ID} already belongs to game ${holder}; the Steam stats demo seed needs it on its own game`,
    );
  }
  const app = { steamAppId: BG3_APP_ID, steamAppIdSource: 'manual' as const };
  if (found) {
    if (found.steamAppId !== BG3_APP_ID) {
      await tx
        .update(schema.games)
        .set({ ...app, enabled: false })
        .where(eq(schema.games.id, found.id));
    }
    return found.id;
  }
  const [row] = await tx
    .insert(schema.games)
    .values({ ...STEAM_DEMO_GAME, ...app, enabled: false })
    .returning({ id: schema.games.id });
  if (!row) throw new Error('steam seed: demo game insert returned no row');
  return row.id;
}

/** Find-or-create "Steam Stats Crew" on the demo game, led by `community-leader`. */
export async function ensureDemoHub(tx: Db, gameId: number): Promise<number> {
  const g = schema.guilds;
  const [hit] = await tx
    .select({ id: g.id })
    .from(g)
    .where(
      and(
        eq(g.kind, 'game_community'),
        eq(g.gameId, gameId),
        eq(g.nameKey, hubNameKey(STEAM_DEMO_HUB_NAME)),
      ),
    )
    .limit(1);
  if (hit) return hit.id;
  const leaderId = await ensureSeedUser(tx, 'community-leader');
  return seedActiveHub(tx, gameId, STEAM_DEMO_HUB_NAME, leaderId);
}
