/**
 * ROK-1933 — POST /admin/test/valheim/claim-drive-cleanup (integration, real
 * DB). Removes what `claim-drive-fixture` made for ONE worker: its fixture
 * users (every call's A and B), the characters on its server and its
 * sighting Quick Play. Other workers' fixtures and real users stay. A smoke
 * calls it in `finally` because `reset-to-seed` keeps users, and a leftover
 * fixture user (synthetic Discord id) was picked up by the next smoke group.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import type { ClaimDriveFixture } from './valheim-claim-drive-demo-seed.helpers';
import type { ClaimDriveCleanup } from './valheim-claim-drive-demo-cleanup.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const SEED = '/admin/test/valheim/claim-drive-fixture';
const CLEANUP = '/admin/test/valheim/claim-drive-cleanup';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const registry = () => testApp.app.get(PluginRegistryService);

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

async function post<T>(path: string, body: object, status = 200): Promise<T> {
  const res = await testApp.request
    .post(path)
    .set(bearer(adminToken))
    .send(body);
  expect(res.status).toBe(status);
  return res.body as T;
}

const userIdsOf = (f: ClaimDriveFixture): number[] => [
  f.users.a.id,
  f.users.b.id,
];

async function existingUserIds(ids: number[]): Promise<number[]> {
  const U = schema.users;
  const rows = await testApp.db
    .select({ id: U.id })
    .from(U)
    .where(inArray(U.id, ids))
    .orderBy(U.id);
  return rows.map((r) => r.id);
}

async function profileCount(serverId: number): Promise<number> {
  const P = schema.valheimProfiles;
  const rows = await testApp.db
    .select({ id: P.id })
    .from(P)
    .where(eq(P.pelicanServerId, serverId));
  return rows.length;
}

beforeAll(async () => {
  process.env.VALHEIM_LINK_BLOB_DIR = await mkdtemp(
    join(tmpdir(), 'vh-claim-cleanup-'),
  );
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await setDemoMode(true);
  await testApp.db
    .insert(schema.games)
    .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG });
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
});

afterAll(() => {
  delete process.env.VALHEIM_LINK_BLOB_DIR;
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/valheim/claim-drive-cleanup (ROK-1933)', () => {
  it("deletes one worker's fixture users, characters and sighting only", async () => {
    const first = await post<ClaimDriveFixture>(SEED, { worker: 4 });
    const second = await post<ClaimDriveFixture>(SEED, {
      worker: 4,
      sighting: true,
    });
    const other = await post<ClaimDriveFixture>(SEED, { worker: 5 });
    const mine = [...userIdsOf(first), ...userIdsOf(second)];

    const res = await post<ClaimDriveCleanup>(CLEANUP, { worker: 4 });

    expect([...res.deletedUserIds].sort((x, y) => x - y)).toEqual(
      [...mine].sort((x, y) => x - y),
    );
    expect(await existingUserIds(mine)).toEqual([]);
    expect(await profileCount(second.serverId)).toBe(0);
    const E = schema.events;
    const live = await testApp.db
      .select({ id: E.id })
      .from(E)
      .where(eq(E.id, second.eventId ?? -1));
    expect(live).toEqual([]);
    expect(await existingUserIds(userIdsOf(other))).toEqual(
      userIdsOf(other).sort((x, y) => x - y),
    );
    expect(await profileCount(other.serverId)).toBe(3);
    expect(await existingUserIds([testApp.seed.adminUser.id])).toEqual([
      testApp.seed.adminUser.id,
    ]);
  });

  it('is a no-op for a worker that was never seeded', async () => {
    const res = await post<ClaimDriveCleanup>(CLEANUP, { worker: 6 });
    expect(res).toEqual({ deletedUserIds: [] });
  });

  it('400s a bad worker and 403s without DEMO_MODE', async () => {
    await post(CLEANUP, { worker: -1 }, 400);
    await setDemoMode(false);
    await post(CLEANUP, { worker: 4 }, 403);
  });
});
