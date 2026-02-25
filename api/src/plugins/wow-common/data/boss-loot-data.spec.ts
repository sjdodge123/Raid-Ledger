/**
 * Data integrity tests for boss-loot-data.json (ROK-474)
 *
 * These tests verify that the loot seed data is complete, well-formed, and
 * consistent with the boss encounter data.  They are intentionally adversarial:
 * they encode the acceptance criteria from the story spec and should catch any
 * regression introduced by editing the JSON files.
 */

import bossEncounterData from './boss-encounter-data.json';
import bossLootData from './boss-loot-data.json';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

interface BossEntry {
  instanceId: number;
  name: string;
  order: number;
  expansion: string;
  sodModified: boolean;
}

interface LootEntry {
  bossName: string;
  expansion: string;
  itemId: number;
  itemName: string;
  slot: string | null;
  quality: string;
  itemLevel: number | null;
  dropRate: number | null;
  classRestrictions: string[] | null;
  iconUrl: string | null;
  itemSubclass: string | null;
}

const bosses = bossEncounterData as BossEntry[];
const loot = bossLootData as LootEntry[];

const VALID_QUALITIES = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
] as const;

// ---------------------------------------------------------------------------
// Schema / structure
// ---------------------------------------------------------------------------

describe('boss-loot-data.json — schema', () => {
  it('parses as a non-empty JSON array', () => {
    expect(Array.isArray(loot)).toBe(true);
    expect(loot.length).toBeGreaterThan(0);
  });

  it('has at least 284 total loot entries (ROK-474 added 209 items)', () => {
    expect(loot.length).toBeGreaterThanOrEqual(284);
  });

  it('every entry has a non-empty bossName string', () => {
    const bad = loot.filter(
      (l) => typeof l.bossName !== 'string' || l.bossName.trim() === '',
    );
    expect(bad).toHaveLength(0);
  });

  it('every entry has a non-empty expansion string', () => {
    const bad = loot.filter(
      (l) => typeof l.expansion !== 'string' || l.expansion.trim() === '',
    );
    expect(bad).toHaveLength(0);
  });

  it('every entry has a positive integer itemId', () => {
    const bad = loot.filter(
      (l) => !Number.isInteger(l.itemId) || l.itemId <= 0,
    );
    expect(bad).toHaveLength(0);
  });

  it('every entry has a non-empty itemName string', () => {
    const bad = loot.filter(
      (l) => typeof l.itemName !== 'string' || l.itemName.trim() === '',
    );
    expect(bad).toHaveLength(0);
  });

  it('every entry has a valid quality value', () => {
    const bad = loot.filter(
      (l) =>
        !VALID_QUALITIES.includes(
          l.quality as (typeof VALID_QUALITIES)[number],
        ),
    );
    expect(bad).toHaveLength(0);
  });

  it('slot is either null or a non-empty string', () => {
    const bad = loot.filter(
      (l) =>
        l.slot !== null && (typeof l.slot !== 'string' || l.slot.trim() === ''),
    );
    expect(bad).toHaveLength(0);
  });

  it('itemLevel is either null or a positive integer', () => {
    const bad = loot.filter(
      (l) =>
        l.itemLevel !== null &&
        (!Number.isInteger(l.itemLevel) || l.itemLevel <= 0),
    );
    expect(bad).toHaveLength(0);
  });

  it('dropRate is either null or a number in range [0, 1]', () => {
    const bad = loot.filter(
      (l) =>
        l.dropRate !== null &&
        (typeof l.dropRate !== 'number' || l.dropRate < 0 || l.dropRate > 1),
    );
    expect(bad).toHaveLength(0);
  });

  it('classRestrictions is either null or a non-empty array of strings', () => {
    const bad = loot.filter((l) => {
      if (l.classRestrictions === null) return false;
      if (!Array.isArray(l.classRestrictions)) return true;
      if (l.classRestrictions.length === 0) return true; // should be null, not []
      return l.classRestrictions.some(
        (c) => typeof c !== 'string' || c.trim() === '',
      );
    });
    expect(bad).toHaveLength(0);
  });

  it('iconUrl is either null or a valid https URL', () => {
    const bad = loot.filter(
      (l) =>
        l.iconUrl !== null &&
        (typeof l.iconUrl !== 'string' || !l.iconUrl.startsWith('https://')),
    );
    expect(bad).toHaveLength(0);
  });

  it('itemSubclass is either null or a non-empty string', () => {
    const bad = loot.filter(
      (l) =>
        l.itemSubclass !== null &&
        (typeof l.itemSubclass !== 'string' || l.itemSubclass.trim() === ''),
    );
    expect(bad).toHaveLength(0);
  });

  it('expansion values are limited to known WoW expansion identifiers', () => {
    const VALID_EXPANSIONS = ['classic', 'tbc', 'wotlk', 'cata', 'sod'];
    const bad = loot.filter((l) => !VALID_EXPANSIONS.includes(l.expansion));
    expect(bad).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Uniqueness / duplicates
// ---------------------------------------------------------------------------

describe('boss-loot-data.json — uniqueness', () => {
  it('has no duplicate bossName+expansion+itemId combinations (seeder conflict key)', () => {
    const keys = loot.map((l) => `${l.bossName}::${l.expansion}::${l.itemId}`);
    const unique = new Set(keys);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toHaveLength(0);
    expect(unique.size).toBe(keys.length);
  });

  it('has no duplicate itemId within the same boss+expansion (same item twice on one boss)', () => {
    const seen = new Map<string, Set<number>>();
    const dupes: string[] = [];

    loot.forEach((l) => {
      const bossKey = `${l.bossName}::${l.expansion}`;
      if (!seen.has(bossKey)) seen.set(bossKey, new Set());
      const ids = seen.get(bossKey)!;
      if (ids.has(l.itemId)) {
        dupes.push(`${bossKey}::${l.itemId}`);
      }
      ids.add(l.itemId);
    });

    expect(dupes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Completeness — every seeded boss must have loot
// ---------------------------------------------------------------------------

describe('boss-loot-data.json — completeness against boss-encounter-data.json', () => {
  const lootIndex = new Set(loot.map((l) => `${l.bossName}::${l.expansion}`));

  it('covers all seeded bosses (no boss has zero loot entries)', () => {
    const bossKeys = bosses.map((b) => `${b.name}::${b.expansion}`);
    const missing = bossKeys.filter((k) => !lootIndex.has(k));
    expect(missing).toHaveLength(0);
  });

  it('every loot entry references a boss that exists in boss-encounter-data.json', () => {
    const encounterIndex = new Set(
      bosses.map((b) => `${b.name}::${b.expansion}`),
    );
    const orphans = loot.filter(
      (l) => !encounterIndex.has(`${l.bossName}::${l.expansion}`),
    );
    expect(orphans).toHaveLength(0);
  });

  it('all Classic bosses have at least one loot item', () => {
    const classicBosses = bosses.filter((b) => b.expansion === 'classic');
    const classicLootBosses = new Set(
      loot.filter((l) => l.expansion === 'classic').map((l) => l.bossName),
    );
    const missing = classicBosses.filter((b) => !classicLootBosses.has(b.name));
    expect(missing).toHaveLength(0);
  });

  it('has at least 109 Classic loot entries', () => {
    const classicLoot = loot.filter((l) => l.expansion === 'classic');
    expect(classicLoot.length).toBeGreaterThanOrEqual(109);
  });

  it('Majordomo Executus (Classic) has loot — previously one of the gap bosses', () => {
    const items = loot.filter(
      (l) => l.bossName === 'Majordomo Executus' && l.expansion === 'classic',
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it('Viscidus (Classic — AQ40) has loot', () => {
    const items = loot.filter(
      (l) => l.bossName === 'Viscidus' && l.expansion === 'classic',
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it('Archmage Arugal (Classic dungeon) has loot', () => {
    const items = loot.filter(
      (l) => l.bossName === 'Archmage Arugal' && l.expansion === 'classic',
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it('General Drakkisath (Classic — UBRS) has loot', () => {
    const items = loot.filter(
      (l) => l.bossName === 'General Drakkisath' && l.expansion === 'classic',
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it('Scarlet Monastery bosses all have loot', () => {
    const smBosses = [
      'Interrogator Vishas',
      'Bloodmage Thalnos',
      'Houndmaster Loksey',
      'Arcanist Doan',
      'Herod',
      'High Inquisitor Fairbanks',
      'Scarlet Commander Mograine',
      'High Inquisitor Whitemane',
    ];
    const classicLootBosses = new Set(
      loot.filter((l) => l.expansion === 'classic').map((l) => l.bossName),
    );
    const missing = smBosses.filter((n) => !classicLootBosses.has(n));
    expect(missing).toHaveLength(0);
  });

  it('SoD bosses all have loot', () => {
    const sodBosses = bosses.filter((b) => b.expansion === 'sod');
    const sodLootBosses = new Set(
      loot.filter((l) => l.expansion === 'sod').map((l) => l.bossName),
    );
    const missing = sodBosses.filter((b) => !sodLootBosses.has(b.name));
    expect(missing).toHaveLength(0);
  });

  it('TBC bosses all have loot', () => {
    const tbcBosses = bosses.filter((b) => b.expansion === 'tbc');
    const tbcLootBosses = new Set(
      loot.filter((l) => l.expansion === 'tbc').map((l) => l.bossName),
    );
    const missing = tbcBosses.filter((b) => !tbcLootBosses.has(b.name));
    expect(missing).toHaveLength(0);
  });

  it('WotLK bosses all have loot', () => {
    const wotlkBosses = bosses.filter((b) => b.expansion === 'wotlk');
    const wotlkLootBosses = new Set(
      loot.filter((l) => l.expansion === 'wotlk').map((l) => l.bossName),
    );
    const missing = wotlkBosses.filter((b) => !wotlkLootBosses.has(b.name));
    expect(missing).toHaveLength(0);
  });

  it('Cata bosses all have loot', () => {
    const cataBosses = bosses.filter((b) => b.expansion === 'cata');
    const cataLootBosses = new Set(
      loot.filter((l) => l.expansion === 'cata').map((l) => l.bossName),
    );
    const missing = cataBosses.filter((b) => !cataLootBosses.has(b.name));
    expect(missing).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Data quality — specific field validity
// ---------------------------------------------------------------------------

describe('boss-loot-data.json — data quality', () => {
  it('all loot items have a non-null quality', () => {
    const nullQuality = loot.filter(
      (l) => l.quality === null || l.quality === undefined,
    );
    expect(nullQuality).toHaveLength(0);
  });

  it('all Classic loot itemLevels are positive (non-zero)', () => {
    const bad = loot.filter(
      (l) =>
        l.expansion === 'classic' &&
        l.itemLevel !== null &&
        l.itemLevel !== undefined &&
        l.itemLevel <= 0,
    );
    expect(bad).toHaveLength(0);
  });

  it('Classic loot itemLevels are within a reasonable range (1–90)', () => {
    const bad = loot.filter(
      (l) =>
        l.expansion === 'classic' &&
        l.itemLevel !== null &&
        (l.itemLevel < 1 || l.itemLevel > 90),
    );
    expect(bad).toHaveLength(0);
  });

  it('Legendary items have itemId > 0', () => {
    const legendaries = loot.filter((l) => l.quality === 'Legendary');
    const bad = legendaries.filter((l) => l.itemId <= 0);
    expect(bad).toHaveLength(0);
  });

  it('icon URLs that are present point to a known CDN domain', () => {
    const KNOWN_ICON_HOSTS = [
      'wow.zamimg.com',
      'wowhead.com',
      'render.worldofwarcraft.com',
    ];
    const withIcon = loot.filter((l) => l.iconUrl !== null);
    const badDomain = withIcon.filter(
      (l) => !KNOWN_ICON_HOSTS.some((host) => l.iconUrl!.includes(host)),
    );
    expect(badDomain).toHaveLength(0);
  });

  it('all expansion values match the expansion of the corresponding seeded boss', () => {
    const encounterMap = new Map<string, string>(
      bosses.map((b) => [`${b.name}::${b.expansion}`, b.expansion]),
    );
    const mismatched = loot.filter((l) => {
      const key = `${l.bossName}::${l.expansion}`;
      const bossExpansion = encounterMap.get(key);
      // If we find the boss, expansions must match (they form the key, so they always will)
      // This checks that bossName+expansion uniquely exists in the encounter data
      return bossExpansion === undefined;
    });
    expect(mismatched).toHaveLength(0);
  });

  it('Sulfuras, Hand of Ragnaros is Legendary quality', () => {
    const sulfuras = loot.find(
      (l) =>
        l.bossName === 'Ragnaros' &&
        l.expansion === 'classic' &&
        l.itemId === 17182,
    );
    expect(sulfuras).toBeDefined();
    expect(sulfuras!.quality).toBe('Legendary');
  });

  it('Bindings of the Windseeker entries exist for both Garr and Baron Geddon', () => {
    const garr = loot.find(
      (l) =>
        l.bossName === 'Garr' &&
        l.expansion === 'classic' &&
        l.itemName === 'Bindings of the Windseeker',
    );
    const baron = loot.find(
      (l) =>
        l.bossName === 'Baron Geddon' &&
        l.expansion === 'classic' &&
        l.itemName === 'Bindings of the Windseeker',
    );
    expect(garr).toBeDefined();
    expect(baron).toBeDefined();
    // They should have different itemIds (left vs right binding)
    expect(garr!.itemId).not.toBe(baron!.itemId);
  });
});

// ---------------------------------------------------------------------------
// Regression — previously seeded items must still be present
// ---------------------------------------------------------------------------

describe('boss-loot-data.json — regression (existing loot not removed)', () => {
  it('Ragnaros (Classic) still has Sulfuras in loot', () => {
    const item = loot.find(
      (l) =>
        l.bossName === 'Ragnaros' &&
        l.expansion === 'classic' &&
        l.itemId === 17182,
    );
    expect(item).toBeDefined();
    expect(item!.itemName).toBe('Sulfuras, Hand of Ragnaros');
  });

  it('Ragnaros (Classic) still has Band of Accuria in loot', () => {
    const item = loot.find(
      (l) =>
        l.bossName === 'Ragnaros' &&
        l.expansion === 'classic' &&
        l.itemId === 17063,
    );
    expect(item).toBeDefined();
    expect(item!.itemName).toBe('Band of Accuria');
  });

  it('Lucifron (Classic) still has Felheart Belt in loot', () => {
    const item = loot.find(
      (l) =>
        l.bossName === 'Lucifron' &&
        l.expansion === 'classic' &&
        l.itemId === 16806,
    );
    expect(item).toBeDefined();
    expect(item!.itemName).toBe('Felheart Belt');
  });

  it('total loot count has not regressed below 284', () => {
    expect(loot.length).toBeGreaterThanOrEqual(284);
  });

  it('Classic loot count has not regressed below 109', () => {
    const classicLoot = loot.filter((l) => l.expansion === 'classic');
    expect(classicLoot.length).toBeGreaterThanOrEqual(109);
  });
});
