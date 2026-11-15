import bossData from './data/boss-encounter-data.json';
import questData from './data/dungeon-quest-data.json';
import {
  FOREVER_JOURNAL_ALIASES,
  resolveQuestInstanceIds,
} from './forever-instance-aliases';
import {
  allCatalogueRows,
  FOREVER_SEED_ID_BASE,
  getInstance,
} from './instance-catalogue/instance-catalogue';
import { journalShortName } from './instance-catalogue/journal-overlay.data';

/** A Forever-new seed row the catalogue serves (90000001+). */
const isForeverSeedId = (id: number): boolean =>
  id > FOREVER_SEED_ID_BASE && getInstance(id, 'wow_forever') !== null;

/** Every Classic Era wing row: [wing id, parent id]. */
const CLASSIC_WINGS: Array<[number, number]> = allCatalogueRows()
  .filter((r) => r.variants.includes('classic_era'))
  .flatMap((r) => (r.parentId === null ? [] : [[r.id, r.parentId]]));

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
  it('treats only the reserved seed span as seed ids (upper bound)', () => {
    const past = FOREVER_SEED_ID_BASE + 1000;
    expect(resolveQuestInstanceIds(past, { [past]: SEED_1 })).toEqual([
      past,
      SEED_1,
    ]);
  });

  it('returns a seed id alone (no /100 parent rule)', () => {
    expect(resolveQuestInstanceIds(SEED_1)).toEqual([SEED_1]);
  });

  it('returns an aliased journal id plus its seed id', () => {
    expect(resolveQuestInstanceIds(1301, { 1301: SEED_1 })).toEqual([
      1301,
      SEED_1,
    ]);
  });

  it('resolves a synthetic wing id to its catalogue parent', () => {
    expect(resolveQuestInstanceIds(31601)).toEqual([31601, 316]);
    expect(resolveQuestInstanceIds(23203)).toEqual([23203, 232]);
  });

  it('resolves Upper Blackrock Spire (22901) to Blackrock Spire (229) (ROK-2210)', () => {
    expect(resolveQuestInstanceIds(22901)).toEqual([22901, 229]);
  });

  it('no longer guesses a parent for a non-catalogue id above 10 000', () => {
    expect(resolveQuestInstanceIds(31699)).toEqual([31699]);
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

describe('catalogue wing parents (ROK-2142 / ROK-2210)', () => {
  const questIds = new Set(questData.map((q) => q.dungeonInstanceId));
  const classicBossIds = new Set(
    bossData.filter((b) => b.expansion === 'classic').map((b) => b.instanceId),
  );

  it('has exactly the wings the quest views resolve', () => {
    expect(CLASSIC_WINGS.map(([w]) => w).sort((a, b) => a - b)).toEqual([
      1276, 1277, 1292, 22901, 23201, 23202, 23203, 31601, 31602, 31603, 31604,
    ]);
  });

  it('lists only journal wing ids (< 10 000) the classic boss data offers', () => {
    const journalWings = CLASSIC_WINGS.map(([w]) => w).filter(
      (w) => w < 10_000,
    );
    expect(journalWings).toEqual([1276, 1277, 1292]);
    for (const wing of journalWings) {
      expect({ wing, offered: classicBossIds.has(wing) }).toEqual({
        wing,
        offered: true,
      });
    }
  });

  it('maps every wing to a parent that has classic quest rows', () => {
    for (const [wing, parent] of CLASSIC_WINGS) {
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
    expect(journalShortName(name)).toBe(shortName);
  });
});
