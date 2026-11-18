/**
 * ROK-2259 — Discord reports every Classic-family client (WoW: Forever
 * included) as "World of Warcraft Classic", which the global mapping sends to
 * TBC Anniversary. Play time is re-attributed per player from their own
 * WoW characters.
 */
import {
  attributeClassicPlay,
  isForeverCharacter,
  type ClassicFamilyCharacter,
  type ClassicGameIds,
} from './classic-activity-attribution.helpers';

const IDS: ClassicGameIds = { foreverId: 10, anniversaryId: 20 };
const RETAIL_ID = 30;

function char(
  gameId: number,
  over: Partial<ClassicFamilyCharacter> = {},
): ClassicFamilyCharacter {
  return { gameId, gameVariant: null, ruleset: null, ...over };
}

describe('isForeverCharacter', () => {
  it('is true for a wow_forever variant', () => {
    expect(isForeverCharacter(char(20, { gameVariant: 'wow_forever' }))).toBe(
      true,
    );
  });

  it('is true for any character carrying a Forever ruleset', () => {
    expect(isForeverCharacter(char(99, { ruleset: 'pvp' }))).toBe(true);
  });

  it('is false for a plain Anniversary character', () => {
    expect(isForeverCharacter(char(20, { gameVariant: 'classic' }))).toBe(
      false,
    );
  });
});

describe('attributeClassicPlay', () => {
  it('credits Forever when the player has a Forever character', () => {
    const chars = [char(20), char(20, { gameVariant: 'wow_forever' })];
    expect(attributeClassicPlay(IDS.anniversaryId, chars, IDS)).toBe(
      IDS.foreverId,
    );
  });

  it('keeps Anniversary when the player has only Anniversary characters', () => {
    const chars = [char(20, { gameVariant: 'classic' }), char(RETAIL_ID)];
    expect(attributeClassicPlay(IDS.anniversaryId, chars, IDS)).toBe(
      IDS.anniversaryId,
    );
  });

  it('falls back to Forever when the player has no WoW characters', () => {
    expect(attributeClassicPlay(IDS.anniversaryId, [], IDS)).toBe(
      IDS.foreverId,
    );
  });

  it('falls back to Forever when the only characters are not Classic-family', () => {
    expect(attributeClassicPlay(IDS.anniversaryId, [char(RETAIL_ID)], IDS)).toBe(
      IDS.foreverId,
    );
  });

  it('never touches a game that is not the ambiguous Anniversary target', () => {
    const chars = [char(20, { gameVariant: 'wow_forever' })];
    expect(attributeClassicPlay(RETAIL_ID, chars, IDS)).toBe(RETAIL_ID);
    expect(attributeClassicPlay(IDS.foreverId, [], IDS)).toBe(IDS.foreverId);
  });
});
