/**
 * ROK-2209: the boss-loot expansion rule — the catalogue decides for its
 * variants, fails closed for an unknown instance, and leaves the other
 * variants' expansion sets untouched.
 */
import {
  lootExpansionsFor,
  lootFallbackExpansionFor,
} from './boss-loot-expansions';

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

describe('lootFallbackExpansionFor (ROK-2270)', () => {
  it('falls back to classic for a Forever read of a classic-edition dungeon (Wailing Caverns 240)', () => {
    expect(lootFallbackExpansionFor('wow_forever', 240)).toBe('classic');
  });

  it('falls back to classic for a classic-edition raid and a wing parent (Molten Core 741, SM 316)', () => {
    expect(lootFallbackExpansionFor('wow_forever', 741)).toBe('classic');
    expect(lootFallbackExpansionFor('wow_forever', 316)).toBe('classic');
  });

  it('never falls back for a Forever-new dungeon (Ruins of Lordaeron 90000002)', () => {
    expect(lootFallbackExpansionFor('wow_forever', 90_000_002)).toBeNull();
  });

  it('never falls back for an instance the catalogue does not know', () => {
    expect(lootFallbackExpansionFor('wow_forever', 999999)).toBeNull();
  });

  it('never falls back outside wow_forever', () => {
    expect(lootFallbackExpansionFor('classic_era', 240)).toBeNull();
    expect(lootFallbackExpansionFor('retail', 240)).toBeNull();
  });
});
