/**
 * ROK-2038 drift guard — the BG3 plugin matches hubs by `games.slug`, and the
 * boot seed rewrites BG3's slug from `api/seeds/games-seed.json` on every
 * boot. If the seed's slug ever leaves `BG3_GAME_SLUGS`, every BG3 hub route
 * 404s on a real env while the integration specs (which insert their own row)
 * stay green. This reads the real seed file so that cannot happen silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BG3_GAME_SLUG,
  BG3_IGDB_ID,
  isBg3GameSlug,
} from '@raid-ledger/contract';

interface SeedGame {
  igdbId?: number;
  slug?: string;
}

function hasGames(v: unknown): v is { games: SeedGame[] } {
  return typeof v === 'object' && v !== null && 'games' in v && Array.isArray(v.games);
}

function seededBg3(): SeedGame[] {
  const file = join(__dirname, '../../../seeds/games-seed.json');
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!hasGames(raw)) throw new Error('games-seed.json has no games array');
  return raw.games.filter((g) => g.igdbId === BG3_IGDB_ID);
}

describe('ROK-2038 — BG3 slug vs the boot seed', () => {
  it('the seed carries exactly one BG3 row, and its slug is a BG3 slug', () => {
    const rows = seededBg3();
    expect(rows.map((g) => g.slug)).toHaveLength(1);
    expect(rows.map((g) => isBg3GameSlug(g.slug))).toEqual([true]);
  });

  it('the canonical BG3_GAME_SLUG is the seeded slug', () => {
    expect(seededBg3().map((g) => g.slug)).toEqual([BG3_GAME_SLUG]);
  });
});
