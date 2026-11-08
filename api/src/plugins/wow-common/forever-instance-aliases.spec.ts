import { FOREVER_SEED_ID_BASE, isForeverSeedId } from './forever-instance-data';
import bossData from './data/boss-encounter-data.json';
import questData from './data/dungeon-quest-data.json';
import {
  CLASSIC_WING_PARENT_IDS,
  FOREVER_JOURNAL_ALIASES,
  resolveQuestInstanceIds,
} from './forever-instance-aliases';
import { INSTANCE_SHORT_NAMES } from './blizzard-instance-data';

const SEED_1 = FOREVER_SEED_ID_BASE + 1;

describe('FOREVER_JOURNAL_ALIASES (ROK-1748 D3/D4)', () => {
  it('maps non-seed journal ids to seed ids only', () => {
    for (const [key, value] of Object.entries(FOREVER_JOURNAL_ALIASES)) {
      expect(isForeverSeedId(Number(key))).toBe(false);
      expect(isForeverSeedId(value)).toBe(true);
    }
  });
});

describe('resolveQuestInstanceIds', () => {
  it('returns a seed id alone (no /100 parent rule)', () => {
    expect(resolveQuestInstanceIds(SEED_1)).toEqual([SEED_1]);
  });

  it('returns an aliased journal id plus its seed id', () => {
    expect(resolveQuestInstanceIds(1301, { 1301: SEED_1 })).toEqual([
      1301,
      SEED_1,
    ]);
  });

  it('keeps the Classic /100 parent rule for synthetic wing ids', () => {
    expect(resolveQuestInstanceIds(31601)).toEqual([31601, 316]);
  });

  it('returns a plain Classic id alone', () => {
    expect(resolveQuestInstanceIds(228)).toEqual([228]);
  });

  it('resolves a Dire Maul — Warpwood Quarter event (1276) to Dire Maul (230)', () => {
    expect(resolveQuestInstanceIds(1276)).toEqual([1276, 230]);
  });

  it('resolves Dire Maul — Gordok Commons (1277) to Dire Maul (230)', () => {
    expect(resolveQuestInstanceIds(1277)).toEqual([1277, 230]);
  });

  it('resolves Stratholme — Service Entrance (1292) to Stratholme (236)', () => {
    expect(resolveQuestInstanceIds(1292)).toEqual([1292, 236]);
  });

  it('leaves an unmapped instance id unchanged', () => {
    expect(resolveQuestInstanceIds(241)).toEqual([241]);
  });
});

describe('CLASSIC_WING_PARENT_IDS (ROK-2142)', () => {
  const questIds = new Set(questData.map((q) => q.dungeonInstanceId));
  const classicBossIds = new Set(
    bossData.filter((b) => b.expansion === 'classic').map((b) => b.instanceId),
  );

  it('maps only wing ids the classic boss data offers', () => {
    for (const wing of Object.keys(CLASSIC_WING_PARENT_IDS).map(Number)) {
      expect({ wing, offered: classicBossIds.has(wing) }).toEqual({
        wing,
        offered: true,
      });
    }
  });

  it('maps every wing to a parent that has classic quest rows', () => {
    for (const [wing, parent] of Object.entries(CLASSIC_WING_PARENT_IDS)) {
      expect({ wing, parent, hasQuests: questIds.has(parent) }).toEqual({
        wing,
        parent,
        hasQuests: true,
      });
    }
  });
});

describe('classic dungeon data integrity (ROK-2142)', () => {
  const instanceOf = (questId: number): number | null | undefined =>
    questData.find((q) => q.questId === questId)?.dungeonInstanceId;

  it.each([6642, 6643, 6644, 6645, 6646, 7487, 7848])(
    'files Blackrock Depths quest %i (Lokhtos / Lothos) under BRD (228)',
    (questId) => {
      expect(instanceOf(questId)).toBe(228);
    },
  );

  it('files every quest given inside Blackrock Depths under BRD (228)', () => {
    const brdGivenElsewhere = questData
      .filter((q) => q.questGiverZone === 'Blackrock Depths')
      .filter((q) => q.dungeonInstanceId !== 228)
      .map((q) => `${q.questId} -> ${String(q.dungeonInstanceId)}`);
    expect(brdGivenElsewhere).toEqual([]);
  });

  it.each([
    ['Stratholme - Main Gate', 'Strat:Live'],
    ['Stratholme - Service Entrance', 'Strat:UD'],
    ['Dire Maul - Capital Gardens', 'DM:W'],
    ['Dire Maul - Warpwood Quarter', 'DM:E'],
    ['Dire Maul - Gordok Commons', 'DM:N'],
  ])('labels %s as %s', (name, shortName) => {
    expect(INSTANCE_SHORT_NAMES[name]).toBe(shortName);
  });
});
