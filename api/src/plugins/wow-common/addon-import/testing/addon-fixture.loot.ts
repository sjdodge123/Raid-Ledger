import type { AddonLootDrop, AddonLootExport } from '@raid-ledger/contract';
import {
  FIXTURE_EXPORTED_AT,
  FIXTURE_GUID,
  buildWho,
} from './addon-fixture.builder';

/**
 * Synthetic LedgerLink v2 `loot` payloads (ROK-2184). No real names, GUIDs
 * or guilds (spec "Fixture anonymisation rule"): the exporter is the
 * builder's invented "Ana Forever"; the other looters are `Lootero` /
 * `Lootera`. Item, instance and encounter ids are public game data
 * (Molten Core, Lucifron).
 */
const DAY = 86_400;

/** A boss drop `i * 5 min` after a point three days before export. */
export function buildLootDrop(
  i: number,
  overrides: Partial<AddonLootDrop> = {},
): AddonLootDrop {
  return {
    at: FIXTURE_EXPORTED_AT - 3 * DAY + i * 300,
    itemId: 16800 + i,
    quantity: 1,
    quality: 4,
    looterName: i % 2 === 0 ? 'Ana Forever' : 'Lootero',
    looterGuid: i % 2 === 0 ? FIXTURE_GUID : 'Player-4395-00000002',
    method: 'master',
    instanceId: 409,
    difficultyId: 9,
    encounterId: 663,
    encounterName: 'Lucifron',
    ...overrides,
  };
}

/** A whole `loot` export over the default 30-day window. */
export function buildLootPayload(
  drops: AddonLootDrop[],
  data: Partial<AddonLootExport['data']> = {},
): AddonLootExport {
  return {
    schema: 2,
    addonVersion: '0.1.0',
    client: { interface: 11507, build: '1.15.7', locale: 'enUS', region: 1 },
    exportedAt: FIXTURE_EXPORTED_AT,
    who: buildWho(),
    section: 'loot',
    data: {
      windowStart: FIXTURE_EXPORTED_AT - 30 * DAY,
      windowEnd: FIXTURE_EXPORTED_AT,
      minQuality: 2,
      drops,
      ...data,
    },
  };
}

/** The golden `loot` fixture: two boss drops, a trash stack, a linked drop. */
export function buildLootFixturePayload(): AddonLootExport {
  return buildLootPayload([
    buildLootDrop(0),
    buildLootDrop(1, { method: 'roll' }),
    {
      at: FIXTURE_EXPORTED_AT - 2 * DAY,
      itemId: 12360,
      quantity: 3,
      looterName: 'Lootera-Testrealm',
      method: 'direct',
      instanceId: 409,
      difficultyId: 9,
    },
    buildLootDrop(3, {
      link: '|cffa335ee|Hitem:16803::::::::60:::::|h[Example Boots]|h|r',
      method: 'unknown',
    }),
  ]);
}
