/**
 * ROK-1643: the allowlist comes from the seed's own list, and the one-off
 * data migration restores exactly the names that list defines.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { GAMES_SEED } from './seed-games.data';
import { SEED_OWNED_GAME_SLUGS } from './seed-owned-games.helpers';

const MIGRATION = join(
  __dirname,
  '../drizzle/migrations/0191_restore_seed_owned_game_names.sql',
);

describe('seed-owned games (ROK-1643)', () => {
  it('locks every slug the seed defines, including the WoW variants', () => {
    expect([...SEED_OWNED_GAME_SLUGS].sort()).toEqual(
      GAMES_SEED.map((g) => g.slug).sort(),
    );
    expect(SEED_OWNED_GAME_SLUGS).toContain('world-of-warcraft-classic');
  });

  it('0191 restores each seed game to its curated name', () => {
    const sqlText = readFileSync(MIGRATION, 'utf8');
    for (const g of GAMES_SEED) {
      expect(sqlText).toContain(`('${g.slug}', '${g.name}')`);
    }
  });
});
