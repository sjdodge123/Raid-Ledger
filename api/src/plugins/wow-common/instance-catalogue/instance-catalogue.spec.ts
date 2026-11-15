import {
  allCatalogueRows,
  byForeverQuestAreaId,
  byWowheadZoneId,
  FOREVER_SEED_ID_BASE,
  getAnyVariant,
  getInstance,
  instanceName,
  isCatalogueId,
  listInstances,
  lowestDungeonLevel,
  parentIdOf,
  servesVariant,
  toDetailDto,
  toListDto,
} from './instance-catalogue';
import { InstanceCatalogueService } from './instance-catalogue.service';
import type {
  CatalogueInstance,
  CatalogueVariant,
} from './instance-catalogue.types';

const VARIANTS: readonly CatalogueVariant[] = ['classic_era', 'wow_forever'];
const SEED_IDS = Array.from(
  { length: 11 },
  (_, i) => FOREVER_SEED_ID_BASE + i + 1,
);
const CLASSIC_RAIDS = [741, 760, 742, 76, 743, 744, 754];

function ids(rows: readonly CatalogueInstance[]): number[] {
  return rows.map((r) => r.id);
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`missing ${label}`);
  return value;
}

describe('instance catalogue — row integrity', () => {
  it('has each (id, variant) at most once', () => {
    const keys = allCatalogueRows().flatMap((r) =>
      r.variants.map((v) => `${v}:${r.id}`),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves every parentId to a row of the same variant', () => {
    const orphans = allCatalogueRows().flatMap((r) =>
      r.parentId === null
        ? []
        : r.variants
            .filter((v) => getInstance(r.parentId ?? -1, v) === null)
            .map((v) => `${v}:${r.id}→${r.parentId}`),
    );
    expect(orphans).toEqual([]);
  });

  it('gives every listed Forever dungeon at least one quest area', () => {
    const bare = listInstances('wow_forever', 'dungeon')
      .filter((r) => r.foreverQuestAreaIds.length === 0)
      .map((r) => r.id);
    expect(bare).toEqual([]);
  });

  it('keeps minimumLevel ≤ maximumLevel on every row', () => {
    const bad = allCatalogueRows()
      .filter((r) => r.minimumLevel > r.maximumLevel)
      .map((r) => r.id);
    expect(bad).toEqual([]);
  });

  it('gives classic_era rows no Forever quest areas and classic loot', () => {
    const bad = allCatalogueRows()
      .filter((r) => r.variants.includes('classic_era'))
      .filter(
        (r) =>
          r.foreverQuestAreaIds.length > 0 || r.lootExpansion !== 'classic',
      )
      .map((r) => r.id);
    expect(bad).toEqual([]);
  });
});

describe('instance catalogue — lists per variant', () => {
  it.each([
    ['classic_era', 'dungeon', 28],
    ['classic_era', 'raid', 7],
    ['wow_forever', 'dungeon', 37],
    ['wow_forever', 'raid', 9],
  ] as const)('%s %s lists %i rows', (v, c, count) => {
    expect(listInstances(v, c)).toHaveLength(count);
  });

  it('labels every Forever row Forever and every classic_era row Classic', () => {
    const forever = [
      ...listInstances('wow_forever', 'dungeon'),
      ...listInstances('wow_forever', 'raid'),
    ];
    const era = [
      ...listInstances('classic_era', 'dungeon'),
      ...listInstances('classic_era', 'raid'),
    ];
    expect(new Set(forever.map((r) => r.expansion))).toEqual(
      new Set(['Forever']),
    );
    expect(new Set(forever.flatMap((r) => r.variants))).toEqual(
      new Set(['wow_forever']),
    );
    expect(new Set(era.map((r) => r.expansion))).toEqual(new Set(['Classic']));
  });
});

describe('instance catalogue — list membership', () => {
  it('lists UBRS 22901 and omits Scarlet Halls 311 for both variants', () => {
    for (const v of VARIANTS) {
      const dungeons = ids(listInstances(v, 'dungeon'));
      expect(dungeons).toContain(22901);
      expect(dungeons).not.toContain(311);
      expect(getInstance(311, v)).toBeNull();
    }
    expect(getInstance(22901, 'wow_forever')?.name).toBe(
      'Upper Blackrock Spire',
    );
    expect(getInstance(22901, 'wow_forever')?.maxPlayers).toBe(10);
  });

  it('lists all seven Classic raids (and no BRD raid 1301) for both variants', () => {
    for (const v of VARIANTS) {
      const raids = ids(listInstances(v, 'raid'));
      expect(raids.slice(0, 7)).toEqual(CLASSIC_RAIDS);
      expect(raids).not.toContain(1301);
    }
    expect(ids(listInstances('wow_forever', 'raid')).slice(7)).toEqual(
      SEED_IDS.slice(9),
    );
  });

  it('lists Forever-new dungeons after the Classic ones, ids unchanged', () => {
    expect(ids(listInstances('wow_forever', 'dungeon')).slice(28)).toEqual(
      SEED_IDS.slice(0, 9),
    );
    expect(ids(listInstances('classic_era', 'dungeon'))).toEqual(
      ids(listInstances('wow_forever', 'dungeon')).slice(0, 28),
    );
  });

  it('never lists the complex parents 316 / 232, yet resolves them', () => {
    for (const v of VARIANTS) {
      expect(ids(listInstances(v, 'dungeon'))).not.toEqual(
        expect.arrayContaining([316]),
      );
      expect(ids(listInstances(v, 'dungeon'))).not.toContain(232);
      expect(getInstance(316, v)?.listed).toBe(false);
    }
  });
});

describe('instance catalogue — names, levels, sources', () => {
  it('uses Blizzard spelling for the renamed Forever-new dungeons', () => {
    expect(getInstance(FOREVER_SEED_ID_BASE + 1, 'wow_forever')?.name).toBe(
      'The Hall of Thanes',
    );
    expect(getInstance(FOREVER_SEED_ID_BASE + 9, 'wow_forever')?.name).toBe(
      "The Shaper's Terrace",
    );
  });

  it('sets levelSource: classic_era on every classic_era row', () => {
    const era = allCatalogueRows().filter((r) =>
      r.variants.includes('classic_era'),
    );
    expect(new Set(era.map((r) => r.levelSource))).toEqual(
      new Set(['classic_era']),
    );
  });

  it('sets levelSource: in_game on every wow_forever row but the two unreleased raids', () => {
    const notInGame = allCatalogueRows()
      .filter((r) => r.variants.includes('wow_forever'))
      .filter((r) => r.levelSource !== 'in_game')
      .map((r) => `${r.name}:${r.levelSource}`);
    expect(notInGame).toEqual(['Barrow Deeps:community', 'Hyjal Summit:community']);
  });

  // The six rows the operator's in-game finder screenshot shows (2026-11-15).
  it.each([
    ['Razorfen Kraul', 234, 29, 38],
    ['City of Dalaran', FOREVER_SEED_ID_BASE + 4, 28, 35],
    ['Excavation Site: Wetlands', FOREVER_SEED_ID_BASE + 3, 26, 33],
    ['Blackfathom Deeps', 227, 24, 32],
    ['The Stockade', 238, 24, 32],
    ['Shadowfang Keep', 64, 20, 30],
  ])('gives wow_forever %s (%i) the in-game finder span %i-%i', (name, id, min, max) => {
    expect(getInstance(id, 'wow_forever')).toMatchObject({
      name,
      minimumLevel: min,
      maximumLevel: max,
      levelSource: 'in_game',
    });
  });

  it('gives Maraudon and every wing its single finder span 46-55 on wow_forever', () => {
    const spans = [232, 23201, 23202, 23203].map((id) => {
      const row = must(getInstance(id, 'wow_forever'), `${id} forever`);
      return `${id}:${row.minimumLevel}-${row.maximumLevel}`;
    });
    expect(spans).toEqual(['232:46-55', '23201:46-55', '23202:46-55', '23203:46-55']);
  });

  it('leaves the classic_era Razorfen Kraul row on its Classic levels', () => {
    expect(getInstance(234, 'classic_era')).toMatchObject({
      minimumLevel: 30,
      maximumLevel: 40,
      levelSource: 'classic_era',
    });
  });

  it('keeps the Forever edition in step with its classic_era row', () => {
    const era = must(getInstance(234, 'classic_era'), '234 era');
    const forever = must(getInstance(234, 'wow_forever'), '234 forever');
    expect(forever).toMatchObject({
      name: era.name,
      shortName: era.shortName,
      maxPlayers: era.maxPlayers,
      wowheadZoneId: 491,
      foreverQuestAreaIds: [1717],
      lootExpansion: 'forever',
    });
  });

  it('names instances like the quest views do today, plus the wings and seeds', () => {
    expect(instanceName(230)).toBe('Dire Maul');
    expect(instanceName(229)).toBe('Blackrock Spire');
    expect(instanceName(31601)).toBe('SM: Graveyard');
    expect(instanceName(316)).toBe('Scarlet Monastery');
    expect(instanceName(1276)).toBe('Dire Maul - Warpwood Quarter');
    expect(instanceName(FOREVER_SEED_ID_BASE + 2)).toBe('Ruins of Lordaeron');
    expect(instanceName(5)).toBe('Instance 5');
  });

  it('reports 13 as the lowest dungeon level for both variants', () => {
    expect(lowestDungeonLevel('wow_forever')).toBe(13);
    expect(lowestDungeonLevel('classic_era')).toBe(13);
  });
});

describe('instance catalogue — lookups', () => {
  it('serves only classic_era and wow_forever', () => {
    expect(servesVariant('classic_era')).toBe(true);
    expect(servesVariant('wow_forever')).toBe(true);
    expect(servesVariant('retail')).toBe(false);
    expect(servesVariant('classic')).toBe(false);
    expect(servesVariant('classic_anniversary')).toBe(false);
  });

  it('getAnyVariant prefers wow_forever; unknown ids are null', () => {
    expect(getAnyVariant(63)?.variants).toEqual(['wow_forever']);
    expect(getAnyVariant(311)).toBeNull();
    expect(isCatalogueId(22901)).toBe(true);
    expect(isCatalogueId(1301)).toBe(false);
  });

  it('resolves wing parents', () => {
    expect(parentIdOf(31603)).toBe(316);
    expect(parentIdOf(23202)).toBe(232);
    expect(parentIdOf(1277)).toBe(230);
    expect(parentIdOf(1292)).toBe(236);
    expect(parentIdOf(22901)).toBe(229);
    expect(parentIdOf(226)).toBeNull();
  });

  it('maps a Wowhead zone to the non-wing row of that zone', () => {
    expect(byWowheadZoneId(491, 'wow_forever')?.id).toBe(234);
    expect(byWowheadZoneId(1583, 'wow_forever')?.id).toBe(229);
    expect(byWowheadZoneId(796, 'wow_forever')?.id).toBe(316);
    expect(byWowheadZoneId(16550, 'wow_forever')?.id).toBe(
      FOREVER_SEED_ID_BASE + 5,
    );
    expect(byWowheadZoneId(16550, 'classic_era')).toBeNull();
  });

  it('finds every Forever row on a quest area', () => {
    expect(ids(byForeverQuestAreaId(796))).toEqual([
      316, 31601, 31602, 31603, 31604,
    ]);
    expect(ids(byForeverQuestAreaId(236))).toEqual([64]);
    expect(byForeverQuestAreaId(1)).toEqual([]);
  });

  it('builds list and detail DTOs', () => {
    const row = must(
      getInstance(FOREVER_SEED_ID_BASE + 10, 'wow_forever'),
      'BD',
    );
    expect(toListDto(row)).toEqual({
      id: FOREVER_SEED_ID_BASE + 10,
      name: 'Barrow Deeps',
      shortName: 'BD',
      expansion: 'Forever',
      minimumLevel: 60,
      maximumLevel: 60,
      levelSource: 'community',
      wowheadZoneId: 16871,
    });
    expect(toDetailDto(row)).toMatchObject({
      maxPlayers: 10,
      category: 'raid',
    });
  });
});

describe('InstanceCatalogueService', () => {
  const service = new InstanceCatalogueService();

  it('delegates list and get', () => {
    expect(service.list('wow_forever', 'raid')).toEqual(
      listInstances('wow_forever', 'raid'),
    );
    expect(service.get(22901, 'classic_era')?.expansion).toBe('Classic');
    expect(service.get(999, 'wow_forever')).toBeNull();
  });
});
