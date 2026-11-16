/**
 * ROK-2209: the boss-loot expansion rule — the catalogue decides for its
 * variants, fails closed for an unknown instance, and leaves the other
 * variants' expansion sets untouched.
 */
import { lootExpansionsFor } from './boss-loot-expansions';

const RETAIL_SET = ['classic', 'tbc', 'wotlk', 'cata'];

function fallback(variant: string): string[] {
  return variant === 'retail' ? RETAIL_SET : ['fallback-used'];
}

describe('lootExpansionsFor (ROK-2209)', () => {
  it('reads forever loot only for a catalogued Forever dungeon (Deadmines 63)', () => {
    expect(lootExpansionsFor('wow_forever', 63, fallback)).toEqual(['forever']);
  });

  it('reads forever loot only for an uncaptured Forever dungeon (Wailing Caverns 240)', () => {
    expect(lootExpansionsFor('wow_forever', 240, fallback)).toEqual([
      'forever',
    ]);
  });

  it('fails closed to forever for an instance the catalogue does not know', () => {
    expect(lootExpansionsFor('wow_forever', 999999, fallback)).toEqual([
      'forever',
    ]);
  });

  it('reads forever loot for a wing parent id (Scarlet Monastery 316)', () => {
    expect(lootExpansionsFor('wow_forever', 316, fallback)).toEqual([
      'forever',
    ]);
  });

  it('reads classic loot only under classic_era', () => {
    expect(lootExpansionsFor('classic_era', 63, fallback)).toEqual(['classic']);
    expect(lootExpansionsFor('classic_era', 999999, fallback)).toEqual([
      'classic',
    ]);
  });

  it('returns the fallback set untouched for a non-catalogue variant', () => {
    expect(lootExpansionsFor('retail', 63, fallback)).toBe(RETAIL_SET);
  });

  it('does not treat an Object prototype key as a catalogue variant', () => {
    expect(lootExpansionsFor('toString', 63, fallback)).toEqual([
      'fallback-used',
    ]);
  });
});
