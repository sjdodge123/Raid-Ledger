/**
 * ROK-1832 — POST /admin/test/hub-member (integration, real DB).
 *
 * The kind-aware live-membership fixture: a `game_server` hub gets one manual
 * `hub_server_members` row, a WoW guild a linked character + live roster row
 * — each proven through the kind adapter's own `memberUserIds`.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { HubKindRegistry } from '../guilds/hub-kind.registry';
import { PELICAN_PLUGIN_ID } from '../plugins/pelican/pelican.constants';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

const ROUTE = '/admin/test/hub-member';
const SNAP = new Date('2026-10-12T20:00:00.000Z');
const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

let testApp: TestApp;
let adminToken: string;

function post(body: Record<string, unknown>) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

async function insertHub(
  name: string,
  kind: 'wow_guild' | 'game_server',
): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        kind,
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function insertUser(name: string): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}@hubmember.test`, username: name })
      .returning(),
    'user',
  );
  return u.id;
}

async function memberIds(guildId: number): Promise<number[]> {
  const adapter = await testApp.app.get(HubKindRegistry).forGuild(guildId);
  if (!adapter) throw new Error(`no adapter for guild ${guildId}`);
  return adapter.memberUserIds(guildId);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const plugins = testApp.app.get(PluginRegistryService);
  for (const slug of ['blizzard', PELICAN_PLUGIN_ID]) {
    await plugins.ensureInstalled(slug);
    await plugins.activate(slug);
  }
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// No DB write here: integration-setup.ts's global afterAll (closeTestApp)
// runs first and ends the DB client; its beforeAll truncates every file.
afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/hub-member', () => {
  it('game_server: one manual row, idempotent on repeat, counted as a member', async () => {
    const guildId = await insertHub('Hub Member Server', 'game_server');
    const userId = await insertUser('hubmember-server');
    const first = await post({ guildId, userId });
    const second = await post({ guildId, userId });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ guildId, userId, kind: 'game_server' });
    expect(second.status).toBe(200);
    const m = schema.hubServerMembers;
    const rows = await testApp.db
      .select()
      .from(m)
      .where(and(eq(m.guildId, guildId), eq(m.userId, userId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('manual');
    expect(await memberIds(guildId)).toContain(userId);
  });

  it('wow_guild: one live roster row, idempotent on repeat, counted as a member', async () => {
    const guildId = await insertHub('Hub Member Guild', 'wow_guild');
    const userId = await insertUser('hubmember-wow');
    const first = await post({ guildId, userId });
    await post({ guildId, userId });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ guildId, userId, kind: 'wow_guild' });
    const rows = await testApp.db
      .select()
      .from(schema.guildMembers)
      .where(eq(schema.guildMembers.guildId, guildId));
    expect(rows).toHaveLength(1);
    expect(await memberIds(guildId)).toEqual([userId]);
  });

  it('404 for an unknown guild', async () => {
    const userId = await insertUser('hubmember-404');
    const res = await post({ guildId: 999_999, userId });
    expect(res.status).toBe(404);
  });

  it('400 for a malformed body', async () => {
    const res = await post({ guildId: 'x' });
    expect(res.status).toBe(400);
  });
});
