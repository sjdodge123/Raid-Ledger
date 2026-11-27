/**
 * ROK-2352 §3.3 — a hand's character must be of the game's variant. Forever is
 * decided by `gameVariant` OR a non-null `ruleset` (never the slug alone):
 * manual Forever characters carry `gameVariant: null` + a ruleset.
 */
import { wowCharacterFitsSlug } from './wow-lfg-character-variant';

const FOREVER = 'world-of-warcraft-forever';
const ERA = 'world-of-warcraft-classic';

describe('wowCharacterFitsSlug', () => {
  it('accepts a manual Forever character (ruleset, no gameVariant) on Forever', () => {
    expect(
      wowCharacterFitsSlug({ gameVariant: null, ruleset: 'normal' }, FOREVER),
    ).toBe(true);
  });

  it('accepts an imported Forever character (gameVariant, no ruleset) on Forever', () => {
    expect(
      wowCharacterFitsSlug(
        { gameVariant: 'wow_forever', ruleset: null },
        FOREVER,
      ),
    ).toBe(true);
  });

  it('accepts a bare row on the Forever game (game slug is the last word)', () => {
    expect(
      wowCharacterFitsSlug({ gameVariant: null, ruleset: null }, FOREVER),
    ).toBe(true);
  });

  it('rejects a character stamped with another variant on Forever', () => {
    expect(
      wowCharacterFitsSlug(
        { gameVariant: 'classic_era', ruleset: null },
        FOREVER,
      ),
    ).toBe(false);
  });

  it('rejects a Forever character (ruleset set) on a non-Forever WoW game', () => {
    expect(
      wowCharacterFitsSlug({ gameVariant: null, ruleset: 'hardcore' }, ERA),
    ).toBe(false);
  });

  it('accepts a plain Classic Era character on Classic Era', () => {
    expect(
      wowCharacterFitsSlug({ gameVariant: 'classic_era', ruleset: null }, ERA),
    ).toBe(true);
  });
});
