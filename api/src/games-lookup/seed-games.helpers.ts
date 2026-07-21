import type { games } from '../drizzle/schema';

type GameInsert = typeof games.$inferInsert;
type GameSeedEntry = Partial<GameInsert> & Pick<GameInsert, 'slug' | 'name'>;

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
