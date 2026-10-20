/**
 * ROK-1853 L5 — POST /admin/test/valheim/armory/seed-containers (integration,
 * real DB). The DEMO_MODE fixture imports both golden containers fixtures
 * through the real importer onto the worker's hub server and claims the
 * private chest's builder for the owner: the owner gets a 1-chest personal
 * section, the member none, the admin `omittedPrivate`. Idempotent; 403
 * without DEMO_MODE; admin-only.
 */
import { JwtService } from '@nestjs/jwt';
import { ValheimMaterialsResponseSchema } from '@raid-ledger/contract';
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
import {
  CONTAINERS_BASIC,
  CONTAINERS_PRIVATE,
} from './valheim-armory-containers-demo-fixture';
import type { ContainersFixtureResponse } from './valheim-armory-containers-demo-seed.controller';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/armory/seed-containers';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const sign = (sub: number) =>
  testApp.app
    .get(JwtService)
    .sign({ sub, username: `u${sub}`, role: 'member' });

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

async function seed(body: object = {}): Promise<ContainersFixtureResponse> {
  const res = await testApp.request
    .post(ROUTE)
    .set(bearer(adminToken))
    .send(body);
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

const woodTotal = (stacks: { prefab: string; total: number }[]) =>
  stacks.filter((s) => s.prefab === 'Wood').reduce((n, s) => n + s.total, 0);

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

describe('containers demo fixture copy', () => {
  it('matches the golden containers-basic / containers-private fixtures', () => {
    expect(CONTAINERS_BASIC).toEqual(
      loadValheimFixture('containers-basic').containers,
    );
    expect(CONTAINERS_PRIVATE).toEqual(
      loadValheimFixture('containers-private').containers,
    );
  });
});

describe('POST /admin/test/valheim/armory/seed-containers (ROK-1853 L5)', () => {
  it('seeds the hub, both fixtures and a per-viewer personal section', async () => {
    const f = await seed();
    expect(f.guildPageUrl).toBe(`/guilds/${f.hubId}#materials`);
    expect(f.adminUserId).toBe(testApp.seed.adminUser.id);
    expect(new Set([f.memberUserId, f.ownerUserId, f.adminUserId]).size).toBe(
      3,
    );
    const hub = await testApp.request
      .get(`/guilds/${f.hubId}`)
      .set(bearer(sign(f.memberUserId)));
    expect(hub.status).toBe(200);

    const member = await materials(f.serverId, sign(f.memberUserId));
    expect(member.personal).toBeNull();
    expect(woodTotal(member.shared.totals)).toBe(156);
    const noCarts = await materials(
      f.serverId,
      sign(f.memberUserId),
      '?includeVehicles=false',
    );
    expect(woodTotal(noCarts.shared.totals)).toBe(57);

    const owner = await materials(f.serverId, sign(f.ownerUserId));
    expect(owner.personal?.chestCount).toBe(1);
    expect(owner.personal?.omittedPrivate).toBeNull();
    expect(owner.personal?.totals).toEqual([
      expect.objectContaining({ prefab: 'Coins', total: 999 }),
    ]);

    const admin = await materials(f.serverId, adminToken);
    expect(admin.personal?.omittedPrivate).toBe(1);
  });

  it('serves both returned chest keys through the detail route', async () => {
    const f = await seed();
    const detail = (key: string, token: string) =>
      testApp.request
        .get(`/plugins/valheim/armory/servers/${f.serverId}/containers/${key}`)
        .set(bearer(token));
    const shared = await detail(f.sharedChestKey, sign(f.memberUserId));
    expect(shared.status).toBe(200);
    expect((await detail(f.privateChestKey, sign(f.ownerUserId))).status).toBe(
      200,
    );
    expect((await detail(f.privateChestKey, sign(f.memberUserId))).status).toBe(
      404,
    );
  });

  it('is idempotent: a re-run returns the same ids and keys, one scan', async () => {
    const first = await seed();
    const again = await seed();
    expect(again).toEqual(first);
    const scans = await testApp.db
      .select({ id: schema.valheimContainerScans.id })
      .from(schema.valheimContainerScans);
    expect(scans).toHaveLength(1);
    const rows = await testApp.db
      .select({ id: schema.valheimContainers.id })
      .from(schema.valheimContainers);
    expect(rows).toHaveLength(7);
  });

  it('400s on a bad body', async () => {
    for (const body of [{ worker: 99 }, { worker: 'a' }, { extra: 1 }]) {
      const res = await testApp.request
        .post(ROUTE)
        .set(bearer(adminToken))
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('403s for a non-admin and without DEMO_MODE', async () => {
    const f = await seed();
    const asMember = await testApp.request
      .post(ROUTE)
      .set(bearer(sign(f.memberUserId)))
      .send({});
    expect(asMember.status).toBe(403);
    await setDemoMode(false);
    const res = await testApp.request
      .post(ROUTE)
      .set(bearer(adminToken))
      .send({});
    expect(res.status).toBe(403);
  });
});
