/**
 * ROK-1854 L5 — POST /admin/test/valheim/recipes-fixture (integration, real
 * DB). The planner fixture rides on the containers seed, then imports the
 * vanilla + Bronze recipe set, the catalogue names and a 40-Copper chest
 * through the real importers. Idempotent; 403 without DEMO_MODE; admin-only.
 */
import { JwtService } from '@nestjs/jwt';
import {
  ValheimRecipeCatalogResponseSchema,
  ValheimRecipePlanResponseSchema,
} from '@raid-ledger/contract';
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
  testApp.app
    .get(JwtService)
    .sign({ sub, username: `u${sub}`, role: 'member' });
const post = (token: string) =>
  testApp.request.post(ROUTE).set(bearer(token)).send({});

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

async function seed(): Promise<RecipesFixtureResponse> {
  const res = await post(adminToken);
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
    expect(f.guildPageUrl).toBe(`/guilds/${f.hubId}#planner`);
    const member = bearer(sign(f.memberUserId));
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
    expect((await post(sign(f.memberUserId))).status).toBe(403);
    await setDemoMode(false);
    expect((await post(adminToken)).status).toBe(403);
  });
});
