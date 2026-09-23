import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { games } from '../drizzle/schema';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { withGameNameLock } from '../igdb/games-name-lock.helpers';

type Db = PostgresJsDatabase<typeof schema>;

type GameInsert = typeof games.$inferInsert;
export type GameSeedEntry = Partial<GameInsert> &
  Pick<GameInsert, 'slug' | 'name'>;

export type SeedGameAction = 'created' | 'updated' | 'merged';

/**
 * Builds the ON-CONFLICT update set for a seed-games entry (the re-seed path
 * in api/scripts/seed-games.ts that runs on every boot).
 *
 * coverUrl is healed ONLY for the operator-owned `chao-chao` entry (ROK-1410):
 * its original seed pointed at a chaochaogame.com favicon blocked by the CSP
 * img-src allowlist, and existing prod rows can't be fixed by editing the seed
 * insert alone. The scope guard exists because the generic update path must
 * never clobber IGDB-enriched covers on other rows.
 */
export function buildSeedGameUpdateSet(
  game: GameSeedEntry,
): Partial<GameInsert> {
  return {
    ...(game.igdbId ? { igdbId: game.igdbId } : {}),
    shortName: game.shortName,
    colorHex: game.colorHex,
    hasRoles: game.hasRoles,
    hasSpecs: game.hasSpecs,
    maxCharactersPerUser: game.maxCharactersPerUser,
    ...('apiNamespacePrefix' in game
      ? { apiNamespacePrefix: game.apiNamespacePrefix }
      : {}),
    // ROK-1377: keep URL-only / free-to-play metadata current on re-seed.
    ...('websiteUrl' in game ? { websiteUrl: game.websiteUrl } : {}),
    ...('isFreeToPlay' in game ? { isFreeToPlay: game.isFreeToPlay } : {}),
    ...(game.slug === 'chao-chao' && 'coverUrl' in game
      ? { coverUrl: game.coverUrl }
      : {}),
  };
}

/**
 * Upsert one seed entry into `games` through the name-dedup guard (ROK-1563).
 *
 * The boot seed used to insert by slug with ON CONFLICT DO NOTHING, which the
 * "Games-table INSERT paths" rule forbids: a row the IGDB sync already created
 * under a different slug (NULL `igdb_id` on our side never trips the unique
 * constraint) became a name duplicate on the next boot. Order inside the lock:
 * slug hit → update config columns; normalized-name hit → merge into that row
 * and give it the canonical seed slug (the WoW plugin keys on it); otherwise
 * insert. `withGameNameLock` serialises concurrent inserts of the same title.
 * The merge happens once: it stamps the seed slug, so every later boot takes
 * the slug branch (today's behaviour) instead of re-matching by name.
 */
export async function upsertSeedGame(
  db: Db,
  game: GameSeedEntry,
): Promise<{ id: number; action: SeedGameAction }> {
  return withGameNameLock(db, game.name, async (tx) => {
    const [bySlug] = await tx
      .select({ id: games.id })
      .from(games)
      .where(eq(games.slug, game.slug))
      .limit(1);
    if (bySlug) {
      // ROK-1643: the seed owns this row's name — re-assert it every boot.
      await tx
        .update(games)
        .set({ ...buildSeedGameUpdateSet(game), name: game.name })
        .where(eq(games.id, bySlug.id));
      return { id: bySlug.id, action: 'updated' };
    }
    const byName = await findGameByNormalizedName(tx, game.name);
    if (byName) {
      await mergeSeedIntoRow(tx, game, byName.id);
      return { id: byName.id, action: 'merged' };
    }
    const [inserted] = await tx
      .insert(games)
      .values(game)
      .returning({ id: games.id });
    return { id: inserted.id, action: 'created' };
  });
}

/**
 * The one-time name-merge write. Never writes igdbId: the guard's candidate
 * select has no ORDER BY, so a NULL-igdb_id dupe can win over the canonical
 * row and a UNIQUE violation here would abort the whole boot seed (the
 * 2026-07-10 revert). Stamping the seed slug makes every later boot take the
 * slug branch instead.
 */
async function mergeSeedIntoRow(
  tx: Db,
  game: GameSeedEntry,
  id: number,
): Promise<void> {
  const safe = { ...buildSeedGameUpdateSet(game) };
  delete safe.igdbId;
  await tx
    .update(games)
    .set({ ...safe, slug: game.slug })
    .where(eq(games.id, id));
}
