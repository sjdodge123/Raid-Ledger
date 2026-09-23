/**
 * ROK-1643: the allowlist covers the seed's WoW variants.
 *
 * No test pins migration 0191 to the live seed list: 0191 is a one-off that
 * never re-runs, so tying it to GAMES_SEED would force edits to an applied
 * migration whenever the seed changes. The seed re-asserts its own names on
 * every boot (`upsertSeedGame`), so 0191 is not load-bearing for names.
 */
import { SEED_OWNED_GAME_SLUGS } from './seed-owned-games.helpers';

describe('seed-owned games (ROK-1643)', () => {
  it('locks every WoW variant slug the plugin keys on', () => {
    expect(SEED_OWNED_GAME_SLUGS).toEqual(
      expect.arrayContaining([
        'world-of-warcraft',
        'world-of-warcraft-classic',
        'world-of-warcraft-burning-crusade-classic-anniversary-edition',
        'world-of-warcraft-forever',
      ]),
    );
  });
});
