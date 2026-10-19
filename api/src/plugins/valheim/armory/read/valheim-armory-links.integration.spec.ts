/**
 * ROK-1836 follow-up (additive) against a real database: the member list
 * carries `total`; the detail carries the server's community hub id (ROK-1831,
 * hidden hubs null for non-staff); admin claim events carry resolved users.
 */
import { eq } from 'drizzle-orm';
import {
  ValheimCharacterDetailSchema,
  ValheimCharacterListResponseSchema,
  ValheimClaimEventListResponseSchema,
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

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const BASE = '/plugins/valheim/armory/characters';
const ADMIN = '/admin/plugins/valheim/armory/characters';
let testApp: TestApp;
let gameId: number;

const registry = () => testApp.app.get(PluginRegistryService);
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

/** Import the vanilla character on a fresh server; returns both ids. */
async function seedCharacter(n: number) {
  const serverId = await makeServer(n);
  const fixture = loadValheimFixture('character-vanilla') as never;
  await testApp.db
    .insert(schema.valheimLinkSnapshots)
    .values(valheimSnapshotRow(serverId, fixture));
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
  const P = schema.valheimProfiles;
  const [p] = nonEmpty(
    await testApp.db
      .select({ id: P.id })
      .from(P)
      .where(eq(P.pelicanServerId, serverId)),
    'profile',
  );
  return { serverId, id: p.id };
}

/** A ROK-1831 game-server hub keyed to the Pelican server. */
async function makeHub(serverId: number, hidden = false): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_server',
        region: 'us',
        name: `Hub ${serverId}`,
        nameKey: `hub ${serverId}`,
        source: 'pelican',
        pelicanServerId: serverId,
        hiddenAt: hidden ? new Date() : null,
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return g.id;
}

async function hubIdAs(id: number, token: string) {
  const res = await get(`${BASE}/${id}`, token);
  expect(res.status).toBe(200);
  return ValheimCharacterDetailSchema.parse(res.body).hubId;
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

describe('armory list total (ROK-1836 follow-up)', () => {
  it('reports the filtered total on every page, not the page length', async () => {
    const { serverId } = await seedCharacter(1);
    await seedCharacter(2);
    await seedCharacter(3);
    const token = await memberToken(testApp, 'alice');
    const page = async (q: string) =>
      ValheimCharacterListResponseSchema.parse(
        (await get(`${BASE}?${q}`, token)).body,
      );
    const p1 = await page('page=1&pageSize=2');
    const p2 = await page('page=2&pageSize=2');
    expect([p1.data.length, p1.total]).toEqual([2, 3]);
    expect([p2.data.length, p2.total]).toEqual([1, 3]);
    expect((await page(`serverId=${serverId}`)).total).toBe(1);
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const adminPage = await get(`${ADMIN}?pageSize=1`, admin);
    expect(adminPage.body).toMatchObject({ total: 3 });
  });
});

describe('armory detail hubId (ROK-1836 follow-up)', () => {
  it('carries the hub id for a hub server and null for a non-hub server', async () => {
    const hubbed = await seedCharacter(1);
    const plain = await seedCharacter(2);
    const hubId = await makeHub(hubbed.serverId);
    const token = await memberToken(testApp, 'alice');
    expect(await hubIdAs(hubbed.id, token)).toBe(hubId);
    expect(await hubIdAs(plain.id, token)).toBeNull();
  });

  it('a hidden hub is null for a member and visible to an admin', async () => {
    const c = await seedCharacter(1);
    const hubId = await makeHub(c.serverId, true);
    const member = await memberToken(testApp, 'alice');
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    expect(await hubIdAs(c.id, member)).toBeNull();
    expect(await hubIdAs(c.id, admin)).toBe(hubId);
  });
});

describe('armory claim events resolve users (ROK-1836 follow-up)', () => {
  it('resolves from/to/actor; a deleted user resolves to null', async () => {
    const c = await seedCharacter(1);
    await memberToken(testApp, 'alice');
    await memberToken(testApp, 'bob');
    const U = schema.users;
    const users = await testApp.db.select({ id: U.id, name: U.username }).from(U);
    const idOf = (n: string) => users.find((u) => u.name === n)?.id ?? 0;
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const adminUser = testApp.seed.adminUser;
    for (const userId of [idOf('alice'), idOf('bob')]) {
      const res = await testApp.request
        .put(`${ADMIN}/${c.id}/owner`)
        .set(auth(admin))
        .send({ userId });
      expect(res.status).toBe(200);
    }
    const events = async () =>
      ValheimClaimEventListResponseSchema.parse(
        (await get(`${ADMIN}/${c.id}/claim-events`, admin)).body,
      ).data;
    const [latest, first] = await events();
    expect(latest).toMatchObject({
      fromUser: { id: idOf('alice'), username: 'alice' },
      toUser: { id: idOf('bob'), username: 'bob' },
      actor: { id: adminUser.id, username: adminUser.username },
    });
    expect(first).toMatchObject({ fromUser: null, toUser: { id: idOf('alice') } });
    await testApp.db.delete(U).where(eq(U.id, idOf('alice')));
    const [after] = await events();
    expect(after).toMatchObject({ fromUserId: null, fromUser: null });
    expect(after?.toUser).toMatchObject({ username: 'bob' });
  });
});
