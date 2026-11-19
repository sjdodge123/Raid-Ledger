/**
 * ROK-1813 — the opt-in public guild card against a real database.
 * AC1: off by default; only `canEdit` toggles (member / non-member / GM-only
 * → 403; editor grant + admin → 200); non-`wow_guild` → 404. AC2: signed-out
 * 200 when on; ONE identical 404 for off, unknown, malformed, hidden,
 * non-wow, deleted and `wow-common` inactive. AC3: `noindex` + `no-store`;
 * the body is the D5 allow-list (no member name, id, note). AC4: rounding.
 * AC5: closed headline, http apply → null. The slug survives off → on.
 * No afterAll truncate (shared pool).
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { GuildRecruitment } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { loginAsAdmin } from '../../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { upsertRecruitment } from '../guild-recruitment.queries';

const SNAP = new Date('2026-11-19T20:00:00.000Z');
const PUBLIC = '/plugins/wow/public-guild-cards';
const NOTE = 'PrivateNoteXyz';

/** gm0 rank-0 GUID (GM, no grant); r1 rank-1 member; deleg member editor grant; outsider no row. */
type Who = 'gm0' | 'r1' | 'deleg' | 'outsider';
type Actor = Who | 'admin';
const RANK: Record<Who, number | null> = {
  gm0: 0,
  r1: 1,
  deleg: 3,
  outsider: null,
};
const WHO: readonly Who[] = ['gm0', 'r1', 'deleg', 'outsider'];

let testApp: TestApp;
let guildId: number;
let communityId: number;
const tokens = new Map<Actor, string>();
const memberIds: Partial<Record<Who, number>> = {};
let editorUserId: number;

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
        memberCount: kind === 'wow_guild' ? 143 : 0,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function seedLogin(who: Who): Promise<number> {
  const email = `${who}@guild-public-card.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `pc-${who}`,
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
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token: unknown = res.body.access_token;
  if (typeof token !== 'string') throw new Error(`no access_token for ${who}`);
  tokens.set(who, token);
  return user.id;
}

/** The user's GUID-linked character + (unless `outsider`) a live roster row. */
async function seedUser(who: Who): Promise<void> {
  const userId = await seedLogin(who);
  if (who === 'deleg') editorUserId = userId;
  const guid = `Player-1-pc-${who}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: `pcchar${who}`,
    region: 'us',
    addonGuid: guid,
    role: 'dps',
    isMain: true,
  });
  const rank = RANK[who];
  if (rank === null) return;
  const [member] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: `pcchar${who}`,
        rankIndex: rank,
        rankName: `Rank ${rank}`,
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  memberIds[who] = member.id;
}

const settingsPath = (id: number): string =>
  `/plugins/wow/guilds/${id}/public-card`;
const auth = (who: Actor): string =>
  `Bearer ${defined(tokens.get(who), `token for ${who}`)}`;
const getSettings = (who: Actor, id = guildId) =>
  testApp.request.get(settingsPath(id)).set('Authorization', auth(who));
const patch = (who: Actor, enabled: boolean, id = guildId) =>
  testApp.request
    .patch(settingsPath(id))
    .set('Authorization', auth(who))
    .send({ enabled });
const readPublic = (slug: string) => testApp.request.get(`${PUBLIC}/${slug}`);
const plugins = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);

/** Turn the card on as admin; returns the slug. */
async function enable(id = guildId): Promise<string> {
  const res = await patch('admin', true, id);
  expect(res.status).toBe(200);
  const slug: unknown = res.body.slug;
  if (typeof slug !== 'string') throw new Error('enable returned no slug');
  return slug;
}

const RECRUITMENT: GuildRecruitment = {
  recruiting: false,
  wanted: [
    { className: 'Priest', role: 'healer', state: 'open', note: NOTE },
    { className: 'Druid', role: 'tank', state: 'limited' },
  ],
  applyUrl: 'http://example.com/apply',
};

beforeAll(async () => {
  testApp = await getTestApp();
  await plugins().ensureInstalled(WOW_COMMON_MANIFEST.id);
  await plugins().activate(WOW_COMMON_MANIFEST.id);
  guildId = await insertGuild('Public Card Keepers', 'wow_guild');
  communityId = await insertGuild('Public Card Community', 'game_community');
  for (const who of WHO) await seedUser(who);
  await testApp.db.insert(schema.guildEditors).values({
    guildId,
    kind: 'member',
    guildMemberId: defined(memberIds.deleg, 'deleg member'),
  });
  tokens.set('admin', await loginAsAdmin(testApp.request, testApp.seed));
});

/** Randomized order: every test starts with no profile row, visible, 143 members. */
beforeEach(async () => {
  await testApp.db
    .delete(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
  await testApp.db
    .update(schema.guilds)
    .set({ hiddenAt: null, memberCount: 143 })
    .where(eq(schema.guilds.id, guildId));
});

describe('AC1 — off by default; canEdit-only toggle', () => {
  it('a new guild reads enabled:false, slug:null', async () => {
    const res = await getSettings('admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, slug: null });
  });

  it('a pre-existing profile row (recruitment saved) still reads off', async () => {
    await upsertRecruitment(
      testApp.db,
      guildId,
      RECRUITMENT,
      editorUserId,
      SNAP,
    );
    expect((await getSettings('admin')).body).toEqual({
      enabled: false,
      slug: null,
    });
  });

  it.each<Who>(['r1', 'outsider', 'gm0'])(
    '%s (member / non-member / GM without an editor grant) → 403 on GET + PATCH',
    async (who) => {
      expect((await getSettings(who)).status).toBe(403);
      expect((await patch(who, true)).status).toBe(403);
      expect((await getSettings('admin')).body.enabled).toBe(false);
    },
  );

  it.each<Actor>(['deleg', 'admin'])(
    '%s (canEdit) → 200 and a 16-char base62 slug',
    async (who) => {
      const res = await patch(who, true);
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.slug).toMatch(/^[A-Za-z0-9]{16}$/);
    },
  );

  it('a community hub → 404 (wow_guild only)', async () => {
    expect((await patch('admin', true, communityId)).status).toBe(404);
    expect((await getSettings('admin', communityId)).status).toBe(404);
  });

  it('a body other than {enabled:boolean} → 400', async () => {
    const res = await testApp.request
      .patch(settingsPath(guildId))
      .set('Authorization', auth('admin'))
      .send({ enabled: true, slug: 'AAAAAAAAAAAAAAAA' });
    expect(res.status).toBe(400);
  });

  it('off → on keeps the same slug (D1); off keeps it on the settings read', async () => {
    const slug = await enable();
    const off = await patch('admin', false);
    expect(off.body).toEqual({ enabled: false, slug });
    expect(await enable()).toBe(slug);
  });
});

describe('AC2/AC3 — signed-out read', () => {
  it('on → 200 with no Authorization header, noindex + no-store', async () => {
    const res = await readPublic(await enable());
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('every miss is the SAME 404 body, with the headers', async () => {
    const slug = await enable();
    const misses: unknown[] = [];
    const miss = async (s: string): Promise<void> => {
      const res = await readPublic(s);
      expect(res.status).toBe(404);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['cache-control']).toBe('no-store');
      misses.push(res.body);
    };
    await miss('ZZZZZZZZZZZZZZZZ'); // unknown
    await miss('not-a-slug!'); // malformed
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: SNAP })
      .where(eq(schema.guilds.id, guildId));
    await miss(slug); // hidden
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: null })
      .where(eq(schema.guilds.id, guildId));
    await plugins().deactivate(WOW_COMMON_MANIFEST.id);
    try {
      await miss(slug); // plugin inactive
    } finally {
      await plugins().activate(WOW_COMMON_MANIFEST.id);
    }
    expect((await readPublic(slug)).status).toBe(200);
    await patch('admin', false);
    await miss(slug); // off
    expect(misses).toHaveLength(5);
    for (const body of misses) expect(body).toEqual(misses[0]);
    expect(misses[0]).toMatchObject({ message: 'Not found' });
  });

  it('a non-wow hub with an enabled slug row → 404', async () => {
    const slug = 'CommunityCard001';
    await testApp.db
      .insert(schema.guildProfiles)
      .values({
        guildId: communityId,
        publicCardEnabled: true,
        publicCardSlug: slug,
      })
      .onConflictDoNothing();
    const res = await readPublic(slug);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'Not found' });
  });

  it('a deleted guild → 404', async () => {
    const goneId = await insertGuild('Public Card Gone', 'wow_guild');
    const slug = await enable(goneId);
    expect((await readPublic(slug)).status).toBe(200);
    await testApp.db.delete(schema.guilds).where(eq(schema.guilds.id, goneId));
    expect((await readPublic(slug)).status).toBe(404);
  });
});

describe('AC3/AC4/AC5 — the body is the D5 allow-list', () => {
  it('exact fields; rounded 143 → 140; closed; no note; http apply → null', async () => {
    await upsertRecruitment(
      testApp.db,
      guildId,
      RECRUITMENT,
      editorUserId,
      SNAP,
    );
    const res = await readPublic(await enable());
    expect(res.body).toEqual({
      name: 'Public Card Keepers',
      region: 'us',
      realmName: null,
      gameName: testApp.seed.game.name,
      approxMemberCount: 140,
      recruitment: {
        state: 'closed',
        wanted: [
          { className: 'Priest', role: 'healer', state: 'open' },
          { className: 'Druid', role: 'tank', state: 'limited' },
        ],
        applyUrl: null,
      },
    });
  });

  it('deep scan: no member name, username, character, guild id or note', async () => {
    await upsertRecruitment(
      testApp.db,
      guildId,
      RECRUITMENT,
      editorUserId,
      SNAP,
    );
    const text = JSON.stringify((await readPublic(await enable())).body);
    for (const who of WHO) {
      expect(text).not.toContain(`pcchar${who}`);
      expect(text).not.toContain(`pc-${who}`);
      expect(text).not.toContain(`Player-1-pc-${who}`);
    }
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain('"id"');
  });

  it('fewer than 10 members → approxMemberCount null; unset recruitment → null', async () => {
    await testApp.db
      .update(schema.guilds)
      .set({ memberCount: 7 })
      .where(eq(schema.guilds.id, guildId));
    const res = await readPublic(await enable());
    expect(res.body.approxMemberCount).toBeNull();
    expect(res.body.recruitment).toBeNull();
  });

  it('https apply URL survives while recruiting', async () => {
    await upsertRecruitment(
      testApp.db,
      guildId,
      { ...RECRUITMENT, recruiting: true, applyUrl: 'https://example.com/a' },
      editorUserId,
      SNAP,
    );
    const res = await readPublic(await enable());
    expect(res.body.recruitment.state).toBe('open');
    expect(res.body.recruitment.applyUrl).toBe('https://example.com/a');
  });
});
