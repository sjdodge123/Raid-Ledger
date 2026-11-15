import {
  characterSide,
  isQuestUsableBySide,
  sharedSide,
} from './quest-faction.helpers';

const ALLIANCE = ['Human', 'Dwarf', 'Night Elf', 'Gnome'];
const HORDE = ['Orc', 'Undead', 'Tauren', 'Troll'];
const quest = (raceRestriction: string[] | null) => ({ raceRestriction });

describe('characterSide (ROK-2211)', () => {
  it('reads the race first, then the stored faction column', () => {
    expect(characterSide('Night Elf', null)).toBe('alliance');
    expect(characterSide('Orc', 'Alliance')).toBe('horde');
    expect(characterSide(null, ' Horde ')).toBe('horde');
    expect(characterSide('Pandaren', 'alliance')).toBe('alliance');
  });

  it('is null when neither names a side', () => {
    expect(characterSide(null, null)).toBeNull();
    expect(characterSide(undefined, 'Neutral')).toBeNull();
  });
});

describe('isQuestUsableBySide (ROK-2211)', () => {
  it('keeps a quest whose races intersect the side, drops the other side', () => {
    expect(isQuestUsableBySide(quest(HORDE), 'horde')).toBe(true);
    expect(isQuestUsableBySide(quest(ALLIANCE), 'horde')).toBe(false);
    expect(isQuestUsableBySide(quest(['Undead']), 'alliance')).toBe(false);
  });

  it('always keeps neutral quests (null or empty raceRestriction)', () => {
    expect(isQuestUsableBySide(quest(null), 'alliance')).toBe(true);
    expect(isQuestUsableBySide(quest([]), 'horde')).toBe(true);
  });

  it('an unknown side keeps every quest (no filter)', () => {
    expect(isQuestUsableBySide(quest(ALLIANCE), null)).toBe(true);
    expect(isQuestUsableBySide(quest(HORDE), null)).toBe(true);
  });
});

describe('sharedSide (ROK-2211)', () => {
  it('is the side every known entry agrees on, ignoring unknowns', () => {
    expect(sharedSide(['horde', null, 'horde'])).toBe('horde');
  });

  it('is null when known sides disagree or none is known', () => {
    expect(sharedSide(['horde', 'alliance'])).toBeNull();
    expect(sharedSide([null, null])).toBeNull();
    expect(sharedSide([])).toBeNull();
  });
});
