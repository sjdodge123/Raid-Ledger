/**
 * ROK-2014 L3 — the Materials trend on GET …/servers/:serverId/materials
 * against a real database. History comes from the DEMO_MODE containers seed
 * with `trendDays: 3` (L2): headers 2026-10-11/14/16/17 → three deltas.
 * Shared stationary Wood +20/+15/+10 (+45), Stone −10 on 10-17, BlackMetal
 * +60 on 10-14; a cart adds Wood +40 on 10-16 (+85 with vehicles); the
 * owner's private chest Coins +100 on 10-16. One base holds every chest.
 */
import {
  ValheimMaterialsResponseSchema,
  type ValheimMaterialStack,
  type ValheimMaterialsTrend,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import type { ContainersFixtureResponse } from '../valheim-armory-containers-demo-seed.controller';
import type { MaterialsViewer } from './valheim-materials.privacy';
import {
  selectTrendDays,
  selectTrendItemSums,
} from './valheim-materials-trend.queries';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/armory/seed-containers';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const sign = (sub: number, impersonatedBy?: number) =>
  signTestAccessToken(testApp, {
    sub,
    username: `u${sub}`,
    role: 'member',
    ...(impersonatedBy === undefined ? {} : { impersonatedBy }),
  });

async function seed(trendDays: 0 | 3): Promise<ContainersFixtureResponse> {
  const res = await testApp.request
    .post(ROUTE)
    .set(bearer(adminToken))
    .send({ trendDays });
  expect(res.status).toBe(200);
  return res.body as ContainersFixtureResponse;
}

async function materials(serverId: number, token: string, q = '') {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/servers/${serverId}/materials${q}`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return ValheimMaterialsResponseSchema.parse(res.body);
}

const NO_VEHICLES = '?includeVehicles=false';
const woodByDay = (t: ValheimMaterialsTrend | undefined) =>
  t?.days.map((d) => d.gains['Wood'] ?? 0);

/** D12: every gain key is a prefab of the row set it sits beside. */
function expectKeysShown(
  t: ValheimMaterialsTrend | undefined,
  totals: ValheimMaterialStack[],
): void {
  const shown = new Set(totals.map((s) => s.prefab));
  const keys = t?.days.flatMap((d) => Object.keys(d.gains)) ?? [];
  expect(keys.filter((k) => !shown.has(k))).toEqual([]);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
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

describe('Materials trend (ROK-2014)', () => {
  it('shared + base trend: daily deltas over 3 days, vehicles off', async () => {
    const f = await seed(3);
    const m = await materials(
      f.serverId,
      await sign(f.memberUserId),
      NO_VEHICLES,
    );
    expect(m.shared.trend).toEqual({
      days: [
        { date: '2026-10-17', gains: { Wood: 20, Stone: -10 } },
        { date: '2026-10-16', gains: { Wood: 15 } },
        { date: '2026-10-14', gains: { Wood: 10, BlackMetal: 60 } },
      ],
    });
    const [base] = nonEmpty(m.bases ?? [], 'one base');
    expect(base.trend).toEqual(m.shared.trend);
    expectKeysShown(m.shared.trend, m.shared.totals);
    expectKeysShown(base.trend, base.totals);
    expect(m.personal).toBeNull();
  });

  it('includeVehicles adds the cart: Wood +85 instead of +45', async () => {
    const f = await seed(3);
    const token = await sign(f.memberUserId);
    const off = await materials(f.serverId, token, NO_VEHICLES);
    const on = await materials(f.serverId, token);
    expect(woodByDay(off.shared.trend)).toEqual([20, 15, 10]);
    expect(woodByDay(on.shared.trend)).toEqual([20, 55, 10]);
    expect(woodByDay(on.bases?.[0]?.trend)).toEqual([20, 55, 10]);
  });

  it('personal trend: the owner and an admin see Coins +100, never on shared', async () => {
    const f = await seed(3);
    const expected = {
      days: [
        { date: '2026-10-17', gains: {} },
        { date: '2026-10-16', gains: { Coins: 100 } },
        { date: '2026-10-14', gains: {} },
      ],
    };
    for (const token of [await sign(f.ownerUserId), adminToken]) {
      const m = await materials(f.serverId, token);
      expect(m.personal?.trend).toEqual(expected);
      const near = m.personal?.byBase?.find((b) => b.base !== null);
      expect(near?.trend).toEqual(expected);
      expect(m.shared.trend?.days[1]?.gains).not.toHaveProperty('Coins');
    }
    const imp = await materials(
      f.serverId,
      await sign(f.ownerUserId, testApp.seed.adminUser.id),
    );
    expect(imp.personal).toBeNull();
  });
});

describe('Materials trend — privacy and empty history (ROK-2014)', () => {
  it('snapshot rows follow the claim rule (D13): member and impersonated read no personal rows', async () => {
    const f = await seed(3);
    const { worldUid } = await materials(f.serverId, adminToken);
    if (worldUid === null) throw new Error('seed wrote no scan');
    const days = await selectTrendDays(testApp.db, f.serverId, worldUid, 4);
    expect(days.map((d) => d.playDate)).toEqual([
      '2026-10-17',
      '2026-10-16',
      '2026-10-14',
      '2026-10-11',
    ]);
    const ids = days.map((d) => d.id);
    const personalOf = async (viewer: MaterialsViewer) =>
      (await selectTrendItemSums(testApp.db, ids, viewer, true))
        .filter((r) => !r.shared)
        .map((r) => r.prefab);
    const v = (id: number, over: Partial<MaterialsViewer> = {}) => ({
      id,
      isAdmin: false,
      impersonated: false,
      ...over,
    });
    expect(await personalOf(v(f.memberUserId))).toEqual([]);
    expect(await personalOf(v(f.ownerUserId, { impersonated: true }))).toEqual(
      [],
    );
    expect(new Set(await personalOf(v(f.ownerUserId)))).toEqual(
      new Set(['Coins']),
    );
    expect(
      (await personalOf(v(f.adminUserId, { isAdmin: true }))).length,
    ).toBeGreaterThan(0);
  });

  it('no history (one play day) → no trend field anywhere (AC3)', async () => {
    const f = await seed(0);
    for (const token of [adminToken, await sign(f.ownerUserId)]) {
      const m = await materials(f.serverId, token);
      expect(m.shared).not.toHaveProperty('trend');
      expect(m.personal).not.toHaveProperty('trend');
      for (const b of m.bases ?? []) expect(b).not.toHaveProperty('trend');
      for (const b of m.personal?.byBase ?? []) {
        expect(b).not.toHaveProperty('trend');
      }
    }
  });
});
