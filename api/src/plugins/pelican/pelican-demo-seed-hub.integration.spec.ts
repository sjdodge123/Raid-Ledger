/**
 * ROK-1831 — POST /admin/test/pelican/server-hub (integration, real DB).
 * The DEMO_MODE fixture the server-hub smoke + fleet test plan seed: a
 * Valheim-mapped server with its hub on, the member cast, an outsider and one
 * past Quick Play session; idempotent per slot, and the four-row
 * `seed-servers` reset leaves it alone. (403 without DEMO_MODE is the shared
 * DemoModeGuard's own spec.)
 */
import { eq } from 'drizzle-orm';
import { GuildPageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import {
  serverHubUserName,
  type ServerHubFixture,
} from './pelican-demo-seed-hub.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/pelican/server-hub';

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);

async function prepare(): Promise<void> {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
  await testApp.db
    .insert(schema.games)
    .values({ name: 'Valheim', slug: 'valheim' })
    .onConflictDoNothing();
}

function post(path: string, body: object = {}) {
  return testApp.request
    .post(path)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

async function seed(slot = 2): Promise<ServerHubFixture> {
  const res = await post(ROUTE, { slot });
  expect(res.status).toBe(200);
  return res.body as ServerHubFixture;
}

/** Member names of the hub page, as staff sees it. */
async function memberNames(guildId: number): Promise<string[]> {
  const res = await testApp.request
    .get(`/guilds/${guildId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const page = GuildPageSchema.parse(res.body);
  return page.ranks.flatMap((g) => g.members.map((m) => m.name));
}

beforeAll(async () => {
  testApp = await getTestApp();
  await prepare();
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  await prepare();
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/pelican/server-hub (ROK-1831)', () => {
  it('seeds a visible Valheim hub with online, 10-day and joined members — not the 100-day one', async () => {
    const hub = await seed();
    const [guild] = await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.id, hub.guildId));
    expect(guild).toMatchObject({
      kind: 'game_server',
      pelicanServerId: hub.serverId,
      gameId: hub.gameId,
      hiddenAt: null,
    });
    const names = await memberNames(hub.guildId);
    expect(names).toEqual(
      expect.arrayContaining(
        (['online', 'recent', 'joined'] as const).map((r) =>
          serverHubUserName(2, r),
        ),
      ),
    );
    expect(names).not.toContain(serverHubUserName(2, 'lapsed'));
    expect(names).not.toContain(serverHubUserName(2, 'outsider'));
  });

  it('lists the seeded Quick Play session on the hub', async () => {
    const hub = await seed();
    const res = await testApp.request
      .get(`/plugins/pelican/hubs/${hub.guildId}/quick-play`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = res.body as { data: { eventId: number; status: string }[] };
    expect(body.data.map((i) => [i.eventId, i.status])).toEqual([
      [hub.eventId, 'ended'],
    ]);
  });

  it('is idempotent: a re-run returns the same objects and resets edits', async () => {
    const hub = await seed();
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hub.guildId));
    await testApp.db
      .delete(schema.hubServerMembers)
      .where(eq(schema.hubServerMembers.userId, hub.userIds.online));

    expect(await seed()).toEqual(hub);
    const [guild] = await testApp.db
      .select({ hiddenAt: schema.guilds.hiddenAt })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, hub.guildId));
    expect(guild?.hiddenAt).toBeNull();
    expect(await memberNames(hub.guildId)).toContain(
      serverHubUserName(2, 'online'),
    );
  });

  it('survives a seed-servers reset and keeps slots apart', async () => {
    const a = await seed(2);
    const b = await seed(3);
    expect(b.guildId).not.toBe(a.guildId);
    expect(b.userIds.outsider).not.toBe(a.userIds.outsider);
    const reset = await post('/admin/test/pelican/seed-servers');
    expect(reset.status).toBe(200);
    const servers = await testApp.db
      .select({ id: schema.pelicanServers.id })
      .from(schema.pelicanServers);
    expect(servers.map((s) => s.id)).toEqual(
      expect.arrayContaining([a.serverId, b.serverId]),
    );
  });

  it('rejects an unknown slot with 400', async () => {
    const results = await Promise.all(
      [{ slot: 99 }, { slot: -1 }, { slot: 1.5 }, { slot: 'x' }].map((b) =>
        post(ROUTE, b),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400]);
  });
});
