/**
 * ROK-1786 — guild content endpoints against a real database: the permission
 * matrix (admin, granted editor, plain member, ungranted rank-0 GM, non-member)
 * on every route, the profile upsert + GM-post stamp, addon create / duplicate 409 / update /
 * delete / reorder, cross-guild writes denied, and `gmPostHeadline` on /mine.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const BASE = '/plugins/wow/guilds';
const CF = 'https://www.curseforge.com/wow/addons/details';
const WAGO = 'https://addons.wago.io/addons/weakauras';

type Who = 'deleg' | 'plain' | 'gm' | 'outsider';
type Actor = Who | 'admin';

let testApp: TestApp;
let guildId: number;
let otherGuildId: number;
let otherAddonId: number;
let firstId: number;
let secondId: number;
const tokens = {} as Record<Actor, string>;

async function insertGuild(name: string): Promise<number> {
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

/**
 * A local-login user with a character; a member row unless an outsider. The
 * `gm` sits at rank 0 with NO editor grant (`GM_RANK_IMPLIES_EDIT` is off).
 */
async function seedUser(who: Who): Promise<number | null> {
  const email = `${who}@guild-content.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `content-${who}`,
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
  const guid = `Player-1-content-${who}`;
  await testApp.db.insert(schema.characters).values({
    userId: user.id,
    gameId: testApp.seed.game.id,
    name: `content${who}`,
    addonGuid: guid,
    role: 'dps',
    isMain: true,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
  if (who === 'outsider') return null;
  const [member] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: `content${who}`,
        rankIndex: who === 'gm' ? 0 : 3,
        rankName: who === 'gm' ? 'Guild Master' : 'Rank 3',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  return member.id;
}

const call = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  who: Actor,
  body?: object,
) => {
  const req = testApp.request[method](`${BASE}${path}`).set(
    'Authorization',
    `Bearer ${tokens[who]}`,
  );
  return body ? req.send(body) : req;
};

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Content Keepers');
  otherGuildId = await insertGuild('Content Other');
  const delegMember = await seedUser('deleg');
  await seedUser('plain');
  await seedUser('gm');
  await seedUser('outsider');
  await testApp.db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId: delegMember });
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
  const [other] = nonEmpty(
    await testApp.db
      .insert(schema.guildRecommendedAddons)
      .values({
        guildId: otherGuildId,
        source: 'curseforge',
        slugOrUrl: 'dbm',
        displayName: 'DBM',
      })
      .returning(),
    'other addon',
  );
  otherAddonId = other.id;
});

/**
 * CI runs integration specs in randomized order, so every test starts from a
 * blank profile and an empty addon list for the main guild. The other guild's
 * single addon is never written by any test (all writes against it 403/404).
 */
beforeEach(async () => {
  await testApp.db
    .delete(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
  await testApp.db
    .delete(schema.guildRecommendedAddons)
    .where(eq(schema.guildRecommendedAddons.guildId, guildId));
});

/** Two addons via the API: CurseForge (required, editor) then Wago (admin). */
async function seedPair(): Promise<void> {
  const first = await call('post', `/${guildId}/addons`, 'deleg', {
    url: CF,
    requirement: 'required',
  });
  expect(first.status).toBe(201);
  firstId = first.body.id as number;
  const second = await call('post', `/${guildId}/addons`, 'admin', {
    url: WAGO,
  });
  expect(second.status).toBe(201);
  secondId = second.body.id as number;
}

describe('permission matrix', () => {
  it.each([
    ['admin', 200],
    ['deleg', 200],
    ['plain', 200],
    ['gm', 200],
    ['outsider', 403],
  ] as const)('reads: %s → %i', async (who, status) => {
    expect((await call('get', `/${guildId}/profile`, who)).status).toBe(status);
    expect((await call('get', `/${guildId}/addons`, who)).status).toBe(status);
  });

  it.each(['plain', 'gm', 'outsider'] as const)(
    'writes: %s → 403',
    async (who) => {
      const id = `/${guildId}`;
      const results = await Promise.all([
        call('patch', `${id}/profile`, who, { gmPost: 'x' }),
        call('post', `${id}/addons`, who, { url: CF }),
        call('patch', `${id}/addons/${otherAddonId}`, who, { note: 'x' }),
        call('delete', `${id}/addons/${otherAddonId}`, who),
        call('put', `${id}/addons/order`, who, { ids: [otherAddonId] }),
      ]);
      expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    },
  );

  it('401 without a token; admin gets 404 for a missing guild', async () => {
    const anon = await testApp.request.get(`${BASE}/${guildId}/profile`);
    expect(anon.status).toBe(401);
    expect((await call('get', '/999999/addons', 'admin')).status).toBe(404);
  });
});

describe('profile', () => {
  it('is empty before any edit', async () => {
    const res = await call('get', `/${guildId}/profile`, 'plain');
    expect(res.body).toEqual({ guildId, gmPost: null, rules: [], links: [] });
  });

  it('a granted editor upserts and stamps the GM post', async () => {
    const res = await call('patch', `/${guildId}/profile`, 'deleg', {
      gmPost: 'Raid Tuesday 8pm\nBring flasks',
      rules: [{ title: 'Loot', body: 'Council' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.gmPost).toMatchObject({
      body: 'Raid Tuesday 8pm\nBring flasks',
      updatedBy: 'content-deleg',
    });
    expect(res.body.rules).toEqual([{ title: 'Loot', body: 'Council' }]);
  });

  it('keeps the stamp when the post text is unchanged', async () => {
    const seeded = await call('patch', `/${guildId}/profile`, 'deleg', {
      gmPost: 'Raid Tuesday 8pm\nBring flasks',
    });
    expect(seeded.status).toBe(200);
    const before = await call('get', `/${guildId}/profile`, 'plain');
    const res = await call('patch', `/${guildId}/profile`, 'admin', {
      gmPost: 'Raid Tuesday 8pm\nBring flasks',
      links: [{ title: 'Web', links: [{ label: 'Site', url: CF }] }],
    });
    expect(res.status).toBe(200);
    expect(res.body.gmPost).toEqual(before.body.gmPost);
    expect(res.body.links).toHaveLength(1);
  });

  it('400 on an empty body', async () => {
    const res = await call('patch', `/${guildId}/profile`, 'admin', {});
    expect(res.status).toBe(400);
  });

  it('/mine carries the newest hub post headline (ROK-1868 D11)', async () => {
    // ROK-1868 A3: the GM post is written through POST /guilds/:id/posts now.
    const post = await testApp.request
      .post(`/guilds/${guildId}/posts`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ body: 'Mine headline\nSecond line', relayToDiscord: false });
    expect(post.status).toBe(201);
    const res = await call('get', '/mine', 'plain');
    const mine = (res.body.guilds as { id: number }[]).find(
      (g) => g.id === guildId,
    );
    expect(mine).toMatchObject({ gmPostHeadline: 'Mine headline' });
  });
});

describe('addons — write', () => {
  it('creates from a parsed link with a derived name', async () => {
    const res = await call('post', `/${guildId}/addons`, 'deleg', {
      url: CF,
      requirement: 'required',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      guildId,
      source: 'curseforge',
      slugOrUrl: 'details',
      displayName: 'Details',
      requirement: 'required',
      sortOrder: 0,
    });
    firstId = res.body.id as number;
    const second = await call('post', `/${guildId}/addons`, 'admin', {
      url: WAGO,
    });
    expect(second.body.sortOrder).toBe(1);
    secondId = second.body.id as number;
  });

  it('409 on a duplicate link; 400 on a malformed known host', async () => {
    await seedPair();
    const dup = await call('post', `/${guildId}/addons`, 'admin', {
      url: `${CF}#files`,
    });
    expect(dup.status).toBe(409);
    const bad = await call('post', `/${guildId}/addons`, 'admin', {
      url: 'https://www.curseforge.com/wow/other/details',
    });
    expect(bad.status).toBe(400);
  });

  it('updates fields; 409 when re-pointed at an existing link', async () => {
    await seedPair();
    const res = await call('patch', `/${guildId}/addons/${firstId}`, 'deleg', {
      note: 'Damage meter',
      flavor: 'retail',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ note: 'Damage meter', flavor: 'retail' });
    const clash = await call(
      'patch',
      `/${guildId}/addons/${secondId}`,
      'admin',
      {
        url: CF,
      },
    );
    expect(clash.status).toBe(409);
  });
});

describe('addons — order', () => {
  it('reorders the full set and rejects a mismatched one', async () => {
    await seedPair();
    const bad = await call('put', `/${guildId}/addons/order`, 'admin', {
      ids: [firstId, otherAddonId],
    });
    expect(bad.status).toBe(400);
    const res = await call('put', `/${guildId}/addons/order`, 'deleg', {
      ids: [secondId, firstId],
    });
    expect(res.status).toBe(200);
    const ids = (res.body.addons as { id: number }[]).map((a) => a.id);
    expect(ids).toEqual([secondId, firstId]);
  });
});

describe('addons — list, scope, delete', () => {
  it('lists pinned addons before the guild list', async () => {
    await seedPair();
    const res = await call('get', `/${guildId}/addons`, 'plain');
    expect(res.body.pinned[0]).toMatchObject({ requirement: 'required' });
    expect(res.body.addons).toHaveLength(2);
  });

  it('cross-guild addon ids are 404, and the other row survives', async () => {
    const path = `/${guildId}/addons/${otherAddonId}`;
    expect((await call('patch', path, 'admin', { note: 'x' })).status).toBe(
      404,
    );
    expect((await call('delete', path, 'deleg')).status).toBe(404);
    const other = await call('get', `/${otherGuildId}/addons`, 'admin');
    expect(other.body.addons).toHaveLength(1);
  });

  it('deletes within the guild', async () => {
    await seedPair();
    const path = `/${guildId}/addons/${firstId}`;
    expect((await call('delete', path, 'deleg')).status).toBe(204);
    expect((await call('delete', path, 'deleg')).status).toBe(404);
  });
});

describe('addons — concurrency', () => {
  it('two concurrent adds at 49 addons: exactly one passes the 50 cap', async () => {
    const capGuild = await insertGuild('Content Cap');
    await testApp.db.insert(schema.guildRecommendedAddons).values(
      Array.from({ length: 49 }, (_, i) => ({
        guildId: capGuild,
        source: 'curseforge' as const,
        slugOrUrl: `cap-${i}`,
        displayName: `Cap ${i}`,
        sortOrder: i,
      })),
    );
    const results = await Promise.all([
      call('post', `/${capGuild}/addons`, 'admin', { url: `${CF}-a` }),
      call('post', `/${capGuild}/addons`, 'admin', { url: `${CF}-b` }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const list = await call('get', `/${capGuild}/addons`, 'admin');
    expect(list.body.addons).toHaveLength(50);
  });
});
