/**
 * ROK-1932 — the server hub hero's head-counts against a real database.
 * `onlineCount` is every distinct player on the server (claimed or not, hub
 * member or not), and `unlinkedOnlineCount` the ones with no Valheim
 * character on THIS server claimed by any Raid Ledger user. Both go to a
 * member and a visitor alike; the visitor still gets no rows.
 */
import { eq } from 'drizzle-orm';
import { ValheimCharacterMessageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { loadValheimFixture } from '../../valheim/link/ingest/valheim-link-ingest.testing';
import { VALHEIM_GAME_SLUG } from '../../valheim/valheim.constants';
import { PELICAN_PLUGIN_ID } from '../pelican.constants';
import { PelicanPresenceSupervisor } from '../presence/pelican-presence.supervisor';
import type { ServerRosterPlayer } from '../presence/server-presence.reader';
import { fakeServer } from '../testing/pelican-fixtures';
import { memberToken } from '../testing/pelican-integration.helpers';
import { ServerHubMembershipService } from './server-hub-membership.service';

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function gameId(slug: string): Promise<number> {
  const g = schema.games;
  const [found] = await testApp.db
    .select({ id: g.id })
    .from(g)
    .where(eq(g.slug, slug));
  if (found) return found.id;
  const [row] = nonEmpty(
    await testApp.db
      .insert(g)
      .values({ name: `Game ${slug}`, slug })
      .returning({ id: g.id }),
    'game',
  );
  return row.id;
}

async function insertServer(n: number, game: number): Promise<number> {
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: `Vale ${n}`,
        gameId: game,
        currentState: 'running',
        statusCheckedAt: new Date(),
        lastSyncedAt: new Date(),
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

/** A server with its hub switched on; returns both ids. */
async function hubFor(
  n: number,
  game: number,
): Promise<{ serverId: number; guildId: number }> {
  const serverId = await insertServer(n, game);
  await testApp.request
    .patch(`/admin/plugins/pelican/servers/${serverId}`)
    .set(auth(adminToken))
    .send({ communityHub: true })
    .expect(200);
  const [hub] = nonEmpty(
    await testApp.db
      .select({ id: schema.guilds.id })
      .from(schema.guilds)
      .where(eq(schema.guilds.pelicanServerId, serverId)),
    'hub',
  );
  return { serverId, guildId: hub.id };
}

async function user(
  username: string,
  steamId: string | null,
): Promise<{ id: number; token: string }> {
  const token = await memberToken(testApp, username);
  const [u] = nonEmpty(
    await testApp.db
      .select({ id: schema.users.id })
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

/** A Valheim character on `serverId`; `claimedBy` null = unclaimed. */
async function profile(
  serverId: number,
  steamId: string,
  claimedBy: number | null,
): Promise<void> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  await testApp.db.insert(schema.valheimProfiles).values({
    pelicanServerId: serverId,
    steamId,
    playerId: `P_${steamId}`,
    worldUid: '1234567890123',
    worldName: 'W',
    name: `c_${steamId}`,
    gameVersion: '0.220.5',
    modVersion: '1.0.0',
    capturedAt: new Date(),
    equipment: ch.equipment,
    inventory: ch.inventory,
    skills: ch.skills,
    trophies: [],
    knownItems: [],
    knownRecipes: [],
    ...(claimedBy === null
      ? {}
      : { claimedBy, claimSource: 'manual' as const, claimedAt: new Date() }),
  });
}

/** Presence reports exactly these (server, SteamID) pairs as online. */
function online(game: number, pairs: [number, string][]): void {
  const roster: ServerRosterPlayer[] = pairs.map(([pelicanServerId, id]) => ({
    pelicanServerId,
    gameId: game,
    steamId: id,
    name: `n_${id}`,
  }));
  const supervisor = testApp.app.get(PelicanPresenceSupervisor, {
    strict: false,
  });
  jest.spyOn(supervisor, 'playersOnGames').mockReturnValue(roster);
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
  jest.restoreAllMocks();
  if (registry().isActive(PELICAN_PLUGIN_ID))
    await registry().deactivate(PELICAN_PLUGIN_ID);
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('server hub online counts (ROK-1932)', () => {
  it('counts every player online and the unclaimed ones, for a member and a visitor', async () => {
    const valheim = await gameId(VALHEIM_GAME_SLUG);
    const { serverId, guildId } = await hubFor(1, valheim);
    const other = await insertServer(2, valheim);
    const hubMember = await user('rok1932-member', 'S_MEMBER');
    const claimer = await user('rok1932-claimer', 'S_CLAIMED');
    const visitor = await user('rok1932-visitor', null);
    await testApp.app
      .get(ServerHubMembershipService)
      .recordPresence(serverId, hubMember.id, 'Bjorn', new Date());
    // Claimed by the hub member, and by a user who is NOT a hub member.
    await profile(serverId, 'S_MEMBER', hubMember.id);
    await profile(serverId, 'S_CLAIMED', claimer.id);
    // Unclaimed here; a claim on ANOTHER server does not count.
    await profile(serverId, 'S_UNCLAIMED', null);
    await profile(other, 'S_UNCLAIMED', claimer.id);
    // S_NOPROFILE has no character at all; S_ELSEWHERE plays another server.
    online(valheim, [
      [serverId, 'S_MEMBER'],
      [serverId, 'S_CLAIMED'],
      [serverId, 'S_UNCLAIMED'],
      [serverId, 'S_NOPROFILE'],
      [other, 'S_ELSEWHERE'],
    ]);
    const page = (token: string) =>
      testApp.request.get(`/guilds/${guildId}`).set(auth(token)).expect(200);

    const asMember = (await page(hubMember.token)).body;
    expect(asMember.server).toMatchObject({
      onlineCount: 4,
      unlinkedOnlineCount: 2,
    });
    expect(asMember.ranks[0].members).toEqual([
      expect.objectContaining({
        server: expect.objectContaining({ onlineNow: true }),
      }),
    ]);

    const asVisitor = (await page(visitor.token)).body;
    expect(asVisitor.server).toMatchObject({
      onlineCount: 4,
      unlinkedOnlineCount: 2,
    });
    expect(asVisitor.ranks[0].members).toEqual([]);
    expect(asVisitor.server.recentArrivals).toBeUndefined();
  });

  it('omits unlinkedOnlineCount for a game with no characters to claim', async () => {
    const game = await gameId('rok1932-not-valheim');
    const { serverId, guildId } = await hubFor(3, game);
    const viewer = await user('rok1932-other-game', null);
    online(game, [
      [serverId, 'S_ONE'],
      [serverId, 'S_TWO'],
    ]);
    const res = await testApp.request
      .get(`/guilds/${guildId}`)
      .set(auth(viewer.token))
      .expect(200);
    expect(res.body.server.onlineCount).toBe(2);
    expect(res.body.server).not.toHaveProperty('unlinkedOnlineCount');
  });
});
