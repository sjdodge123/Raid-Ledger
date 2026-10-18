/**
 * ROK-1831 L2a — the core hub routes at `guilds/:id` against a real database:
 * a WoW hub reads identically on the core path and the `plugins/wow` alias
 * (page + raids), `guilds/mine` lists it, and `PATCH :id/hidden` (admin only)
 * hides it from members (404) while staff still see it.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const WOW = '/plugins/wow/guilds';
const CORE = '/guilds';

type Who = 'member' | 'outsider' | 'admin';

let testApp: TestApp;
let guildId: number;
const tokens: Partial<Record<Who, string>> = {};

function token(who: Who): string {
  const t = tokens[who];
  if (t === undefined) throw new Error(`no token for ${who}`);
  return t;
}

async function insertHub(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

/** A local-login user; `member` also gets a linked live roster row. */
async function seedUser(who: 'member' | 'outsider'): Promise<void> {
  const email = `hub-${who}@hub.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `hub-${who}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  if (who === 'member') await linkMember(user.id);
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
}

async function linkMember(userId: number): Promise<void> {
  const guid = 'Player-1-hubmember';
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: 'Hubmember',
    addonGuid: guid,
    role: 'dps',
    isMain: true,
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: 'Hubmember',
    rankIndex: 2,
    rankName: 'Rank 2',
    source: 'addon_import',
    lastSeenAt: SNAP,
  });
}

const get = (path: string, who: Who) =>
  testApp.request.get(path).set('Authorization', `Bearer ${token(who)}`);

const hide = (hidden: boolean, who: Who) =>
  testApp.request
    .patch(`${CORE}/${guildId}/hidden`)
    .set('Authorization', `Bearer ${token(who)}`)
    .send({ hidden });

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertHub('Core Hub Keepers');
  await seedUser('member');
  await seedUser('outsider');
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  await hide(false, 'admin');
});

describe('GET guilds/:id and :id/raids — WoW alias parity', () => {
  it.each(['', '/raids'])('core %s matches the WoW alias', async (sub) => {
    const core = await get(`${CORE}/${guildId}${sub}`, 'member');
    const alias = await get(`${WOW}/${guildId}${sub}`, 'member');
    expect(core.status).toBe(200);
    expect(alias.status).toBe(200);
    expect(core.body).toEqual(alias.body);
  });

  it('the core page still refuses a non-member (403) and a missing hub (404)', async () => {
    expect((await get(`${CORE}/${guildId}`, 'outsider')).status).toBe(403);
    expect((await get(`${CORE}/999999`, 'admin')).status).toBe(404);
  });
});

describe('GET guilds/mine', () => {
  it('lists the hub with the WoW rank, same as the alias', async () => {
    const core = await get(`${CORE}/mine`, 'member');
    const alias = await get(`${WOW}/mine`, 'member');
    expect(core.status).toBe(200);
    expect(core.body).toEqual(alias.body);
    const ids = (core.body.guilds as { id: number }[]).map((g) => g.id);
    expect(ids).toContain(guildId);
  });

  it('drops a hidden hub for a member', async () => {
    expect((await hide(true, 'admin')).status).toBe(200);
    const res = await get(`${CORE}/mine`, 'member');
    const ids = (res.body.guilds as { id: number }[]).map((g) => g.id);
    expect(ids).not.toContain(guildId);
  });
});

describe('PATCH guilds/:id/hidden', () => {
  const READS = ['', '/raids', '/profile', '/discord'];

  it('admin hides: member 404 on every read (core + alias), admin still 200', async () => {
    expect((await hide(true, 'admin')).body).toEqual({ hidden: true });
    for (const sub of READS) {
      expect((await get(`${CORE}/${guildId}${sub}`, 'member')).status).toBe(
        404,
      );
      expect((await get(`${WOW}/${guildId}${sub}`, 'member')).status).toBe(404);
    }
    expect((await get(`${CORE}/${guildId}`, 'admin')).status).toBe(200);
    expect((await get(`${CORE}/${guildId}/raids`, 'admin')).status).toBe(200);
  });

  it('unhide restores the member view', async () => {
    await hide(true, 'admin');
    expect((await hide(false, 'admin')).body).toEqual({ hidden: false });
    expect((await get(`${CORE}/${guildId}`, 'member')).status).toBe(200);
  });

  it('non-admin gets 403; a bad body is 400; a missing hub is 404', async () => {
    expect((await hide(true, 'member')).status).toBe(403);
    const bad = await testApp.request
      .patch(`${CORE}/${guildId}/hidden`)
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ hidden: 'yes' });
    expect(bad.status).toBe(400);
    const missing = await testApp.request
      .patch(`${CORE}/999999/hidden`)
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ hidden: true });
    expect(missing.status).toBe(404);
  });
});

describe('literal routes stay ahead of :id', () => {
  it('guilds/onboarding is not swallowed by guilds/:id', async () => {
    expect((await get(`${CORE}/onboarding`, 'member')).status).toBe(200);
  });
});

describe('ROK-1831 fix r1 — staff hidden flag + WoW alias hidden checks', () => {
  const ids = (body: { guilds: { id: number }[] }) =>
    body.guilds.map((g) => g.id);

  it('admin reads guild.hidden true after hide and false after unhide', async () => {
    await hide(true, 'admin');
    const hidden = await get(`${CORE}/${guildId}`, 'admin');
    expect(hidden.body.guild.hidden).toBe(true);
    await hide(false, 'admin');
    const shown = await get(`${CORE}/${guildId}`, 'admin');
    expect(shown.body.guild.hidden).toBe(false);
  });

  it('a hidden WoW hub 404s on every alias :id route for a member', async () => {
    await hide(true, 'admin');
    for (const sub of ['/editors', '/addons']) {
      expect((await get(`${WOW}/${guildId}${sub}`, 'member')).status).toBe(404);
    }
    const patch = await testApp.request
      .patch(`${WOW}/${guildId}/profile`)
      .set('Authorization', `Bearer ${token('member')}`)
      .send({});
    expect(patch.status).toBe(404);
    const add = await testApp.request
      .post(`${WOW}/${guildId}/editors`)
      .set('Authorization', `Bearer ${token('member')}`)
      .send({});
    expect(add.status).toBe(404);
  });

  it('a hidden WoW hub leaves the alias mine / directory / by-character for a member, not for admin', async () => {
    await hide(true, 'admin');
    const dir = `${WOW}?gameId=${testApp.seed.game.id}`;
    expect(ids((await get(`${WOW}/mine`, 'member')).body)).not.toContain(
      guildId,
    );
    expect(ids((await get(dir, 'member')).body)).not.toContain(guildId);
    expect(ids((await get(dir, 'admin')).body)).toContain(guildId);
    const [char] = nonEmpty(
      await testApp.db.select().from(schema.characters),
      'character',
    );
    const byChar = await get(`${WOW}/by-character/${char.id}`, 'member');
    expect(byChar.body).toEqual({ data: null });
    await hide(false, 'admin');
    const back = await get(`${WOW}/by-character/${char.id}`, 'member');
    expect(back.body.data.guild.id).toBe(guildId);
  });
});

describe('ROK-1831 fix r1b — guilds/mine across kinds', () => {
  const PELICAN = 'pelican';

  afterAll(async () => {
    const registry = testApp.app.get(PluginRegistryService);
    if (registry.isActive(PELICAN)) await registry.deactivate(PELICAN);
  });

  it('a WoW guild member who also joined a server hub gets both, the WoW rank intact', async () => {
    const registry = testApp.app.get(PluginRegistryService);
    await registry.ensureInstalled(PELICAN);
    await registry.activate(PELICAN);
    const [hub] = nonEmpty(
      await testApp.db
        .insert(schema.guilds)
        .values({
          gameId: testApp.seed.game.id,
          kind: 'game_server',
          region: 'server',
          name: 'Valheim Main',
          nameKey: 'valheim main',
          source: 'pelican',
        })
        .returning(),
      'server hub',
    );
    const [user] = nonEmpty(
      await testApp.db.select().from(schema.users).where(eq(schema.users.username, 'hub-member')),
      'member user',
    );
    await testApp.db.insert(schema.hubServerMembers).values({
      guildId: hub.id,
      userId: user.id,
      source: 'manual',
      joinedAt: new Date(),
    });
    const res = await get(`${CORE}/mine`, 'member');
    expect(res.status).toBe(200);
    const byId = new Map(
      (res.body.guilds as { id: number; kind: string; rankIndex: number | null; rankName: string | null }[]).map(
        (g) => [g.id, g],
      ),
    );
    expect(byId.get(guildId)).toMatchObject({ kind: 'wow_guild', rankIndex: 2, rankName: 'Rank 2' });
    expect(byId.get(hub.id)).toMatchObject({ kind: 'game_server', rankIndex: null, rankName: null });
  });
});
