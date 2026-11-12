/**
 * ROK-2176 — parsed Wowhead tooltips against a real database:
 * the migration's columns, the resolver storing the parsed fixture tooltip,
 * the boss-loot backfill query + run, and the read-only exposure on boss loot
 * and character detail (Armory + LedgerLink addon gear). AC 2: a read of a
 * fresh item never calls Wowhead. The fetch is stubbed one layer above
 * `fetchFn` (spy on `fetchWowheadItem`) and serves captured fixture JSON
 * through the REAL `parseWowheadTooltip`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { CharacterEquipmentDto, ItemTooltip } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BossEncountersService } from '../boss-encounters.service';
import { bossLootBackfillIds } from './wow-item-meta.backfill';
import { WowItemMetaService } from './wow-item-meta.service';
import {
  WOWHEAD_TOOLTIP_PARSE_VERSION,
  type WowheadEnv,
  type WowheadFetchResult,
} from './wowhead-item.types';

const fetchModule = jest.requireActual<typeof import('./wowhead-item.fetch')>(
  './wowhead-item.fetch',
);

const FIXTURE_DIR = join(__dirname, '../testing/fixtures/wowhead');
const fixture = (file: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'));

/** Captured tooltip bodies keyed `<itemId>-<env>`; anything else 404s. */
const FIXTURES = new Map<string, unknown>([
  ['17182-4', fixture('item-17182-env4.json')],
  ['18821-4', fixture('item-18821-env4.json')],
  ['234819-16', fixture('item-234819-env16.json')],
]);
const MISS: WowheadFetchResult = { kind: 'not_found' };

function stubWowhead(): jest.SpyInstance {
  return jest
    .spyOn(fetchModule, 'fetchWowheadItem')
    .mockImplementation((id: number, env: WowheadEnv) => {
      const body = FIXTURES.get(`${id}-${env}`);
      return Promise.resolve(
        body === undefined ? MISS : fetchModule.parseWowheadTooltip(body, env),
      );
    });
}

const TOOLTIP: ItemTooltip = {
  env: 16,
  slotLabel: 'Legs',
  subclass: 'Plate',
  binding: 'Binds when picked up',
  unique: false,
  requiredLevel: 60,
  armor: 700,
  weapon: null,
  stats: [{ key: 'STAMINA', name: 'Stamina', value: 20 }],
  effects: ['Equip: Improves your chance to hit by 1%.'],
  setName: null,
  randomEnchant: false,
};

const DAY = 86_400_000;
const FOREVER_SLUG = 'world-of-warcraft-forever';
const CLASSIC_SLUG = 'world-of-warcraft-classic';

let testApp: TestApp;
let service: WowItemMetaService;
let bosses: BossEncountersService;

/** A found, fresh row (next re-probe a day out) unless overridden. */
async function seedMeta(
  itemId: number,
  over: Partial<typeof schema.wowItemMeta.$inferInsert> = {},
): Promise<void> {
  await testApp.db.insert(schema.wowItemMeta).values({
    itemId,
    status: 'resolved',
    env: 16,
    name: `Item ${itemId}`,
    quality: 4,
    fetchedAt: new Date(),
    nextRetryAt: new Date(Date.now() + DAY),
    tooltip: TOOLTIP,
    tooltipVersion: WOWHEAD_TOOLTIP_PARSE_VERSION,
    ...over,
  });
}

const rowOf = async (itemId: number) =>
  (
    await testApp.db
      .select()
      .from(schema.wowItemMeta)
      .where(eq(schema.wowItemMeta.itemId, itemId))
  )[0];

async function seedBoss(
  loot: ReadonlyArray<{ itemId: number; expansion: string }>,
): Promise<number> {
  const [boss] = nonEmpty(
    await testApp.db
      .insert(schema.wowClassicBosses)
      .values({
        instanceId: 900,
        name: 'Tooltip Boss',
        order: 1,
        expansion: 'classic',
        sodModified: false,
      })
      .returning(),
    'boss',
  );
  for (const l of loot) {
    await testApp.db.insert(schema.wowClassicBossLoot).values({
      bossId: boss.id,
      itemId: l.itemId,
      itemName: `Loot ${l.itemId}`,
      quality: 'Epic',
      expansion: l.expansion,
    });
  }
  return boss.id;
}

type LootRow = { itemId: number; tooltip: ItemTooltip | null };
async function getLoot(
  bossId: number,
  variant = 'classic_era',
): Promise<LootRow[]> {
  const res = await testApp.request.get(
    `/plugins/wow-classic/bosses/${bossId}/loot?variant=${variant}`,
  );
  expect(res.status).toBe(200);
  return res.body as LootRow[];
}

async function ensureGame(slug: string): Promise<number> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug })
      .returning(),
    slug,
  );
  return game.id;
}

async function activateBlizzard(): Promise<void> {
  await testApp.db
    .insert(schema.plugins)
    .values({
      slug: 'blizzard',
      name: 'blizzard',
      version: '0.0.0',
      active: true,
    })
    .onConflictDoUpdate({
      target: schema.plugins.slug,
      set: { active: true, updatedAt: new Date() },
    });
  await testApp.app.get(PluginRegistryService).onModuleInit();
}

const armoryGear = (ids: readonly number[]): CharacterEquipmentDto => ({
  equippedItemLevel: 66,
  syncedAt: '2026-11-01T00:00:00.000Z',
  items: ids.map((itemId, i) => ({
    slot: ['LEGS', 'FINGER_1', 'MAIN_HAND'][i] ?? 'HEAD',
    name: `Gear ${itemId}`,
    itemId,
    quality: 'EPIC',
    itemLevel: 66,
    itemSubclass: null,
  })),
});

async function seedCharacter(opts: {
  slug: string;
  gameVariant: string;
  equipment: CharacterEquipmentDto | null;
}): Promise<string> {
  const gameId = await ensureGame(opts.slug);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId,
        name: 'Tooltip Tester',
        region: 'us',
        gameVariant: opts.gameVariant,
        equipment: opts.equipment,
      })
      .returning(),
    'character',
  );
  return row.id;
}

type GearItem = { itemId: number; tooltip?: ItemTooltip };
async function getGear(
  id: string,
): Promise<CharacterEquipmentDto & { items: GearItem[] }> {
  const res = await testApp.request.get(`/characters/${id}`);
  expect(res.status).toBe(200);
  return res.body.equipment as CharacterEquipmentDto & { items: GearItem[] };
}

const gearItem = (gear: { items: GearItem[] }, itemId: number): GearItem =>
  defined(
    gear.items.find((i) => i.itemId === itemId),
    `gear item ${itemId}`,
  );

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(WowItemMetaService);
  bosses = testApp.app.get(BossEncountersService);
});

beforeEach(async () => {
  await activateBlizzard();
  await bosses.clearCache();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  await bosses.clearCache();
});

describe('wow_item_meta tooltip storage (ROK-2176)', () => {
  it('the migration added tooltip jsonb + tooltip_version smallint', async () => {
    const cols = await testApp.db.execute<{
      column_name: string;
      data_type: string;
    }>(
      sql`SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'wow_item_meta'
            AND column_name IN ('tooltip', 'tooltip_version')
          ORDER BY column_name`,
    );
    expect(Array.from(cols)).toEqual([
      { column_name: 'tooltip', data_type: 'jsonb' },
      { column_name: 'tooltip_version', data_type: 'smallint' },
    ]);
  });

  it('enqueue parses the fixture tooltip and stores it with the current parser version', async () => {
    const spy = stubWowhead();
    await expect(service.enqueue([234819, 17182])).resolves.toBe(2);
    // 234819: env 16 hit. 17182: env 16 miss, then env 4 hit.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await rowOf(234819)).toMatchObject({
      status: 'resolved',
      tooltipVersion: WOWHEAD_TOOLTIP_PARSE_VERSION,
      tooltip: { env: 16, armor: 133, unique: true },
    });
    const mace = await rowOf(17182);
    expect(mace).toMatchObject({
      status: 'classic_fallback',
      tooltipVersion: WOWHEAD_TOOLTIP_PARSE_VERSION,
      tooltip: {
        env: 4,
        slotLabel: 'Two-Hand',
        subclass: 'Mace',
        weapon: expect.objectContaining({ damageMin: 223, damageMax: 372 }),
      },
    });
    expect(mace?.tooltip?.stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'STRENGTH', value: 12 }),
      ]),
    );
  });
});

describe('boss-loot tooltip backfill (ROK-2176 §4.4)', () => {
  it('picks only classic/sod/forever ids that are missing or parsed by an older parser, within the limit', async () => {
    await seedBoss([
      { itemId: 30001, expansion: 'classic' }, // no row → due
      { itemId: 30002, expansion: 'sod' }, // resolved, never parsed → due
      { itemId: 30003, expansion: 'forever' }, // fresh, current version → skip
      { itemId: 30004, expansion: 'tbc' }, // Wowhead env 16/4 cannot serve it → skip
      { itemId: 30005, expansion: 'classic' }, // not_found → backoff owns it
      { itemId: 30006, expansion: 'classic' }, // error → backoff owns it
      { itemId: 30007, expansion: 'classic' }, // classic_fallback, older parser → due
    ]);
    await seedMeta(30002, { tooltip: null, tooltipVersion: null });
    await seedMeta(30003);
    await seedMeta(30005, {
      status: 'not_found',
      env: null,
      tooltip: null,
      tooltipVersion: null,
    });
    await seedMeta(30006, {
      status: 'error',
      env: null,
      tooltip: null,
      tooltipVersion: null,
    });
    await seedMeta(30007, {
      status: 'classic_fallback',
      env: 4,
      tooltipVersion: 0,
    });

    const all = await bossLootBackfillIds(testApp.db, 100);
    expect([...all].sort()).toEqual([30001, 30002, 30007]);
    const two = await bossLootBackfillIds(testApp.db, 2);
    expect(two).toHaveLength(2);
    expect([30001, 30002, 30007]).toEqual(expect.arrayContaining(two));
    await expect(bossLootBackfillIds(testApp.db, 0)).resolves.toEqual([]);
  });

  it('backfillBossLoot stores the tooltip and clears the loot cache only when it wrote', async () => {
    const bossId = await seedBoss([{ itemId: 17182, expansion: 'classic' }]);
    expect((await getLoot(bossId))[0]?.tooltip).toBeNull(); // now cached
    const spy = stubWowhead();
    const clear = jest.spyOn(bosses, 'clearCache');

    await expect(service.backfillBossLoot()).resolves.toBe(1);
    expect(clear).toHaveBeenCalledTimes(1);
    const [loot] = await getLoot(bossId);
    expect(loot?.tooltip).toMatchObject({
      slotLabel: 'Two-Hand',
      subclass: 'Mace',
    });

    spy.mockClear();
    await expect(service.backfillBossLoot()).resolves.toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('kill switch off → backfill and a character read with a due id never fetch', async () => {
    await testApp.app
      .get(SettingsService)
      .set(SETTING_KEYS.WOWHEAD_RESOLVER_ENABLED, 'false');
    await seedBoss([{ itemId: 17182, expansion: 'classic' }]);
    const spy = stubWowhead();
    const enqueue = jest.spyOn(service, 'enqueue');

    await expect(service.backfillBossLoot()).resolves.toBe(0);
    const id = await seedCharacter({
      slug: CLASSIC_SLUG,
      gameVariant: 'classic_era',
      equipment: armoryGear([18821]),
    });
    await getGear(id);
    await waitFor(() => {
      expect(enqueue).toHaveBeenCalledWith([18821]);
      return Promise.resolve();
    });
    await expect(enqueue.mock.results[0]?.value).resolves.toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(await testApp.db.select().from(schema.wowItemMeta)).toEqual([]);
  });
});

describe('tooltip exposure on reads (ROK-2176 §4.5, AC 2/3)', () => {
  it('boss loot carries the stored tooltip, null without a row, one row per loot item, and never fetches', async () => {
    const spy = stubWowhead();
    const bossId = await seedBoss([
      { itemId: 40001, expansion: 'classic' },
      { itemId: 40002, expansion: 'classic' },
    ]);
    await seedMeta(40001);

    const loot = await getLoot(bossId);
    expect(loot).toHaveLength(2);
    const byId = new Map(loot.map((l) => [l.itemId, l.tooltip]));
    expect(byId.get(40001)).toEqual(TOOLTIP);
    expect(byId.get(40002)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('wow_forever loot keeps the Forever-only preference with the join', async () => {
    const bossId = await seedBoss([
      { itemId: 40011, expansion: 'classic' },
      { itemId: 40012, expansion: 'forever' },
    ]);
    await seedMeta(40011);
    await seedMeta(40012);
    const loot = await getLoot(bossId, 'wow_forever');
    expect(loot.map((l) => [l.itemId, l.tooltip])).toEqual([[40012, TOOLTIP]]);
  });

  it('an Armory character gets tooltips on fresh items, stores none, and makes zero Wowhead calls', async () => {
    const spy = stubWowhead();
    const enqueue = jest.spyOn(service, 'enqueue');
    await seedMeta(50001);
    await seedMeta(50002, { tooltip: null }); // found, no parsed stats
    const stored = armoryGear([50001, 50002]);
    const id = await seedCharacter({
      slug: CLASSIC_SLUG,
      gameVariant: 'classic_era',
      equipment: stored,
    });

    const gear = await getGear(id);
    expect(gearItem(gear, 50001).tooltip).toEqual(TOOLTIP);
    expect(gearItem(gear, 50002)).not.toHaveProperty('tooltip');
    expect(enqueue).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    const [row] = await testApp.db
      .select({ equipment: schema.characters.equipment })
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(row?.equipment).toEqual(stored);
  });

  it('an equipped id with no row is resolved in the background after the read', async () => {
    const spy = stubWowhead();
    const id = await seedCharacter({
      slug: CLASSIC_SLUG,
      gameVariant: 'classic_era',
      equipment: armoryGear([18821]),
    });
    expect(gearItem(await getGear(id), 18821)).not.toHaveProperty('tooltip');
    await waitFor(async () => {
      expect(await rowOf(18821)).toMatchObject({
        status: 'classic_fallback',
        tooltip: { slotLabel: 'Finger' },
      });
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(gearItem(await getGear(id), 18821).tooltip).toMatchObject({
      slotLabel: 'Finger',
    });
  });

  it('a Forever addon character (no Armory gear) exposes tooltips on its LedgerLink gear', async () => {
    const spy = stubWowhead();
    await seedMeta(19019);
    const id = await seedCharacter({
      slug: FOREVER_SLUG,
      gameVariant: 'wow_forever',
      equipment: null,
    });
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId: id,
      section: 'char',
      schema: 1,
      data: {
        gear: [{ slot: 16, itemId: 19019, ilvl: 80, bonusIds: [] }],
        talents: { configId: 7, nodes: [{ nodeId: 101, rank: 2 }] },
        lockouts: [],
      },
      capturedAt: new Date('2026-11-01T00:00:00.000Z'),
      payloadSha256: 'b'.repeat(64),
    });

    const gear = await getGear(id);
    expect(gear.source).toBe('addon');
    expect(gearItem(gear, 19019).tooltip).toEqual(TOOLTIP);
    expect(spy).not.toHaveBeenCalled();
  });
});
