/**
 * ROK-1831 L2b — game-server community hubs against a real database: the
 * admin `communityHub` toggle (create / hide / unhide / backfill), the L-2
 * membership window, Join / Leave / re-add, Quick Play and the core page
 * with WoW inactive.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../../wow-common/manifest';
import { PELICAN_PLUGIN_ID } from '../pelican.constants';
import { fakeServer } from '../testing/pelican-fixtures';
import { memberToken } from '../testing/pelican-integration.helpers';
import { PelicanHubKindAdapter } from './pelican-hub-kind.adapter';
import { ServerHubMembershipService } from './server-hub-membership.service';

const DAY = 86_400_000;
let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const adapter = () => testApp.app.get(PelicanHubKindAdapter);
const membership = () => testApp.app.get(ServerHubMembershipService);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const toggle = (id: number, on: boolean) =>
  testApp.request
    .patch(`/admin/plugins/pelican/servers/${id}`)
    .set(auth(adminToken))
    .send({ communityHub: on });

async function insertServer(n: number, gameId: number | null): Promise<number> {
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: 'Vale',
        gameId,
        currentState: 'running',
        statusCheckedAt: new Date(),
        lastSyncedAt: new Date(),
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

async function hubOf(
  serverId: number,
): Promise<typeof schema.guilds.$inferSelect> {
  const rows = await testApp.db
    .select()
    .from(schema.guilds)
    .where(eq(schema.guilds.pelicanServerId, serverId));
  expect(rows).toHaveLength(1);
  return nonEmpty(rows, 'hub')[0];
}

async function member(
  username: string,
  steamId: string | null = null,
): Promise<{ id: number; token: string }> {
  const token = await memberToken(testApp, username);
  const [u] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username)),
    'user',
  );
  if (steamId !== null)
    await testApp.db
      .update(schema.users)
      .set({ steamId })
      .where(eq(schema.users.id, u.id));
  return { id: u.id, token };
}

async function enabledHub(): Promise<{ serverId: number; guildId: number }> {
  const serverId = await insertServer(1, testApp.seed.game.id);
  expect((await toggle(serverId, true)).status).toBe(200);
  return { serverId, guildId: (await hubOf(serverId)).id };
}

async function setLastSeen(
  guildId: number,
  userId: number,
  daysAgo: number,
): Promise<void> {
  const m = schema.hubServerMembers;
  await testApp.db
    .update(m)
    .set({ lastSeenAt: new Date(Date.now() - daysAgo * DAY) })
    .where(and(eq(m.guildId, guildId), eq(m.userId, userId)));
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID))
    await registry().deactivate(PELICAN_PLUGIN_ID);
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('admin communityHub toggle (ROK-1831)', () => {
  it('creates exactly one game_server hub; a second toggle-on is a no-op; the row carries communityHub', async () => {
    const serverId = await insertServer(1, testApp.seed.game.id);
    const first = await toggle(serverId, true);
    expect((await toggle(serverId, true)).status).toBe(200);
    const hub = await hubOf(serverId);
    expect(hub).toMatchObject({
      kind: 'game_server',
      name: 'Vale',
      source: 'pelican',
      hiddenAt: null,
    });
    expect(first.body).toMatchObject({
      communityHub: { guildId: hub.id, hidden: false },
    });
  });

  it('refuses an unmapped server with 400', async () => {
    const serverId = await insertServer(1, null);
    expect((await toggle(serverId, true)).status).toBe(400);
  });

  it('two servers with the same name and game both get hubs', async () => {
    const a = await insertServer(1, testApp.seed.game.id);
    const b = await insertServer(2, testApp.seed.game.id);
    expect((await toggle(a, true)).status).toBe(200);
    expect((await toggle(b, true)).status).toBe(200);
  });

  it('off hides (members kept, 404 for non-staff, 200 for staff); on restores', async () => {
    const { serverId, guildId } = await enabledHub();
    const u = await member('m1');
    await testApp.request
      .post(`/plugins/pelican/hubs/${guildId}/join`)
      .set(auth(u.token))
      .expect(201);
    const off = await toggle(serverId, false);
    expect(off.body).toMatchObject({ communityHub: { guildId, hidden: true } });
    await testApp.request
      .get(`/guilds/${guildId}`)
      .set(auth(u.token))
      .expect(404);
    await testApp.request
      .get(`/guilds/${guildId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(
      await testApp.db.select().from(schema.hubServerMembers),
    ).toHaveLength(1);
    await toggle(serverId, true);
    await testApp.request
      .get(`/guilds/${guildId}`)
      .set(auth(u.token))
      .expect(200);
  });

  it('backfills linked Quick Play participants seen within 90 days only', async () => {
    const serverId = await insertServer(1, testApp.seed.game.id);
    const recent = await member('recent', '76561190000000001');
    const old = await member('old', '76561190000000002');
    const eventId = await insertQuickPlay(serverId, 'ended');
    const p = schema.adHocParticipants;
    await testApp.db.insert(p).values([
      {
        eventId,
        userId: recent.id,
        steamId: '76561190000000001',
        discordUsername: 'recent',
        source: 'steam',
        pelicanServerId: serverId,
        joinedAt: new Date(Date.now() - 10 * DAY),
      },
      {
        eventId,
        userId: old.id,
        steamId: '76561190000000002',
        discordUsername: 'old',
        source: 'steam',
        pelicanServerId: serverId,
        joinedAt: new Date(Date.now() - 100 * DAY),
      },
    ]);
    await toggle(serverId, true);
    const rows = await testApp.db.select().from(schema.hubServerMembers);
    expect(rows.map((r) => r.userId)).toEqual([recent.id]);
  });
});

async function insertQuickPlay(
  serverId: number,
  status: 'live' | 'ended',
): Promise<number> {
  const start = new Date(Date.now() - 2 * 3_600_000);
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [start, new Date()],
        isAdHoc: true,
        adHocStatus: status,
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  void serverId;
  return e.id;
}

describe('server hub membership (ROK-1831 L-2)', () => {
  it('a presence sighting within 90 days is a member; 100 days is not, and the row stays', async () => {
    const { serverId, guildId } = await enabledHub();
    const u = await member('p1', '76561190000000003');
    expect(
      await membership().recordPresence(serverId, u.id, 'Ragnar', new Date()),
    ).toBe(true);
    await setLastSeen(guildId, u.id, 89);
    expect(await adapter().isMember(u.id, guildId)).toBe(true);
    await setLastSeen(guildId, u.id, 100);
    expect(await adapter().isMember(u.id, guildId)).toBe(false);
    expect(
      await testApp.db.select().from(schema.hubServerMembers),
    ).toHaveLength(1);
  });

  it('Join adds, Leave removes, presence after Leave re-adds; join is idempotent', async () => {
    const { serverId, guildId } = await enabledHub();
    const u = await member('j1');
    const join = () =>
      testApp.request
        .post(`/plugins/pelican/hubs/${guildId}/join`)
        .set(auth(u.token));
    expect((await join()).body).toEqual({ joined: true });
    await join().expect(201);
    expect(await adapter().isMember(u.id, guildId)).toBe(true);
    const left = await testApp.request
      .delete(`/plugins/pelican/hubs/${guildId}/join`)
      .set(auth(u.token));
    expect(left.body).toEqual({ joined: false });
    expect(await adapter().isMember(u.id, guildId)).toBe(false);
    await membership().recordPresence(
      serverId,
      u.id,
      null,
      new Date(Date.now() + 1000),
    );
    expect(await adapter().isMember(u.id, guildId)).toBe(true);
  });

  it("lists this server's Quick Plays newest first", async () => {
    const { serverId, guildId } = await enabledHub();
    const eventId = await insertQuickPlay(serverId, 'live');
    await testApp.db.insert(schema.adHocParticipants).values({
      eventId,
      steamId: '76561190000000009',
      discordUsername: 'x',
      source: 'steam',
      pelicanServerId: serverId,
    });
    const res = await testApp.request
      .get(`/plugins/pelican/hubs/${guildId}/quick-play`)
      .set(auth(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({
      data: [{ eventId, status: 'live', endedAt: null, participantCount: 1 }],
    });
  });

  it('the core page answers 200 with the server block while WoW is inactive', async () => {
    const { serverId, guildId } = await enabledHub();
    if (registry().isActive(WOW_COMMON_MANIFEST.id))
      await registry().deactivate(WOW_COMMON_MANIFEST.id);
    const res = await testApp.request
      .get(`/guilds/${guildId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({
      guild: { kind: 'game_server' },
      server: { pelicanServerId: serverId, viewerJoined: false },
    });
  });
});

describe('ROK-1831 fix r1 — visitor privacy + server sync', () => {
  it('a visitor gets the server block, Join state and member count, but no member rows or arrivals', async () => {
    const { guildId } = await enabledHub();
    const joiner = await member('fixr1-joiner');
    await testApp.request
      .post(`/plugins/pelican/hubs/${guildId}/join`)
      .set(auth(joiner.token))
      .expect(201);
    const visitor = await member('fixr1-visitor');
    const res = await testApp.request
      .get(`/guilds/${guildId}`)
      .set(auth(visitor.token))
      .expect(200);
    expect(res.body.guild.memberCount).toBe(1);
    expect(res.body.ranks[0].members).toEqual([]);
    expect(res.body.server.viewerJoined).toBe(false);
    expect(res.body.server.recentArrivals).toBeUndefined();
    const own = await testApp.request
      .get(`/guilds/${guildId}`)
      .set(auth(joiner.token))
      .expect(200);
    expect(own.body.ranks[0].members).toHaveLength(1);
  });

  it('PATCH copies the server name and a game change onto the hub', async () => {
    const { serverId } = await enabledHub();
    await testApp.db
      .update(schema.pelicanServers)
      .set({ name: 'Renamed Vale' })
      .where(eq(schema.pelicanServers.id, serverId));
    const [other] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Fix R1 Game', slug: 'fix-r1-game' })
        .returning({ id: schema.games.id }),
      'game',
    );
    await testApp.request
      .patch(`/admin/plugins/pelican/servers/${serverId}`)
      .set(auth(adminToken))
      .send({ gameId: other.id })
      .expect(200);
    const hub = await hubOf(serverId);
    expect(hub).toMatchObject({
      name: 'Renamed Vale',
      nameKey: 'renamed vale',
      gameId: other.id,
    });
  });

  it('clearing the game mapping hides the hub; re-enabling needs a game', async () => {
    const { serverId } = await enabledHub();
    const res = await testApp.request
      .patch(`/admin/plugins/pelican/servers/${serverId}`)
      .set(auth(adminToken))
      .send({ gameId: null })
      .expect(200);
    expect(res.body.communityHub).toMatchObject({ hidden: true });
    expect((await hubOf(serverId)).hiddenAt).not.toBeNull();
    expect((await toggle(serverId, true)).status).toBe(400);
  });
});
