/**
 * ROK-2137 — "Changed in game" on `/plugins/wow/guilds/:id/ingame-text`
 * against a real database: the editor-only `game` block and its
 * `changedInGame` rule, Adopt (`POST :field/adopt`, through the ROK-2136
 * save) and Push (`POST :field/push`, acknowledge), the 403/404/409/400
 * guards. Reports are seeded straight into the `game_*` columns — ingest is
 * covered by `addon-import-guild-game-text.integration.spec.ts`.
 */
import * as bcrypt from 'bcrypt';
import { applyGuildGameText } from '../addon-import/addon-import-guild.game-text';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-11-08T20:00:00.000Z');
const T1 = new Date('2026-11-08T21:00:00.000Z');
const T2 = new Date('2026-11-08T22:00:00.000Z');
const T3 = new Date('2026-11-08T23:00:00.000Z');
const BASE = '/plugins/wow/guilds';

type Who = 'deleg' | 'plain';
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

/** A local-login guild member with a character; returns the member id. */
async function seedMember(who: Who): Promise<number> {
  const email = `${who}@guild-game-text.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `gt-${who}`,
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
  const guid = `Player-1-gametext-${who}`;
  await testApp.db.insert(schema.characters).values({
    userId: user.id,
    gameId: testApp.seed.game.id,
    name: `gametext${who}`,
    addonGuid: guid,
    role: 'dps',
    isMain: true,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
  const [member] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: `gametext${who}`,
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

const path = (id: number, suffix = '') => `${BASE}/${id}/ingame-text${suffix}`;
const auth = (who: Actor) => `Bearer ${tokens[who]}`;
const get = (who: Actor, id = guildId) =>
  testApp.request.get(path(id)).set('Authorization', auth(who));
/** Review r1 — what the editor saw: the field's hub token + report stamp. */
async function seenBody(suffix: string, id: number): Promise<object> {
  const field = suffix.startsWith('/info') ? 'info' : 'motd';
  const res = await get('admin', id);
  return {
    baseUpdatedAt: res.body[field]?.updatedAt ?? null,
    gameReportedAt: res.body.game?.[field]?.gameReportedAt ?? T1.toISOString(),
  };
}
const post = async (who: Actor, suffix: string, id = guildId, body?: object) =>
  testApp.request
    .post(path(id, suffix))
    .set('Authorization', auth(who))
    .send(body ?? (await seenBody(suffix, id)));
const put = (who: Actor, body: object) =>
  testApp.request.put(path(guildId)).set('Authorization', auth(who)).send(body);

/** The hub's own text (ROK-2136 columns); upserts the profile row. */
async function setHub(motd: string | null, info: string | null = null) {
  const values = {
    ingameMotd: motd,
    ingameMotdUpdatedAt: motd === null ? null : SNAP,
    ingameInfo: info,
    ingameInfoUpdatedAt: info === null ? null : SNAP,
  };
  await testApp.db
    .insert(schema.guildProfiles)
    .values({ guildId, ...values })
    .onConflictDoUpdate({ target: schema.guildProfiles.guildId, set: values });
}

/** A MOTD report as `applyGuildGameText` stores it (null text = empty box). */
async function reportMotd(text: string | null, at: Date) {
  const values = { gameMotd: text, gameMotdReportedAt: at };
  await testApp.db
    .insert(schema.guildProfiles)
    .values({ guildId, ...values })
    .onConflictDoUpdate({ target: schema.guildProfiles.guildId, set: values });
}

async function motdChanged(who: Actor = 'deleg'): Promise<boolean | undefined> {
  const res = await get(who);
  expect(res.status).toBe(200);
  return res.body.game?.motd?.changedInGame as boolean | undefined;
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Game Text Keepers', 'wow_guild');
  communityId = await insertGuild('Game Text Community', 'game_community');
  const delegMember = await seedMember('deleg');
  await seedMember('plain');
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

describe('GET — the editor-only game block', () => {
  it('an editor gets null reports when the game never reported', async () => {
    await setHub('Hub MOTD');
    const res = await get('deleg');
    expect(res.status).toBe(200);
    expect(res.body.game).toEqual({ motd: null, info: null });
  });

  it('a report that differs from the hub text is changedInGame for editor + admin', async () => {
    await setHub('Raid at 8');
    await reportMotd('Raid at 9', T1);
    const res = await get('deleg');
    expect(res.body.game.motd).toEqual({
      gameText: 'Raid at 9',
      gameReportedAt: '2026-11-08T21:00:00.000000Z',
      changedInGame: true,
    });
    expect(await motdChanged('admin')).toBe(true);
  });

  it('a plain member gets no game key at all', async () => {
    await setHub('Raid at 8');
    await reportMotd('Raid at 9', T1);
    const res = await get('plain');
    expect(res.status).toBe(200);
    expect(res.body.viewer.canEdit).toBe(false);
    expect('game' in res.body).toBe(false);
  });

  it('a report equal to the hub text is not changed', async () => {
    await setHub('Raid at 9');
    await reportMotd('Raid at 9', T1);
    expect(await motdChanged()).toBe(false);
  });

  it('a reported-empty box vs hub text is changed with gameText ""', async () => {
    await setHub('Raid at 8');
    await reportMotd(null, T1);
    const res = await get('deleg');
    expect(res.body.game.motd.gameText).toBe('');
    expect(res.body.game.motd.changedInGame).toBe(true);
  });

  it('reported empty and no hub text is not changed', async () => {
    await reportMotd(null, T1);
    expect(await motdChanged()).toBe(false);
  });

  it('a hub edit hides the banner only when it then equals the report', async () => {
    await setHub('Raid at 8');
    await reportMotd('Raid at 9', T1);
    const base = (await get('deleg')).body.motd.updatedAt as string;
    const other = await put('deleg', {
      motd: 'Raid at 10',
      baseMotdUpdatedAt: base,
    });
    expect(other.status).toBe(200);
    expect(other.body.game.motd.changedInGame).toBe(true);
    const same = await put('deleg', {
      motd: 'Raid at 9',
      baseMotdUpdatedAt: other.body.motd.updatedAt as string,
    });
    expect(same.body.game.motd.changedInGame).toBe(false);
  });
});

describe('POST :field/adopt', () => {
  it('copies the report into the hub text (attributed) and clears the banner', async () => {
    await setHub('Raid at 8');
    await reportMotd('Raid at 9', T1);
    const res = await post('deleg', '/motd/adopt');
    expect(res.status).toBe(200);
    expect(res.body.motd.text).toBe('Raid at 9');
    expect(res.body.motd.updatedBy).toBe('gt-deleg');
    expect(res.body.game.motd.changedInGame).toBe(false);
    expect(await motdChanged()).toBe(false);
  });

  it('works with no hub text yet, and a reported-empty box clears the field', async () => {
    await reportMotd('First MOTD', T1);
    expect((await post('admin', '/motd/adopt')).body.motd.text).toBe(
      'First MOTD',
    );
    await reportMotd(null, T2);
    const cleared = await post('admin', '/motd/adopt');
    expect(cleared.status).toBe(200);
    expect(cleared.body.motd).toBeNull();
    expect(cleared.body.game.motd.changedInGame).toBe(false);
  });

  it('409 NO_GAME_REPORT when the field was never reported; hub untouched', async () => {
    await setHub('Raid at 8');
    const res = await post('deleg', '/info/adopt');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_GAME_REPORT');
    expect((await get('deleg')).body.motd.text).toBe('Raid at 8');
  });
});

describe('POST :field/push', () => {
  it('hides the banner, keeps the hub text, until a NEWER differing report', async () => {
    await setHub('Raid at 8');
    await reportMotd('Raid at 9', T1);
    const res = await post('deleg', '/motd/push');
    expect(res.status).toBe(200);
    expect(res.body.motd.text).toBe('Raid at 8');
    expect(res.body.game.motd).toMatchObject({
      gameText: 'Raid at 9',
      changedInGame: false,
    });
    await reportMotd('Raid at 9', T1);
    expect(await motdChanged()).toBe(false);
    await reportMotd('Raid at 10', T2);
    expect(await motdChanged()).toBe(true);
  });

  it('409 NO_GAME_REPORT when the field was never reported', async () => {
    await setHub('Raid at 8');
    const res = await post('admin', '/motd/push');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_GAME_REPORT');
  });
});

describe('adopt / push guards', () => {
  it.each(['/motd/adopt', '/motd/push'])(
    '%s is 403 for a plain member and changes nothing',
    async (suffix) => {
      await setHub('Raid at 8');
      await reportMotd('Raid at 9', T1);
      expect((await post('plain', suffix)).status).toBe(403);
      expect(await motdChanged()).toBe(true);
      expect((await get('deleg')).body.motd.text).toBe('Raid at 8');
    },
  );

  it.each(['/motd/adopt', '/motd/push'])(
    '%s is 401 anonymous',
    async (suffix) => {
      expect((await testApp.request.post(path(guildId, suffix))).status).toBe(
        401,
      );
    },
  );

  it.each(['/ranks/adopt', '/ranks/push'])(
    '%s is 400 (unknown field)',
    async (suffix) => {
      expect((await post('admin', suffix)).status).toBe(400);
    },
  );

  it.each(['/motd/adopt', '/motd/push'])(
    '%s is 404 on a non-wow_guild hub',
    async (suffix) => {
      expect((await post('admin', suffix, communityId)).status).toBe(404);
    },
  );
});

describe('review r1 — Push lasts until the in-game text changes', () => {
  const ingest = (motd: string, at: Date, by: string) =>
    applyGuildGameText({ tx: testApp.db }, guildId, { motd }, at, by);

  it('a later export of the SAME text stays hidden; a changed text re-raises it', async () => {
    await setHub('Raid at 8');
    await ingest('Raid at 9', T1, 'Thrall');
    expect((await post('deleg', '/motd/push')).status).toBe(200);
    await ingest('Raid at 9  \r\n', T2, 'Jaina');
    const kept = (await get('deleg')).body.game.motd;
    expect(kept).toMatchObject({
      changedInGame: false,
      gameReportedBy: 'Thrall',
    });
    expect(new Date(kept.gameReportedAt).getTime()).toBe(T1.getTime());
    await ingest('Raid at 10', T3, 'Jaina');
    expect((await get('deleg')).body.game.motd).toMatchObject({
      gameText: 'Raid at 10',
      gameReportedBy: 'Jaina',
      changedInGame: true,
    });
  });
});

describe('review r1 — Adopt / Push check what the editor saw', () => {
  it.each(['/motd/adopt', '/motd/push'])(
    '%s is a 409 with fresh ingameText when the report moved on',
    async (suffix) => {
      await setHub('Raid at 8');
      await reportMotd('Raid at 9', T2);
      const res = await post('deleg', suffix, guildId, {
        baseUpdatedAt: null,
        gameReportedAt: T1.toISOString(),
      });
      expect(res.status).toBe(409);
      expect(res.body.ingameText.motd.text).toBe('Raid at 8');
      expect(res.body.ingameText.game.motd).toMatchObject({
        gameText: 'Raid at 9',
        changedInGame: true,
      });
    },
  );

  it('Adopt runs the save on the sent baseUpdatedAt: a stale hub token is its per-field 409', async () => {
    await setHub('Raid at 8');
    await reportMotd('Raid at 9', T1);
    const res = await post('deleg', '/motd/adopt', guildId, {
      baseUpdatedAt: T3.toISOString(),
      gameReportedAt: T1.toISOString(),
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Guild text changed');
    expect(res.body.ingameText.motd.text).toBe('Raid at 8');
  });

  it.each(['/motd/adopt', '/motd/push'])(
    '%s is a 400 without gameReportedAt',
    async (suffix) => {
      await reportMotd('Raid at 9', T1);
      const res = await post('deleg', suffix, guildId, { baseUpdatedAt: null });
      expect(res.status).toBe(400);
    },
  );
});
