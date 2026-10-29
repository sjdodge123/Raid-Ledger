/**
 * ROK-1854 L5 — POST /admin/test/valheim/recipes-fixture (integration, real
 * DB). The planner fixture rides on the containers seed, then imports the
 * vanilla + Bronze recipe set, the catalogue names and a 40-Copper chest
 * through the real importers. Idempotent; 403 without DEMO_MODE; admin-only.
 */
import {
  ValheimRecipeCatalogResponseSchema,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeStockResponseSchema,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { RECIPES_VANILLA } from './valheim-armory-recipes-demo-fixture';
import type { RecipesFixtureResponse } from './valheim-armory-recipes-demo-seed.controller';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/recipes-fixture';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const sign = (sub: number) =>
  signTestAccessToken(testApp, { sub, username: `u${sub}`, role: 'member' });
const post = (token: string, body: object = {}) =>
  testApp.request.post(ROUTE).set(bearer(token)).send(body);

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

async function seed(body: object = {}): Promise<RecipesFixtureResponse> {
  const res = await post(adminToken, body);
  expect(res.status).toBe(200);
  return res.body as RecipesFixtureResponse;
}

const recipesUrl = (serverId: number, rest = '') =>
  `/plugins/valheim/armory/servers/${serverId}/recipes${rest}`;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await setDemoMode(true);
  nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'valheim game',
  );
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('recipes demo fixture copy', () => {
  it('inlines the golden recipes-vanilla fixture verbatim', () => {
    expect(RECIPES_VANILLA).toEqual(loadValheimFixture('recipes-vanilla'));
  });
});

describe('POST /admin/test/valheim/recipes-fixture (ROK-1854 L5)', () => {
  it('seeds a catalogue listing Bronze and a plan with Copper covered, Tin short', async () => {
    const f = await seed();
    expect(f.guildId).toBe(f.hubId);
    expect(f.guildPageUrl).toBe(`/hubs/${f.hubId}#planner`);
    const member = bearer(await sign(f.memberUserId));
    const cat = await testApp.request.get(recipesUrl(f.serverId)).set(member);
    expect(cat.status).toBe(200);
    const names = ValheimRecipeCatalogResponseSchema.parse(cat.body).entries;
    expect(names.map((e) => e.name)).toEqual(
      expect.arrayContaining(['Bronze', 'Bronze sword', 'Copper', 'Tin']),
    );
    const plan = await testApp.request
      .get(recipesUrl(f.serverId, '/plan?targets=Bronze:1:1'))
      .set(member);
    expect(plan.status).toBe(200);
    const nodes = ValheimRecipePlanResponseSchema.parse(plan.body).nodes;
    const node = (p: string) => nodes.find((n) => n.prefab === p);
    expect(node('Copper')).toMatchObject({ quantity: 2, have: 40, short: 0 });
    expect(node('Tin')).toMatchObject({ quantity: 1, have: 0, short: 1 });
  });

  it('ROK-1899: the crafting window gets affordable, short and upgradable rows', async () => {
    const f = await seed();
    const member = bearer(await sign(f.memberUserId));
    const cat = await testApp.request.get(recipesUrl(f.serverId)).set(member);
    const st = await testApp.request
      .get(recipesUrl(f.serverId, '/stock'))
      .set(member);
    expect({ cat: cat.status, stock: st.status }).toEqual({
      cat: 200,
      stock: 200,
    });
    const { entries } = ValheimRecipeCatalogResponseSchema.parse(cat.body);
    const { stock, totals } = ValheimRecipeStockResponseSchema.parse(st.body);
    const entry = (p: string) =>
      entries.find((e) => e.prefab === p && e.kind === 'item');
    const covered = (p: string) =>
      (entry(p)?.craft?.resources ?? []).map(
        (r) => (totals[r.prefab] ?? 0) >= r.amount,
      );
    expect(stock).toBe('scan');
    expect(covered('Club')).toEqual([true]);
    expect(covered('Bronze')).toEqual([true, false]);
    expect(
      entry('Club')?.upgrades.map((u) => [u.quality, u.resources]),
    ).toEqual([
      [2, [{ prefab: 'Wood', amount: 3 }]],
      [3, [{ prefab: 'Wood', amount: 6 }]],
    ]);
    expect(entry('SwordBronze')?.upgrades.map((u) => u.quality)).toEqual([
      2, 3, 4,
    ]);
  });

  it('is idempotent: a re-run returns the same body, one set, one scan', async () => {
    const first = await seed();
    expect(await seed()).toEqual(first);
    const sets = await testApp.db.select().from(schema.valheimRecipeSets);
    expect(sets).toHaveLength(1);
    const scans = await testApp.db.select().from(schema.valheimContainerScans);
    expect(scans).toHaveLength(1);
    const chests = await testApp.db.select().from(schema.valheimContainers);
    expect(chests).toHaveLength(first.counts.containers);
  });

  it('403s for a non-admin and without DEMO_MODE', async () => {
    const f = await seed();
    expect((await post(await sign(f.memberUserId))).status).toBe(403);
    await setDemoMode(false);
    expect((await post(adminToken)).status).toBe(403);
  });
});

describe('recipes-fixture discovery (ROK-1862)', () => {
  it('ROK-1862: the owner knows every recipe but Bronze sword; the member has no character', async () => {
    const f = await seed();
    const read = async (userId: number) => {
      const res = await testApp.request
        .get(recipesUrl(f.serverId))
        .set(bearer(await sign(userId)));
      expect(res.status).toBe(200);
      const cat = ValheimRecipeCatalogResponseSchema.parse(res.body);
      const flag = (p: string) =>
        cat.entries.find((e) => e.prefab === p && e.kind === 'item')
          ?.discovered;
      return {
        discovery: cat.discovery,
        SwordBronze: flag('SwordBronze'),
        Club: flag('Club'),
        Bronze: flag('Bronze'),
      };
    };
    expect(await read(f.ownerUserId)).toEqual({
      discovery: 'known',
      SwordBronze: false,
      Club: true,
      Bronze: true,
    });
    expect(await read(f.memberUserId)).toEqual({
      discovery: 'no-character',
      SwordBronze: null,
      Club: null,
      Bronze: null,
    });
  });
});

/** The member's catalogue, reduced to what spoiler protection decides. */
async function catalogueOf(f: RecipesFixtureResponse, userId: number) {
  const res = await testApp.request
    .get(recipesUrl(f.serverId))
    .set(bearer(await sign(userId)));
  expect(res.status).toBe(200);
  const cat = ValheimRecipeCatalogResponseSchema.parse(res.body);
  return {
    spoilers: cat.spoilers,
    items: cat.entries
      .filter((e) => e.kind === 'item')
      .map((e) => e.prefab)
      .sort(),
    stations: cat.stations.map((s) => s.prefab).sort(),
    json: JSON.stringify(res.body),
  };
}

const ALL_ITEMS = [
  'Bronze',
  'Club',
  'Coal',
  'CookedMeat',
  'Copper',
  'Cultivator',
  'Iron',
  'SwordBronze',
  'SwordIron',
  'Tin',
];

describe('recipes-fixture spoiler presets (ROK-1948)', () => {
  it('default: the unclaimed scout knows everything, so nothing is hidden', async () => {
    const f = await seed();
    for (const userId of [f.memberUserId, f.ownerUserId]) {
      const cat = await catalogueOf(f, userId);
      expect({ ...cat, json: undefined }).toEqual({
        spoilers: 'protected',
        items: ALL_ITEMS,
        stations: ['forge', 'piece_workbench'],
        json: undefined,
      });
    }
  });

  it("'early': Workbench + Club + Cultivator only, for every viewer", async () => {
    const f = await seed({ spoilers: 'early' });
    for (const userId of [f.memberUserId, f.ownerUserId]) {
      const cat = await catalogueOf(f, userId);
      expect([cat.spoilers, cat.items, cat.stations]).toEqual([
        'protected',
        ['Club', 'Cultivator'],
        ['piece_workbench'],
      ]);
      // R7: Cultivator's own ingredient 'Bronze' stays named; nothing else.
      for (const hidden of [
        'SwordBronze',
        'Bronze sword',
        'forge',
        'Forge',
        'smelter',
        'Tin',
      ]) {
        expect(cat.json).not.toContain(hidden);
      }
    }
  });

  it("'early': a Cultivator plan meets Bronze as an undiscovered leaf", async () => {
    const f = await seed({ spoilers: 'early' });
    const res = await testApp.request
      .get(recipesUrl(f.serverId, '/plan?targets=Cultivator:1:1'))
      .set(bearer(await sign(f.memberUserId)));
    expect(res.status).toBe(200);
    const plan = ValheimRecipePlanResponseSchema.parse(res.body);
    expect(plan.spoilers).toBe('protected');
    const bronze = plan.nodes.find((n) => n.prefab === 'Bronze');
    expect(bronze).toMatchObject({
      via: { type: 'undiscovered' },
      alternatives: 0,
    });
    expect(plan.nodes.map((n) => n.prefab).sort()).toEqual([
      'Bronze',
      'Cultivator',
      'Wood',
    ]);
  });

  it("'none': every list is empty, so protection is off and all is listed", async () => {
    const f = await seed({ spoilers: 'none' });
    const cat = await catalogueOf(f, f.memberUserId);
    expect([cat.spoilers, cat.items, cat.stations]).toEqual([
      'off-no-data',
      ALL_ITEMS,
      ['forge', 'piece_workbench'],
    ]);
  });

  it('a re-POST with another preset takes effect at once (cache key moves)', async () => {
    const f = await seed({ spoilers: 'early' });
    expect((await catalogueOf(f, f.memberUserId)).items).toEqual([
      'Club',
      'Cultivator',
    ]);
    await seed();
    expect((await catalogueOf(f, f.memberUserId)).items).toEqual(ALL_ITEMS);
  });

  it('400s on an unknown preset', async () => {
    const res = await post(adminToken, { spoilers: 'some' });
    expect(res.status).toBe(400);
  });
});
