/**
 * ROK-1835 L3 — Steam identity + claims against a real database: import-time
 * auto-attach (active verified users only), attach on a later Steam link,
 * auto-only detach on unlink, member claim 200 (summary)/409, admin
 * assign/unassign and the audit trail, claim release on user hard-delete,
 * plugin-inactive 403 and bad path ids 400.
 */
import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ValheimCharacterSummarySchema,
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
import { deleteUserTransaction } from '../../../../users/users-delete.helpers';
import {
  STEAM_ACCOUNT_LINKED,
  STEAM_ACCOUNT_UNLINKED,
} from '../../../../steam/steam.constants';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { memberToken } from '../../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';

const STEAM = '76561198000000001'; // character-vanilla fixture
const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const P = schema.valheimProfiles;
let testApp: TestApp;
let gameId: number;

const registry = () => testApp.app.get(PluginRegistryService);
const drain = () => testApp.app.get(ValheimArmoryImportService).drainOnce();
const emit = (event: string, userId: number) =>
  testApp.app.get(EventEmitter2).emitAsync(event, { userId, steamId64: STEAM });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const claimUrl = (id: number) =>
  `/plugins/valheim/armory/characters/${id}/claim`;
const ownerUrl = (id: number) =>
  `/admin/plugins/valheim/armory/characters/${id}/owner`;

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

/** Store the character fixture as a pending snapshot and drain it. */
async function importCharacter(serverId: number): Promise<number> {
  const row = valheimSnapshotRow(
    serverId,
    loadValheimFixture('character-vanilla') as never,
  );
  await testApp.db.insert(schema.valheimLinkSnapshots).values(row);
  await drain();
  const [p] = nonEmpty(
    await testApp.db.select().from(P).where(eq(P.pelicanServerId, serverId)),
    'profile',
  );
  return p.id;
}

async function makeUser(
  name: string,
  over: Partial<typeof schema.users.$inferInsert> = {},
): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${name}`,
        username: name,
        role: 'member',
        ...over,
      })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

async function userIdOf(username: string): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, username)),
    'user by name',
  );
  return u.id;
}

async function profile(id: number) {
  const [p] = nonEmpty(
    await testApp.db.select().from(P).where(eq(P.id, id)),
    'p',
  );
  return { claimedBy: p.claimedBy, claimSource: p.claimSource };
}

const audit = (id: number) =>
  testApp.db
    .select()
    .from(schema.valheimProfileClaimEvents)
    .where(eq(schema.valheimProfileClaimEvents.profileId, id));

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

describe('Valheim armory Steam auto-match (ROK-1835 L3)', () => {
  it('auto-attaches on import to the verified Steam user and audits auto_attach', async () => {
    const userId = await makeUser('viking', { steamId: STEAM });
    const id = await importCharacter(await makeServer(1));
    expect(await profile(id)).toEqual({
      claimedBy: userId,
      claimSource: 'auto',
    });
    expect(await audit(id)).toEqual([
      expect.objectContaining({
        action: 'auto_attach',
        toUserId: userId,
        actorUserId: null,
      }),
    ]);
  });

  it('never attaches to a deactivated user, and an unknown SteamID leaves users untouched', async () => {
    await makeUser('gone', { steamId: STEAM, deactivatedAt: new Date() });
    const before = await testApp.db
      .select({ id: schema.users.id, steamId: schema.users.steamId })
      .from(schema.users);
    const id = await importCharacter(await makeServer(1));
    expect(await profile(id)).toEqual({ claimedBy: null, claimSource: null });
    expect(await audit(id)).toHaveLength(0);
    const after = await testApp.db
      .select({ id: schema.users.id, steamId: schema.users.steamId })
      .from(schema.users);
    expect(after).toEqual(before);
  });

  it('attaches on a later Steam link (two servers) but never displaces a manual claim', async () => {
    const a = await importCharacter(await makeServer(1));
    const b = await importCharacter(await makeServer(2));
    const other = await makeUser('other');
    await testApp.db
      .update(P)
      .set({ claimedBy: other, claimSource: 'manual', claimedAt: new Date() })
      .where(eq(P.id, b));
    const userId = await makeUser('viking', { steamId: STEAM });
    await emit(STEAM_ACCOUNT_LINKED, userId);
    expect(await profile(a)).toEqual({
      claimedBy: userId,
      claimSource: 'auto',
    });
    expect(await profile(b)).toEqual({
      claimedBy: other,
      claimSource: 'manual',
    });
  });

  it('unlink detaches auto claims only and audits auto_detach', async () => {
    const userId = await makeUser('viking', { steamId: STEAM });
    const a = await importCharacter(await makeServer(1));
    const b = await importCharacter(await makeServer(2));
    await testApp.db
      .update(P)
      .set({ claimSource: 'manual' })
      .where(eq(P.id, b));
    await testApp.db
      .update(schema.users)
      .set({ steamId: null })
      .where(eq(schema.users.id, userId));
    await emit(STEAM_ACCOUNT_UNLINKED, userId);
    expect(await profile(a)).toEqual({ claimedBy: null, claimSource: null });
    expect(await profile(b)).toEqual({
      claimedBy: userId,
      claimSource: 'manual',
    });
    expect((await audit(a)).map((e) => e.action).sort()).toEqual([
      'auto_attach',
      'auto_detach',
    ]);
  });
});

describe('Valheim armory claims (ROK-1835 L3)', () => {
  it('a member claims an unclaimed character (200 + summary + audit); a second claim is 409', async () => {
    const id = await importCharacter(await makeServer(1));
    const alice = await memberToken(testApp, 'alice');
    const bob = await memberToken(testApp, 'bob');
    const res = await testApp.request.post(claimUrl(id)).set(auth(alice));
    expect(res.status).toBe(200);
    const aliceId = await userIdOf('alice');
    const summary = ValheimCharacterSummarySchema.parse(res.body);
    expect(summary).toMatchObject({ id, claimedBy: { id: aliceId } });
    expect(await audit(id)).toEqual([
      expect.objectContaining({
        action: 'claim',
        toUserId: aliceId,
        actorUserId: aliceId,
      }),
    ]);
    expect(res.text).not.toContain(STEAM);
    expect(
      (await testApp.request.post(claimUrl(id)).set(auth(bob))).status,
    ).toBe(409);
    expect(await profile(id)).toEqual({
      claimedBy: aliceId,
      claimSource: 'manual',
    });
  });

  it('concurrent claims: exactly one wins', async () => {
    const id = await importCharacter(await makeServer(1));
    const tokens = [
      await memberToken(testApp, 'c1'),
      await memberToken(testApp, 'c2'),
    ];
    const codes = await Promise.all(
      tokens.map((t) =>
        testApp.request
          .post(claimUrl(id))
          .set(auth(t))
          .then((r) => r.status),
      ),
    );
    expect(codes.sort()).toEqual([200, 409]);
  });

  it('404 for a missing character; 401 signed out', async () => {
    const t = await memberToken(testApp, 'alice');
    expect(
      (await testApp.request.post(claimUrl(999999)).set(auth(t))).status,
    ).toBe(404);
    expect((await testApp.request.post(claimUrl(1))).status).toBe(401);
  });

  it('admin assigns over a claim, unassigns, and the audit lists both (non-admin 403)', async () => {
    const id = await importCharacter(await makeServer(1));
    const alice = await memberToken(testApp, 'alice');
    await testApp.request.post(claimUrl(id)).set(auth(alice));
    const aliceId = await userIdOf('alice');
    const target = await makeUser('target');
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    expect(
      (
        await testApp.request
          .put(ownerUrl(id))
          .set(auth(alice))
          .send({ userId: target })
      ).status,
    ).toBe(403);
    const put = await testApp.request
      .put(ownerUrl(id))
      .set(auth(admin))
      .send({ userId: target });
    expect(put.status).toBe(200);
    expect(ValheimCharacterSummarySchema.parse(put.body)).toMatchObject({
      id,
      claimedBy: { id: target },
    });
    expect(await profile(id)).toEqual({
      claimedBy: target,
      claimSource: 'admin',
    });
    const un = await testApp.request
      .put(ownerUrl(id))
      .set(auth(admin))
      .send({ userId: null });
    expect(un.status).toBe(200);
    expect(ValheimCharacterSummarySchema.parse(un.body).claimedBy).toBeNull();
    expect(await profile(id)).toEqual({ claimedBy: null, claimSource: null });
    const list = await testApp.request
      .get(`/admin/plugins/valheim/armory/characters/${id}/claim-events`)
      .set(auth(admin));
    const events = ValheimClaimEventListResponseSchema.parse(list.body).data;
    expect(events.map((e) => e.action).sort()).toEqual([
      'admin_assign',
      'admin_unassign',
      'claim',
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'admin_assign',
          fromUserId: aliceId,
          toUserId: target,
        }),
        expect.objectContaining({
          action: 'admin_unassign',
          fromUserId: target,
          toUserId: null,
        }),
      ]),
    );
  });

  it('admin assign to a deactivated user is 400; a bad body is 400', async () => {
    const id = await importCharacter(await makeServer(1));
    const gone = await makeUser('gone', { deactivatedAt: new Date() });
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    expect(
      (
        await testApp.request
          .put(ownerUrl(id))
          .set(auth(admin))
          .send({ userId: gone })
      ).status,
    ).toBe(400);
    expect(
      (
        await testApp.request
          .put(ownerUrl(id))
          .set(auth(admin))
          .send({ owner: 1 })
      ).status,
    ).toBe(400);
  });
});

describe('Valheim armory claims vs user hard-delete (ROK-1835 B1)', () => {
  it('deleting a claimant (auto + manual) unclaims both profiles and audits auto_detach', async () => {
    const manual = await importCharacter(await makeServer(1));
    const alice = await memberToken(testApp, 'alice');
    await testApp.request.post(claimUrl(manual)).set(auth(alice));
    const aliceId = await userIdOf('alice');
    await testApp.db
      .update(schema.users)
      .set({ steamId: STEAM })
      .where(eq(schema.users.id, aliceId));
    const auto = await importCharacter(await makeServer(2));
    expect((await profile(auto)).claimSource).toBe('auto');
    await deleteUserTransaction(testApp.db, aliceId, testApp.seed.adminUser.id);
    const gone = await testApp.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, aliceId));
    expect(gone).toHaveLength(0);
    for (const id of [manual, auto]) {
      const [p] = nonEmpty(
        await testApp.db.select().from(P).where(eq(P.id, id)),
        'profile after delete',
      );
      expect(p).toMatchObject({
        claimedBy: null,
        claimSource: null,
        claimedAt: null,
      });
      const detach = (await audit(id)).filter(
        (e) => e.action === 'auto_detach',
      );
      expect(detach).toEqual([
        expect.objectContaining({ actorUserId: null, toUserId: null }),
      ]);
    }
  });
});

describe('Valheim armory route guards (ROK-1835 T17, ids)', () => {
  it('every armory route answers 403 while the Valheim plugin is inactive', async () => {
    const id = await importCharacter(await makeServer(1));
    const member = await memberToken(testApp, 'alice');
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    await registry().deactivate(VALHEIM_PLUGIN_ID);
    const base = '/plugins/valheim/armory/characters';
    const adminBase = '/admin/plugins/valheim/armory/characters';
    const calls = [
      testApp.request.get(base).set(auth(member)),
      testApp.request.get(`${base}/${id}`).set(auth(member)),
      testApp.request.get(`${base}/${id}/maps/1`).set(auth(member)),
      testApp.request.post(claimUrl(id)).set(auth(member)),
      testApp.request.get(adminBase).set(auth(admin)),
      testApp.request.put(ownerUrl(id)).set(auth(admin)).send({ userId: null }),
      testApp.request.get(`${adminBase}/${id}/claim-events`).set(auth(admin)),
    ];
    const codes = (await Promise.all(calls)).map((r) => r.status);
    expect(codes).toEqual([403, 403, 403, 403, 403, 403, 403]);
    expect(await profile(id)).toEqual({ claimedBy: null, claimSource: null });
  });

  it('path ids <= 0 or above int4 are 400, not 404/500', async () => {
    const member = await memberToken(testApp, 'alice');
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    for (const bad of ['0', '-1', '99999999999', '1.5']) {
      const codes = await Promise.all([
        testApp.request
          .get(`/plugins/valheim/armory/characters/${bad}`)
          .set(auth(member)),
        testApp.request
          .get(`/plugins/valheim/armory/characters/1/maps/${bad}`)
          .set(auth(member)),
        testApp.request.post(claimUrl(Number(bad))).set(auth(member)),
        testApp.request
          .get(`/admin/plugins/valheim/armory/characters/${bad}/claim-events`)
          .set(auth(admin)),
      ]);
      expect(codes.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    }
  });
});
