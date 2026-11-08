/**
 * ROK-2136 — `/plugins/wow/guilds/:id/ingame-text` against a real database:
 * the read/write permission matrix (admin, granted editor, plain member,
 * non-member, anonymous), 404 for a non-`wow_guild` hub, caps + control
 * characters (400), normalisation, per-field attribution and the 409, the
 * upsert when the guild has no profile row, and the user-wipe SET NULL.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-11-08T20:00:00.000Z');
const BASE = '/plugins/wow/guilds';

type Who = 'deleg' | 'plain' | 'outsider';
type Actor = Who | 'admin';

let testApp: TestApp;
let guildId: number;
let communityId: number;
const tokens = {} as Record<Actor, string>;

async function insertGuild(
  name: string,
  kind: 'wow_guild' | 'game_community',
): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind,
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

/** A local-login user with a character; a member row unless an outsider. */
async function seedUser(who: Who): Promise<number | null> {
  const email = `${who}@guild-ingame-text.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `ingame-${who}`,
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
  const guid = `Player-1-ingame-${who}`;
  await testApp.db.insert(schema.characters).values({
    userId: user.id,
    gameId: testApp.seed.game.id,
    name: `ingame${who}`,
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
        characterName: `ingame${who}`,
        rankIndex: 3,
        rankName: 'Rank 3',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  return member.id;
}

const path = (id: number) => `${BASE}/${id}/ingame-text`;
const get = (who: Actor, id = guildId) =>
  testApp.request.get(path(id)).set('Authorization', `Bearer ${tokens[who]}`);
const put = (who: Actor, body: object, id = guildId) =>
  testApp.request
    .put(path(id))
    .set('Authorization', `Bearer ${tokens[who]}`)
    .send(body);

const body = (over: object = {}) => ({
  motd: '',
  info: '',
  baseMotdUpdatedAt: null,
  baseInfoUpdatedAt: null,
  ...over,
});

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Ingame Keepers', 'wow_guild');
  communityId = await insertGuild('Ingame Community', 'game_community');
  const delegMember = await seedUser('deleg');
  await seedUser('plain');
  await seedUser('outsider');
  await testApp.db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId: delegMember });
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

/** Randomized order: every test starts with no profile row for the guild. */
beforeEach(async () => {
  await testApp.db
    .delete(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
});

describe('GET ingame-text (AC2/AC3)', () => {
  it('a plain member reads null fields and cannot edit', async () => {
    const res = await get('plain');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      guildId,
      motd: null,
      info: null,
      viewer: { canEdit: false },
    });
  });

  it('an editor and admin read canEdit true', async () => {
    expect((await get('deleg')).body.viewer).toEqual({ canEdit: true });
    expect((await get('admin')).body.viewer).toEqual({ canEdit: true });
  });

  it('a non-member is 403 and anonymous is 401', async () => {
    expect((await get('outsider')).status).toBe(403);
    expect((await testApp.request.get(path(guildId))).status).toBe(401);
  });

  it('a non-wow_guild hub is 404; an unknown id is 403 for a member, 404 for staff', async () => {
    expect((await get('admin', communityId)).status).toBe(404);
    expect((await get('plain', 999_999)).status).toBe(403);
    expect((await get('admin', 999_999)).status).toBe(404);
  });
});

describe('PUT ingame-text — permission, limits, normalisation', () => {
  it('a member without canEdit is 403 (AC4)', async () => {
    expect((await put('plain', body({ motd: 'x' }))).status).toBe(403);
  });

  it('an editor writes with no profile row yet, and admin can write (AC4)', async () => {
    const res = await put('deleg', body({ motd: 'Raid tonight' }));
    expect(res.status).toBe(200);
    expect(res.body.motd).toMatchObject({
      text: 'Raid tonight',
      updatedBy: 'ingame-deleg',
    });
    const admin = await put(
      'admin',
      body({ motd: 'Raid tonight', info: 'Be nice' }),
    );
    expect(admin.status).toBe(200);
    expect(admin.body.info).toMatchObject({ text: 'Be nice' });
  });

  it('rejects 256 / 500 characters and stores 255 / 499 unchanged (AC5)', async () => {
    expect((await put('admin', body({ motd: 'm'.repeat(256) }))).status).toBe(
      400,
    );
    expect((await put('admin', body({ info: 'i'.repeat(500) }))).status).toBe(
      400,
    );
    const res = await put(
      'admin',
      body({ motd: 'm'.repeat(255), info: 'i'.repeat(499) }),
    );
    expect(res.status).toBe(200);
    expect(res.body.motd.text).toBe('m'.repeat(255));
    expect(res.body.info.text).toBe('i'.repeat(499));
  });

  it('normalises CRLF + trailing whitespace, keeps a leading space (AC6)', async () => {
    const res = await put(
      'admin',
      body({ motd: 'Raid tonight  \r\nBring flasks  ', info: ' Indented' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.motd.text).toBe('Raid tonight\nBring flasks');
    expect(res.body.info.text).toBe(' Indented');
  });

  it('a body that normalises to empty clears the field (AC6)', async () => {
    const first = await put('admin', body({ motd: 'Set' }));
    const res = await put(
      'admin',
      body({ motd: '  ', baseMotdUpdatedAt: first.body.motd.updatedAt }),
    );
    expect(res.status).toBe(200);
    expect(res.body.motd).toBeNull();
  });
});

describe('PUT ingame-text — rejections', () => {
  it('a control character is 400 naming the field (AC7)', async () => {
    const res = await put('admin', body({ info: 'bell\u0007' }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('info');
  });

  it('a non-wow_guild hub is 404 for a write', async () => {
    expect((await put('admin', body({ motd: 'x' }), communityId)).status).toBe(
      404,
    );
  });
});

describe('PUT ingame-text — attribution and conflicts (AC8/AC9)', () => {
  it('stamps only the changed field; an unchanged PUT bumps nothing', async () => {
    const first = await put('deleg', body({ motd: 'M', info: 'I' }));
    const motd = first.body.motd as { updatedAt: string };
    const info = first.body.info as { updatedAt: string };
    const second = await put(
      'admin',
      body({
        motd: 'M',
        info: 'I2',
        baseMotdUpdatedAt: motd.updatedAt,
        baseInfoUpdatedAt: info.updatedAt,
      }),
    );
    expect(second.status).toBe(200);
    expect(second.body.motd).toEqual(first.body.motd);
    expect(second.body.info.updatedBy).not.toBe('ingame-deleg');
    expect(second.body.info.updatedAt).not.toBe(info.updatedAt);
    const noop = await put(
      'admin',
      body({
        motd: 'M',
        info: 'I2',
        baseMotdUpdatedAt: motd.updatedAt,
        baseInfoUpdatedAt: second.body.info.updatedAt,
      }),
    );
    expect(noop.status).toBe(200);
    expect(noop.body).toEqual(second.body);
  });

  it('409 with the current text when a changed field moved since load', async () => {
    const a = await put('deleg', body({ motd: 'A wrote this' }));
    const res = await put('admin', body({ motd: 'B overwrites' }));
    expect(res.status).toBe(409);
    expect(res.body.ingameText.motd).toEqual(a.body.motd);
  });

  it("per field: B saving only Info with a stale MOTD token is 200 and keeps A's MOTD", async () => {
    const loaded = await put('admin', body({ motd: 'Old motd' }));
    const staleMotd = loaded.body.motd.updatedAt as string;
    const a = await put(
      'deleg',
      body({ motd: 'A wrote this', baseMotdUpdatedAt: staleMotd }),
    );
    expect(a.status).toBe(200);
    // What the dialog sends when only Info was edited: the MOTD is omitted.
    const res = await put('admin', { info: 'B', baseInfoUpdatedAt: null });
    expect(res.status).toBe(200);
    expect(res.body.motd).toEqual(a.body.motd);
    expect(res.body.info.text).toBe('B');
    // Re-sending the stale MOTD (the pre-fix body) is still a 409.
    const stale = await put('admin', {
      motd: 'Old motd',
      baseMotdUpdatedAt: staleMotd,
      info: 'B2',
      baseInfoUpdatedAt: res.body.info.updatedAt,
    });
    expect(stale.status).toBe(409);
  });
});

describe('PUT ingame-text — no stray profile rows', () => {
  const profileRows = () =>
    testApp.db
      .select({ id: schema.guildProfiles.guildId })
      .from(schema.guildProfiles)
      .where(eq(schema.guildProfiles.guildId, guildId));

  it('a no-op save on a guild with no profile row leaves no row', async () => {
    expect(await profileRows()).toHaveLength(0);
    const res = await put('admin', body());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ motd: null, info: null });
    expect(await profileRows()).toHaveLength(0);
    expect((await put('admin', {})).status).toBe(200);
    expect(await profileRows()).toHaveLength(0);
  });

  it('the first real change creates the row', async () => {
    expect((await put('deleg', body({ info: 'First' }))).status).toBe(200);
    expect(await profileRows()).toHaveLength(1);
  });
});

describe('user wipe (AC10)', () => {
  it('deleting the editing user keeps the text and nulls updatedBy', async () => {
    const [temp] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: 'local:ingame-temp', username: 'ingame-temp' })
        .returning(),
      'temp user',
    );
    await testApp.db.insert(schema.guildProfiles).values({
      guildId,
      ingameMotd: 'Left behind',
      ingameMotdUpdatedAt: SNAP,
      ingameMotdUpdatedBy: temp.id,
    });
    expect((await get('plain')).body.motd.updatedBy).toBe('ingame-temp');
    await testApp.db.delete(schema.users).where(eq(schema.users.id, temp.id));
    const res = await get('plain');
    expect(res.body.motd).toEqual({
      text: 'Left behind',
      updatedAt: SNAP.toISOString().replace('.000Z', '.000000Z'),
      updatedBy: null,
    });
  });
});
