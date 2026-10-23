/**
 * ROK-1933 — the hub claim banner's server facts against a real database:
 * `GET …/servers/:serverId/claim-status` (unclaimed count + the viewer's own
 * claim, per viewer, never cached; a hidden hub is the server-keyed L-5 404)
 * and `unclaimed=1` on the member list, filtered before paging.
 */
import { eq } from 'drizzle-orm';
import {
  ValheimCharacterListResponseSchema,
  ValheimClaimStatusResponseSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { memberToken } from '../../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const LIST = '/plugins/valheim/armory/characters';
const P = schema.valheimProfiles;
const statusUrl = (serverId: number) =>
  `/plugins/valheim/armory/servers/${serverId}/claim-status`;
let testApp: TestApp;
let gameId: number;

const registry = () => testApp.app.get(PluginRegistryService);
const get = (url: string, token: string) =>
  testApp.request.get(url).set({ Authorization: `Bearer ${token}` });

async function makeServer(n: number): Promise<number> {
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

/** A server with `names.length` characters (the fixture row, then copies). */
async function seedServer(
  n: number,
  names: string[],
): Promise<{ serverId: number; ids: number[] }> {
  const serverId = await makeServer(n);
  const snap = valheimSnapshotRow(
    serverId,
    loadValheimFixture('character-vanilla') as never,
  );
  await testApp.db.insert(schema.valheimLinkSnapshots).values(snap);
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
  const [first] = nonEmpty(
    await testApp.db.select().from(P).where(eq(P.pelicanServerId, serverId)),
    'profile',
  );
  const { id: firstId, ...base } = first;
  const ids = [firstId];
  for (const [i, name] of names.entries()) {
    if (i === 0) {
      await testApp.db.update(P).set({ name }).where(eq(P.id, firstId));
      continue;
    }
    const [row] = nonEmpty(
      await testApp.db
        .insert(P)
        .values({ ...base, name, playerId: `${base.playerId}-${i}` })
        .returning({ id: P.id }),
      `profile ${name}`,
    );
    ids.push(row.id);
  }
  return { serverId, ids };
}

async function claim(profileId: number, userId: number): Promise<void> {
  await testApp.db
    .update(P)
    .set({ claimedBy: userId, claimSource: 'manual', claimedAt: new Date() })
    .where(eq(P.id, profileId));
}

async function userId(username: string): Promise<number> {
  const U = schema.users;
  const [u] = nonEmpty(
    await testApp.db
      .select({ id: U.id })
      .from(U)
      .where(eq(U.username, username)),
    username,
  );
  return u.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  gameId = g.id;
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('GET …/servers/:serverId/claim-status (ROK-1933)', () => {
  it('counts unclaimed characters and flags only the viewer who claimed', async () => {
    const { serverId, ids } = await seedServer(1, ['Astrid', 'Bjorn', 'Cyra']);
    const other = await seedServer(2, ['Dagny']);
    const alice = await memberToken(testApp, 'alice');
    const bob = await memberToken(testApp, 'bob');
    await claim(nonEmpty(ids, 'ids')[0], await userId('alice'));
    await claim(nonEmpty(other.ids, 'other ids')[0], await userId('bob'));
    const asAlice = await get(statusUrl(serverId), alice);
    expect(asAlice.status).toBe(200);
    expect(asAlice.headers['cache-control']).toBe('private, no-store');
    expect(ValheimClaimStatusResponseSchema.parse(asAlice.body)).toEqual({
      viewerHasClaim: true,
      unclaimedCount: 2,
    });
    // Bob's claim is on the OTHER server, so it does not count here.
    expect(
      ValheimClaimStatusResponseSchema.parse(
        (await get(statusUrl(serverId), bob)).body,
      ),
    ).toEqual({
      viewerHasClaim: false,
      unclaimedCount: 2,
    });
  });

  it('reports zero for a server with no characters', async () => {
    const serverId = await makeServer(3);
    const res = await get(
      statusUrl(serverId),
      await memberToken(testApp, 'alice'),
    );
    expect(res.body).toEqual({ viewerHasClaim: false, unclaimedCount: 0 });
  });

  it('401s signed out and 400s a bad server id', async () => {
    const serverId = await makeServer(1);
    expect((await testApp.request.get(statusUrl(serverId))).status).toBe(401);
    const alice = await memberToken(testApp, 'alice');
    expect(
      (await get('/plugins/valheim/armory/servers/0/claim-status', alice))
        .status,
    ).toBe(400);
  });
});

describe('claim-status on a hidden hub (ROK-1933, L-5)', () => {
  it('a hidden hub: members get the hub 404 (as the list drops its rows); staff get 200', async () => {
    const { serverId } = await seedServer(1, ['Astrid']);
    const hubId = await ensureFixtureHubId(testApp.db, serverId, gameId);
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const alice = await memberToken(testApp, 'alice');
    const hidden = await testApp.request
      .patch(`/guilds/${hubId}/hidden`)
      .set({ Authorization: `Bearer ${admin}` })
      .send({ hidden: true });
    expect(hidden.status).toBe(200);
    const res = await get(statusUrl(serverId), alice);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: HUB_NOT_FOUND });
    const list = await get(`${LIST}?serverId=${serverId}`, alice);
    expect(ValheimCharacterListResponseSchema.parse(list.body).data).toEqual(
      [],
    );
    expect((await get(statusUrl(serverId), admin)).body).toEqual({
      viewerHasClaim: false,
      unclaimedCount: 1,
    });
  });
});

describe('member list `unclaimed=1` (ROK-1933)', () => {
  it('filters before paging, so every page holds only unclaimed rows', async () => {
    const seeded = await seedServer(1, [
      'Astrid',
      'Bjorn',
      'Cyra',
      'Dagny',
      'Eir',
    ]);
    const { serverId } = seeded;
    const [astrid, , cyra] = nonEmpty(seeded.ids, 'ids');
    await memberToken(testApp, 'alice');
    const aliceId = await userId('alice');
    await claim(astrid, aliceId);
    if (cyra === undefined) throw new Error('Cyra not seeded');
    await claim(cyra, aliceId);
    const token = await memberToken(testApp, 'bob');
    const page = async (n: number) => {
      const res = await get(
        `${LIST}?serverId=${serverId}&unclaimed=1&page=${n}&pageSize=2`,
        token,
      );
      expect(res.status).toBe(200);
      return ValheimCharacterListResponseSchema.parse(res.body);
    };
    const first = await page(1);
    expect(first.data.map((c) => c.name)).toEqual(['Bjorn', 'Dagny']);
    expect(first.total).toBe(3);
    expect((await page(2)).data.map((c) => c.name)).toEqual(['Eir']);
    expect((await page(3)).data).toEqual([]);
  });
});
