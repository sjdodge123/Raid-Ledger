/**
 * ROK-2142: the classic boss rows were fetched from the RETAIL journal and
 * tagged `classic`, so several dungeons served Cataclysm/MoP boss lists to
 * wow_forever and classic_era. These assertions pin the 1.12 lists.
 */
import bossEncounterData from './boss-encounter-data.json';
import bossLootData from './boss-loot-data.json';
import {
  MIN_BUNDLED_CLASSIC_BOSSES,
  MIN_BUNDLED_CLASSIC_LOOT,
  MIN_BUNDLED_FOREVER_LOOT,
} from '../boss-encounter-prune.helpers';

interface BossEntry {
  instanceId: number;
  name: string;
  order: number;
  expansion: string;
}

const classic = (bossEncounterData as BossEntry[]).filter(
  (b) => b.expansion === 'classic',
);
const loot = bossLootData as Array<{ bossName: string; expansion: string }>;

/** Bosses that exist only in the Cataclysm/MoP revamps (or retail renames). */
const POST_CLASSIC_BOSSES = [
  'Hogger',
  'Lord Overheat',
  'Randolph Moloch',
  'Adarogg',
  'Dark Shaman Koranthal',
  'Slagmaw',
  'Lava Guard Gordoth',
  'Aarux',
  'Mushlump',
  'Death Speaker Blackthorn',
  'Hunter Bonetusk',
  'Roogug',
  'Warlord Ramtusk',
  'Groyat, the Blind Hunter',
  'Instructor Chillheart',
  'Lilian Voss',
  'Houndmaster Braun',
  'Armsmaster Harlan',
  'Flameweaver Koegler',
  'Admiral Ripsnarl',
  '"Captain" Cookie',
  'Vanessa VanCleef',
  'Baron Ashbury',
  'Lord Walden',
  'Lord Godfrey',
  'Commander Malor',
  'Willey Hopebreaker',
  'Instructor Galford',
  'Lord Aurius Rivendare',
];

function bossNames(instanceId: number): string[] {
  return classic
    .filter((b) => b.instanceId === instanceId)
    .sort((a, b) => a.order - b.order)
    .map((b) => b.name);
}

describe('classic boss lists (ROK-2142)', () => {
  it('no classic row is a post-Classic (Cata/MoP) boss', () => {
    const bad = classic.filter((b) => POST_CLASSIC_BOSSES.includes(b.name));
    expect(bad.map((b) => `${b.instanceId}:${b.name}`)).toEqual([]);
  });

  it('no classic loot hangs off a post-Classic boss', () => {
    const bad = loot.filter(
      (l) =>
        l.expansion === 'classic' && POST_CLASSIC_BOSSES.includes(l.bossName),
    );
    expect([...new Set(bad.map((l) => l.bossName))]).toEqual([]);
  });

  it('the unmapped MoP Scarlet Halls instance (311) is gone', () => {
    expect(bossNames(311)).toEqual([]);
  });

  it('The Stockade (238) is the 1.12 list in order', () => {
    expect(bossNames(238)).toEqual([
      'Targorr the Dread',
      'Kam Deepfury',
      'Hamhock',
      'Bazil Thredd',
      'Dextren Ward',
    ]);
  });

  it.each([
    [226, 'Ragefire Chasm', 'Taragaman the Hungerer', 4],
    [234, 'Razorfen Kraul', 'Charlga Razorflank', 5],
    [233, 'Razorfen Downs', "Tuten'kash", 5],
    [246, 'Scholomance', 'Kirtonos the Herald', 13],
    [63, 'Deadmines', "Rhahk'Zor", 7],
    [64, 'Shadowfang Keep', 'Rethilgore', 8],
    [229, 'Blackrock Spire', 'Highlord Omokk', 14],
    [227, 'Blackfathom Deeps', 'Lorgus Jett', 8],
    [237, 'Sunken Temple', "Atal'alarion", 10],
    [1292, 'Stratholme (Service Entrance)', 'Baron Rivendare', 6],
  ])('%s %s carries %s and %i bosses', (id, _label, boss, count) => {
    const names = bossNames(id);
    expect(names).toContain(boss);
    expect(names).toHaveLength(count);
  });

  it('every classic instance has contiguous 1..n order with no duplicates', () => {
    // Scarlet Monastery (316) restarts `order` per wing — see SUB_INSTANCE_BOSSES.
    const ids = [...new Set(classic.map((b) => b.instanceId))].filter(
      (id) => id !== 316,
    );
    const bad = ids.filter((id) => {
      const orders = classic
        .filter((b) => b.instanceId === id)
        .map((b) => b.order)
        .sort((a, b) => a - b);
      return orders.some((o, i) => o !== i + 1);
    });
    expect(bad).toEqual([]);
  });

  // ROK-2168: below these minimums the seeder's stale-row prune skips itself
  // with only a boot warning. A re-curation that drops the bundled lists under
  // them must fail here — lower MIN_BUNDLED_CLASSIC_* in
  // boss-encounter-prune.helpers.ts deliberately instead.
  it('bundled classic boss count meets the prune floor (MIN_BUNDLED_CLASSIC_BOSSES)', () => {
    expect(classic.length).toBeGreaterThanOrEqual(MIN_BUNDLED_CLASSIC_BOSSES);
  });

  it('bundled classic loot count meets the prune floor (MIN_BUNDLED_CLASSIC_LOOT)', () => {
    const classicLoot = loot.filter((l) => l.expansion === 'classic');
    expect(classicLoot.length).toBeGreaterThanOrEqual(MIN_BUNDLED_CLASSIC_LOOT);
  });
});

describe('bundled Forever loot (ROK-2170 D7)', () => {
  // ROK-2170 D7: same floor for the Forever loot prune.
  it('bundled forever loot count meets the prune floor (MIN_BUNDLED_FOREVER_LOOT)', () => {
    const foreverLoot = loot.filter((l) => l.expansion === 'forever');
    expect(foreverLoot.length).toBeGreaterThanOrEqual(MIN_BUNDLED_FOREVER_LOOT);
  });
});
