/**
 * ROK-2030 — `dedicatedGame: true` on the community-hubs seed: the tag's
 * fixture gets a game of its own, so no other spec's hubs share it. The
 * game-page Hubs card lists the viewer's hubs first and caps the rest
 * (`pickShownHubs`, web `game-hubs-shown.ts`), and every tagged crew holds
 * `community-member-1..4`, so on a shared game a member actor sees only
 * crews and never the tag's unjoined Solo hub. The game is created DISABLED
 * so `GET /games/configured` (every hub spec's game picker) never lists it —
 * the `demo-test-steam-app-stats-game.helpers.ts` precedent. INSERT runs
 * under `withGameNameLock` with the name-dedup guard (games INSERT rule).
 */
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { withGameNameLock } from '../igdb/games-name-lock.helpers';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { resolveSeedGame } from './demo-test-community-hubs.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The dedicated game's name and slug for `tag`. */
export function dedicatedGameIdentity(tag: string): {
  name: string;
  slug: string;
} {
  return { name: `Hub Smoke Game #${tag}`, slug: `hub-smoke-game-${tag}` };
}

/** Find-or-create `tag`'s disabled game (idempotent, pre-checked slug). */
export async function ensureDedicatedSeedGame(
  db: Db,
  tag: string,
): Promise<number> {
  const { name, slug } = dedicatedGameIdentity(tag);
  return withGameNameLock(db, name, async (tx) => {
    const found = await findGameByNormalizedName(tx, name);
    if (found) return found.id;
    const gm = schema.games;
    const [bySlug] = await tx
      .select({ id: gm.id })
      .from(gm)
      .where(eq(gm.slug, slug))
      .limit(1);
    if (bySlug) return bySlug.id;
    const [row] = await tx
      .insert(gm)
      .values({ name, slug, igdbId: null, enabled: false })
      .returning({ id: gm.id });
    if (!row)
      throw new Error(`hub seed: game insert for ${tag} returned no row`);
    return row.id;
  });
}

/** The game the seed runs on: the tag's own game, `gameId`, or the default. */
export async function seedGameFor(
  db: Db,
  input: {
    gameId?: number | undefined;
    tag?: string | undefined;
    dedicatedGame?: boolean | undefined;
  },
): Promise<number> {
  if (input.dedicatedGame !== true) return resolveSeedGame(db, input.gameId);
  if (input.tag === undefined || input.gameId !== undefined) {
    throw new BadRequestException('dedicatedGame needs a tag and no gameId');
  }
  return ensureDedicatedSeedGame(db, input.tag);
}
