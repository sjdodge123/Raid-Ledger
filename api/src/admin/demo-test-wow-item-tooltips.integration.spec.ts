/**
 * ROK-2176 — POST /admin/test/wow/seed-item-tooltips (integration).
 *
 * The DEMO seam behind the boss-loot compare smoke + fleet plan: seeded
 * tooltips must surface through the REAL character detail read, the stored
 * gear must stay tooltip-free, and the route keeps the DEMO_MODE / admin gates.
 */
import { eq } from 'drizzle-orm';
import type { ItemTooltip } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { WOWHEAD_TOOLTIP_PARSE_VERSION } from '../plugins/wow-common/wowhead-item/wowhead-item.types';

const ROUTE = '/admin/test/wow/seed-item-tooltips';
const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

const MACE: ItemTooltip = {
  env: 4,
  slotLabel: 'Two-Hand',
  subclass: 'Mace',
  binding: 'Binds when picked up',
  unique: false,
  requiredLevel: 60,
  armor: null,
  weapon: { damageMin: 223, damageMax: 372, attackSpeed: 3.7, dps: 80.4 },
  stats: [{ key: 'STRENGTH', name: 'Strength', value: 12 }],
  effects: [],
  setName: null,
  randomEnchant: false,
};

let testApp: TestApp;
let adminToken: string;

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

const post = (body: unknown) =>
  testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body as object);

async function activateBlizzard(): Promise<void> {
  const registry = testApp.app.get(PluginRegistryService);
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
  await registry.onModuleInit();
}

async function seedCharacter(): Promise<string> {
  const slug = 'world-of-warcraft-classic';
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  const [game] = existing
    ? [existing]
    : nonEmpty(
        await testApp.db
          .insert(schema.games)
          .values({ name: slug, slug })
          .returning(),
        'game',
      );
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: game.id,
        name: 'Seeded Warrior',
        region: 'us',
        gameVariant: 'classic_era',
      })
      .returning(),
    'character',
  );
  return row.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await setDemoMode(true);
  await activateBlizzard();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

afterAll(() => {
  process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/wow/seed-item-tooltips (ROK-2176)', () => {
  it('seeds fresh meta rows + Armory gear that the character read decorates', async () => {
    const characterId = await seedCharacter();
    const res = await post({
      items: [
        { itemId: 17182, name: 'Sulfuras', tooltip: MACE },
        { itemId: 18821, tooltip: null },
      ],
      characterId,
      equipment: [
        {
          slot: 'MAIN_HAND',
          itemId: 17182,
          name: 'Sulfuras',
          quality: 'LEGENDARY',
          itemLevel: 80,
        },
        {
          slot: 'FINGER_1',
          itemId: 18821,
          name: 'Quick Strike Ring',
          quality: 'EPIC',
          itemLevel: 67,
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ itemIds: [17182, 18821], characterId });

    const meta = await testApp.db.select().from(schema.wowItemMeta);
    expect(
      meta.map((r) => [r.itemId, r.status, r.tooltipVersion]).sort(),
    ).toEqual([
      [17182, 'classic_fallback', WOWHEAD_TOOLTIP_PARSE_VERSION],
      [18821, 'resolved', WOWHEAD_TOOLTIP_PARSE_VERSION],
    ]);

    const detail = await testApp.request.get(`/characters/${characterId}`);
    expect(detail.status).toBe(200);
    const items = detail.body.equipment.items as Array<Record<string, unknown>>;
    const bySlot = new Map(items.map((i) => [i.slot, i]));
    expect(bySlot.get('MAIN_HAND')?.tooltip).toEqual(MACE);
    expect(bySlot.get('FINGER_1')).not.toHaveProperty('tooltip');

    const [stored] = await testApp.db
      .select({ equipment: schema.characters.equipment })
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId));
    expect(JSON.stringify(stored?.equipment)).not.toContain('tooltip');
  });

  it('a reseed overwrites the row in place (one row per item)', async () => {
    expect(
      (await post({ items: [{ itemId: 17182, tooltip: null }] })).status,
    ).toBe(200);
    expect(
      (await post({ items: [{ itemId: 17182, tooltip: MACE }] })).status,
    ).toBe(200);
    const rows = await testApp.db.select().from(schema.wowItemMeta);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tooltip).toEqual(MACE);
  });

  it('400 on a bad body, 404 on an unknown character, 403 outside DEMO_MODE', async () => {
    expect((await post({ items: [{ itemId: 1 }] })).status).toBe(400);
    const missing = await post({
      characterId: '7d3c8f8e-3d55-4b0b-9a1d-2a8f0b4c6e11',
      equipment: [
        { slot: 'LEGS', itemId: 1, name: 'x', quality: 'EPIC', itemLevel: 60 },
      ],
    });
    expect(missing.status).toBe(404);
    await setDemoMode(false);
    expect((await post({ items: [{ itemId: 1, tooltip: null }] })).status).toBe(
      403,
    );
    expect(await testApp.db.select().from(schema.wowItemMeta)).toEqual([]);
  });
});
