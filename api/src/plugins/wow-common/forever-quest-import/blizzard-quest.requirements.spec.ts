/**
 * ROK-2143 L6 — `requirements` → prevQuestId / class / race restrictions.
 * Shapes are the key paths the 2026-11-09 live run (run 2) recorded:
 * `classes[]`, `races[]`, `faction { name, type }`, `quests { operator,
 * conditions }`, and `{}` for most quests. The live condition shape
 * (`target { id }`, quest 4132) is pinned in `blizzard-quest.prerequisites.spec.ts`.
 */
import {
  FACTION_RACES,
  parseQuestRequirements,
  requirementFields,
} from './blizzard-quest.requirements';

const key = (path: string) => ({ href: `https://us.api.blizzard.com/${path}` });

describe('parseQuestRequirements', () => {
  it('reads the faction from faction.type (run-2 shape)', () => {
    expect(
      parseQuestRequirements({ faction: { name: 'Horde', type: 'HORDE' } })
        .faction,
    ).toBe('HORDE');
    expect(
      parseQuestRequirements({ faction: { name: 'Alliance' } }).faction,
    ).toBe('ALLIANCE');
    expect(
      parseQuestRequirements({ faction: { type: 'NEUTRAL' } }).faction,
    ).toBeNull();
  });

  it('reads class and race names from references or strings', () => {
    const req = parseQuestRequirements({
      classes: [
        { key: key('data/wow/playable-class/9'), name: 'Warlock', id: 9 },
        'Warlock',
        { id: 4 },
      ],
      races: [{ name: { en_US: 'Night Elf' }, id: 4 }],
    });
    expect(req.classes).toEqual(['Warlock']);
    expect(req.races).toEqual(['Night Elf']);
  });

  it.each([
    ['bare ids', [303]],
    ['{ id } references', [{ key: key('data/wow/quest/303'), id: 303 }]],
    ['{ quest: { id } } wrappers', [{ quest: { id: 303, name: 'x' } }]],
    ['{ target: { id } } (live 4132 shape)', [{ target: { id: 303 } }]],
    ['a nested AND group', [{ operator: 'AND', conditions: [{ id: 303 }] }]],
  ])(
    'reads a prerequisite from quests.conditions as %s',
    (_label, conditions) => {
      const req = parseQuestRequirements({
        quests: { operator: { type: 'AND', name: 'All' }, conditions },
      });
      expect(req.prerequisiteIds).toEqual([303]);
    },
  );

  it('keeps document order and drops the quest itself', () => {
    const req = parseQuestRequirements(
      {
        quests: {
          operator: { id: 2, type: 'AND' },
          conditions: [{ id: 900 }, { id: 378 }, { id: 12 }],
        },
      },
      378,
    );
    expect(req.prerequisiteIds).toEqual([900, 12]);
    expect(req.prevQuestId).toBe(900);
  });

  it('names no prerequisite under an OR group (M4)', () => {
    const req = parseQuestRequirements({
      quests: { operator: { type: 'OR' }, conditions: [{ id: 900 }] },
    });
    expect(req.prerequisiteIds).toEqual([]);
    expect(req.prevQuestId).toBeNull();
  });

  it('parses {} / null / off-shape input as empty', () => {
    const empty = {
      prerequisiteIds: [],
      prevQuestId: null,
      faction: null,
      classes: [],
      races: [],
    };
    expect(parseQuestRequirements({})).toEqual(empty);
    expect(parseQuestRequirements(null)).toEqual(empty);
    expect(parseQuestRequirements('x')).toEqual(empty);
    expect(parseQuestRequirements({ classes: 'Mage', faction: [] })).toEqual(
      empty,
    );
  });
});

describe('requirementFields', () => {
  it('has no value (all null) for an empty requirements object', () => {
    expect(requirementFields({}, 378)).toEqual({
      prevQuestId: null,
      classRestriction: null,
      raceRestriction: null,
    });
  });

  it('turns a faction into the curated race list', () => {
    expect(
      requirementFields({ faction: { name: 'Alliance', type: 'ALLIANCE' } })
        .raceRestriction,
    ).toEqual(['Gnome', 'Night Elf', 'Dwarf', 'Human']);
    expect(FACTION_RACES.HORDE).toEqual(['Troll', 'Tauren', 'Undead', 'Orc']);
  });

  it('prefers explicit races over the faction, and takes the highest of equally direct prerequisites', () => {
    expect(
      requirementFields({
        races: [{ name: 'Tauren', id: 6 }],
        faction: { type: 'HORDE' },
        classes: [{ name: 'Druid', id: 11 }],
        quests: { conditions: [{ id: 40 }, { id: 50 }] },
      }),
    ).toEqual({
      prevQuestId: 50,
      classRestriction: ['Druid'],
      raceRestriction: ['Tauren'],
    });
  });
});
