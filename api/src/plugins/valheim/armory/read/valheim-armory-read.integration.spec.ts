/**
 * ROK-1835 L4 — armory read routes against a real database: member list /
 * detail / map meta (shape-locked by the contract schemas), the SteamID64
 * absent from every member response and present only in the admin list,
 * 401 signed-out, 404 unknown, pagination bounds (T14).
 */
import { eq } from 'drizzle-orm';
import {
  ValheimCharacterDetailSchema,
  ValheimCharacterListResponseSchema,
  ValheimMapMetaSchema,
} from '@raid-ledger/contract';
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
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { memberToken } from '../../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';

const STEAM = '76561198000000001'; // character + map fixtures
const SHA = 'a'.repeat(64); // map-shared-layer base map
const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const BASE = '/plugins/valheim/armory/characters';
const ADMIN_LIST = '/admin/plugins/valheim/armory/characters';
let testApp: TestApp;
let gameId: number;

const registry = () => testApp.app.get(PluginRegistryService);
const drain = () => testApp.app.get(ValheimArmoryImportService).drainOnce();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (url: string, token: string) =>
  testApp.request.get(url).set(auth(token));

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

/** Store fixtures as pending snapshots on a server and drain them. */
async function importFixtures(serverId: number, ...names: string[]) {
  for (const name of names) {
    const row = valheimSnapshotRow(serverId, loadValheimFixture(name) as never);
    await testApp.db.insert(schema.valheimLinkSnapshots).values(row);
  }
  await drain();
}

async function profileOn(serverId: number): Promise<number> {
  const P = schema.valheimProfiles;
  const [p] = nonEmpty(
    await testApp.db
      .select({ id: P.id })
      .from(P)
      .where(eq(P.pelicanServerId, serverId)),
    'profile',
  );
  return p.id;
}

async function mapOn(serverId: number): Promise<number> {
  const M = schema.valheimMaps;
  const [m] = nonEmpty(
    await testApp.db
      .select({ id: M.id })
      .from(M)
      .where(eq(M.pelicanServerId, serverId)),
    'map',
  );
  return m.id;
}

/** Import the character + shared-layer map on a fresh server. */
async function seedCharacter(n: number) {
  const serverId = await makeServer(n);
  await importFixtures(serverId, 'character-vanilla', 'map-shared-layer');
  return {
    serverId,
    id: await profileOn(serverId),
    mapId: await mapOn(serverId),
  };
}

async function rename(id: number, name: string): Promise<void> {
  const P = schema.valheimProfiles;
  await testApp.db.update(P).set({ name }).where(eq(P.id, id));
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

describe('Valheim armory member reads (ROK-1835 L4)', () => {
  it('lists characters for a member without the SteamID64', async () => {
    const { id, serverId } = await seedCharacter(1);
    const res = await get(BASE, await memberToken(testApp, 'alice'));
    expect(res.status).toBe(200);
    const body = ValheimCharacterListResponseSchema.parse(res.body);
    expect(body.data).toEqual([
      expect.objectContaining({
        id,
        pelicanServerId: serverId,
        claimedBy: null,
      }),
    ]);
    expect(res.text).not.toContain(STEAM);
  });

  it('returns detail with the sheet and map refs, no SteamID64', async () => {
    const { id, mapId } = await seedCharacter(1);
    const res = await get(`${BASE}/${id}`, await memberToken(testApp, 'alice'));
    expect(res.status).toBe(200);
    const body = ValheimCharacterDetailSchema.parse(res.body);
    expect(body.maps).toEqual([expect.objectContaining({ id: mapId })]);
    expect(res.text).not.toContain(STEAM);
  });

  it('returns map meta with base-map readiness computed at read time', async () => {
    const { id, mapId, serverId } = await seedCharacter(1);
    const token = await memberToken(testApp, 'alice');
    const url = `${BASE}/${id}/maps/${mapId}`;
    const before = ValheimMapMetaSchema.parse((await get(url, token)).body);
    expect(before.baseMap).toMatchObject({ sha256: SHA, ready: false });
    expect(before.hasSharedExplored).toBe(true);
    await testApp.db.insert(schema.valheimLinkBlobs).values({
      pelicanServerId: serverId,
      sha256: SHA,
      byteLength: 3145728,
      contentType: 'image/png',
      width: 2048,
      height: 2048,
      storagePath: 'x/aa.png',
    });
    const after = await get(url, token);
    expect(ValheimMapMetaSchema.parse(after.body).baseMap?.ready).toBe(true);
    expect(after.text).not.toContain(STEAM);
  });

  it('404s an unknown character, an unknown map, and a map of another character', async () => {
    const a = await seedCharacter(1);
    const b = await seedCharacter(2);
    const token = await memberToken(testApp, 'alice');
    expect((await get(`${BASE}/999999`, token)).status).toBe(404);
    expect((await get(`${BASE}/${a.id}/maps/999999`, token)).status).toBe(404);
    expect((await get(`${BASE}/${a.id}/maps/${b.mapId}`, token)).status).toBe(
      404,
    );
  });

  it('401s every read route when signed out', async () => {
    const { id, mapId } = await seedCharacter(1);
    for (const url of [BASE, `${BASE}/${id}`, `${BASE}/${id}/maps/${mapId}`]) {
      expect((await testApp.request.get(url)).status).toBe(401);
    }
  });

  it('sorts by name and pages within bounds (pageSize ≤ 100)', async () => {
    const servers: number[] = [];
    for (const [n, name] of [
      [1, 'Cyra'],
      [2, 'Astrid'],
      [3, 'Bjorn'],
    ] as const) {
      const { id, serverId } = await seedCharacter(n);
      await rename(id, name);
      servers.push(serverId);
    }
    const token = await memberToken(testApp, 'alice');
    const page = (q: string) => get(`${BASE}?${q}`, token);
    const names = (r: { body: unknown }) =>
      ValheimCharacterListResponseSchema.parse(r.body).data.map((c) => c.name);
    expect(names(await page('page=1&pageSize=2'))).toEqual(['Astrid', 'Bjorn']);
    expect(names(await page('page=2&pageSize=2'))).toEqual(['Cyra']);
    expect(names(await page('page=3&pageSize=2'))).toEqual([]);
    expect((await page('pageSize=101')).status).toBe(400);
    expect((await page('page=0')).status).toBe(400);
    expect(names(await page(`serverId=${servers[0] ?? 0}`))).toEqual(['Cyra']);
  });
});

describe('Valheim armory admin owner list (ROK-1835 L4)', () => {
  it('includes steamId64 for admins and filters unclaimed', async () => {
    const a = await seedCharacter(1);
    const b = await seedCharacter(2);
    const P = schema.valheimProfiles;
    const adminId = testApp.seed.adminUser.id;
    await testApp.db
      .update(P)
      .set({ claimedBy: adminId, claimSource: 'admin', claimedAt: new Date() })
      .where(eq(P.id, b.id));
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const all = await get(ADMIN_LIST, token);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0]).toMatchObject({ steamId64: STEAM });
    const open = await get(`${ADMIN_LIST}?unclaimed=true`, token);
    expect(open.body.data).toEqual([
      expect.objectContaining({ id: a.id, steamId64: STEAM }),
    ]);
  });

  it('refuses the admin list to a member (403)', async () => {
    await seedCharacter(1);
    const res = await get(ADMIN_LIST, await memberToken(testApp, 'alice'));
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(STEAM);
  });
});

describe('Valheim armory — another member owns the character (ROK-1835 T14)', () => {
  it('a member reads a character owned by someone else: 200, owner shown, no SteamID64', async () => {
    const { id } = await seedCharacter(1);
    const reader = await memberToken(testApp, 'alice');
    await memberToken(testApp, 'bob');
    const U = schema.users;
    const [bob] = nonEmpty(
      await testApp.db
        .select({ id: U.id, username: U.username })
        .from(U)
        .where(eq(U.username, 'bob')),
      'bob',
    );
    const P = schema.valheimProfiles;
    await testApp.db
      .update(P)
      .set({ claimedBy: bob.id, claimSource: 'manual', claimedAt: new Date() })
      .where(eq(P.id, id));
    const detail = await get(`${BASE}/${id}`, reader);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id,
      claimedBy: { id: bob.id, username: 'bob' },
    });
    expect(detail.text).not.toContain(STEAM);
    expect(detail.text).not.toContain('steamId64');
    const list = await get(BASE, reader);
    const [row] = nonEmpty(
      ValheimCharacterListResponseSchema.parse(list.body).data,
      'list row',
    );
    expect(row.claimedBy).toEqual(
      expect.objectContaining({ id: bob.id, username: 'bob' }),
    );
    expect(list.text).not.toContain(STEAM);
  });
});
