/**
 * ROK-1789 (S5 part A) — `/plugins/wow/guilds/:id/recruitment` against a real
 * database: read = members + staff (403 before 404), write = editors OR the
 * GUID-linked rank-0 GM (ruling A1, the six rank-0 cases), validation (400),
 * the Closed switch keeping each row's state (AC3), DELETE back to unset
 * (AC7), the editor's username, and that a save never touches rules / links /
 * in-game text. No afterAll truncate (shared pool).
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import {
  GuildRecruitmentViewSchema,
  type GuildRecruitment,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-11-12T20:00:00.000Z');
const BEFORE_SNAP = new Date('2026-11-01T20:00:00.000Z');
const BASE = '/plugins/wow/guilds';

/** gm0 rank-0 GUID; r1 rank-1 GUID; bliz0 rank-0 Blizzard-id only; left0 rank-0 stale row; unlinked no row; deleg member grant. */
type Who = 'gm0' | 'r1' | 'bliz0' | 'left0' | 'unlinked' | 'deleg';
type Actor = Who | 'admin';

interface RowSpec {
  rank: number;
  link: 'guid' | 'blizzard' | 'none';
  lastSeenAt: Date;
}

const ROWS: Record<Who, RowSpec> = {
  gm0: { rank: 0, link: 'guid', lastSeenAt: SNAP },
  r1: { rank: 1, link: 'guid', lastSeenAt: SNAP },
  bliz0: { rank: 0, link: 'blizzard', lastSeenAt: SNAP },
  left0: { rank: 0, link: 'guid', lastSeenAt: BEFORE_SNAP },
  unlinked: { rank: 0, link: 'none', lastSeenAt: SNAP },
  deleg: { rank: 3, link: 'guid', lastSeenAt: SNAP },
};
const WHO: readonly Who[] = [
  'gm0',
  'r1',
  'bliz0',
  'left0',
  'unlinked',
  'deleg',
];

let testApp: TestApp;
let guildId: number;
let communityId: number;
const tokens = new Map<Actor, string>();
const memberIds: Partial<Record<Who, number>> = {};

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

/** A local-login user + token; returns the user id. */
async function seedLogin(who: Who): Promise<number> {
  const email = `${who}@guild-recruitment.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `rec-${who}`,
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

/** The user's character + (unless `unlinked`) a roster row it links to. */
async function seedUser(who: Who): Promise<void> {
  const userId = await seedLogin(who);
  const spec = ROWS[who];
  const guid = `Player-1-rec-${who}`;
  const blizzardId = 7_000_000 + WHO.indexOf(who);
  const byGuid = spec.link === 'guid' || spec.link === 'none';
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: `rec${who}`,
    region: 'us',
    addonGuid: byGuid ? guid : null,
    externalId: spec.link === 'blizzard' ? String(blizzardId) : null,
    role: 'dps',
    isMain: true,
  });
  if (spec.link === 'none') return;
  const [member] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid: spec.link === 'guid' ? guid : null,
        blizzardCharacterId: spec.link === 'blizzard' ? blizzardId : null,
        characterName: `rec${who}`,
        rankIndex: spec.rank,
        rankName: `Rank ${spec.rank}`,
        source: 'addon_import',
        lastSeenAt: spec.lastSeenAt,
      })
      .returning(),
    'member',
  );
  memberIds[who] = member.id;
}

const path = (id: number): string => `${BASE}/${id}/recruitment`;
const auth = (who: Actor): string =>
  `Bearer ${defined(tokens.get(who), `token for ${who}`)}`;
const get = (who: Actor, id = guildId) =>
  testApp.request.get(path(id)).set('Authorization', auth(who));
const put = (who: Actor, body: object, id = guildId) =>
  testApp.request.put(path(id)).set('Authorization', auth(who)).send(body);
const del = (who: Actor, id = guildId) =>
  testApp.request.delete(path(id)).set('Authorization', auth(who));

const VALID: GuildRecruitment = {
  recruiting: true,
  wanted: [
    { className: 'Priest', role: 'healer', state: 'open', note: '  Holy  ' },
    { className: 'Druid', role: 'tank', state: 'limited' },
    { className: 'Rogue', role: 'dps', state: 'closed' },
  ],
  applyUrl: 'https://example.com/apply',
};

const plugins = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);

beforeAll(async () => {
  testApp = await getTestApp();
  await plugins().ensureInstalled('blizzard');
  await plugins().activate('blizzard');
  guildId = await insertGuild('Recruit Keepers', 'wow_guild');
  communityId = await insertGuild('Recruit Community', 'game_community');
  for (const who of WHO) await seedUser(who);
  const delegMember = memberIds.deleg;
  if (delegMember === undefined) throw new Error('deleg member row missing');
  await testApp.db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId: delegMember });
  tokens.set('admin', await loginAsAdmin(testApp.request, testApp.seed));
});

/** Randomized order: every test starts with no profile row for the guild. */
beforeEach(async () => {
  await testApp.db
    .delete(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
});

describe('rank-0 GM edit right (ruling A1 / AC4b)', () => {
  it('rank-0 GUID-linked, no editor grant: GET canEdit, PUT 200, DELETE 204', async () => {
    const view = await get('gm0');
    expect(view.status).toBe(200);
    expect(view.body.viewer).toEqual({ canEdit: true });
    expect((await put('gm0', VALID)).status).toBe(200);
    expect((await del('gm0')).status).toBe(204);
  });

  it('rank-1 GUID-linked without a member grant: GET canEdit false, PUT 403', async () => {
    const view = await get('r1');
    expect(view.status).toBe(200);
    expect(view.body.viewer).toEqual({ canEdit: false });
    expect((await put('r1', VALID)).status).toBe(403);
    expect((await del('r1')).status).toBe(403);
  });

  it('rank-0 linked only by Blizzard character id: member GET, PUT + DELETE 403', async () => {
    const view = await get('bliz0');
    expect(view.status).toBe(200);
    expect(view.body.viewer).toEqual({ canEdit: false });
    expect((await put('bliz0', VALID)).status).toBe(403);
    expect((await del('bliz0')).status).toBe(403);
  });

  it('rank-0 row not in the latest snapshot: not a member, GET + PUT + DELETE 403', async () => {
    expect((await get('left0')).status).toBe(403);
    expect((await put('left0', VALID)).status).toBe(403);
    expect((await del('left0')).status).toBe(403);
  });

  it('a character GUID matching no row: GET + PUT + DELETE 403', async () => {
    expect((await get('unlinked')).status).toBe(403);
    expect((await put('unlinked', VALID)).status).toBe(403);
    expect((await del('unlinked')).status).toBe(403);
  });

  it('a confirmed member editor grant still edits', async () => {
    expect((await put('deleg', VALID)).status).toBe(200);
    expect((await get('deleg')).body.viewer).toEqual({ canEdit: true });
  });
});

describe('save / read / clear (AC3, AC4, AC7)', () => {
  it('unset reads as the all-null view', async () => {
    const res = await get('r1');
    expect(res.body).toEqual({
      recruitment: null,
      state: null,
      updatedAt: null,
      updatedBy: null,
      viewer: { canEdit: false },
    });
  });

  it('PUT normalises, stamps the editor and derives the headline', async () => {
    const res = await put('deleg', VALID);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('open');
    expect(res.body.updatedBy).toBe('rec-deleg');
    expect(typeof res.body.updatedAt).toBe('string');
    expect(res.body.recruitment.wanted[0]).toEqual({
      className: 'Priest',
      role: 'healer',
      state: 'open',
      note: 'Holy',
    });
    expect((await get('r1')).body.recruitment).toEqual(res.body.recruitment);
  });

  it('switch off reads Closed and keeps every row state; on restores them', async () => {
    await put('deleg', VALID);
    const off = await put('deleg', { ...VALID, recruiting: false });
    expect(off.body.state).toBe('closed');
    const kept = GuildRecruitmentViewSchema.parse(off.body).recruitment;
    expect(kept?.wanted.map((w) => w.state)).toEqual([
      'open',
      'limited',
      'closed',
    ]);
    const on = await put('deleg', { ...VALID, recruiting: true });
    expect(on.body.state).toBe('open');
    expect(on.body.recruitment.applyUrl).toBe('https://example.com/apply');
  });

  it('DELETE clears back to unset', async () => {
    await put('deleg', VALID);
    expect((await del('deleg')).status).toBe(204);
    const res = await get('deleg');
    expect(res.body.recruitment).toBeNull();
    expect(res.body.state).toBeNull();
    expect(res.body.updatedAt).toBeNull();
    expect(res.body.updatedBy).toBeNull();
  });

  it('DELETE on a guild with no profile row creates none', async () => {
    expect((await del('deleg')).status).toBe(204);
    const rows = await testApp.db
      .select({ guildId: schema.guildProfiles.guildId })
      .from(schema.guildProfiles)
      .where(eq(schema.guildProfiles.guildId, guildId));
    expect(rows).toEqual([]);
  });

  it('a PUT leaves rules, links and in-game text unchanged', async () => {
    const rules = [{ title: 'Loot', body: 'Council' }];
    const links = [
      {
        title: 'Links',
        links: [{ label: 'Site', url: 'https://example.com' }],
      },
    ];
    await testApp.db.insert(schema.guildProfiles).values({
      guildId,
      rules,
      links,
      ingameMotd: 'Raid Tuesday',
      ingameInfo: 'Be kind',
    });
    expect((await put('deleg', VALID)).status).toBe(200);
    const [row] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.guildProfiles)
        .where(eq(schema.guildProfiles.guildId, guildId)),
      'profile',
    );
    expect(row.rules).toEqual(rules);
    expect(row.links).toEqual(links);
    expect(row.ingameMotd).toBe('Raid Tuesday');
    expect(row.ingameInfo).toBe('Be kind');
  });
});

describe('validation (AC6)', () => {
  const row = (over: object = {}) => ({
    className: 'Mage',
    role: 'dps',
    state: 'open',
    ...over,
  });
  const cases: Array<[string, object]> = [
    ['ftp URL', { ...VALID, applyUrl: 'ftp://x.example' }],
    ['javascript URL', { ...VALID, applyUrl: 'javascript:alert(1)' }],
    ['duplicate class + role', { ...VALID, wanted: [row(), row()] }],
    ['unknown class', { ...VALID, wanted: [row({ className: 'Bard' })] }],
    [
      'row without state',
      { ...VALID, wanted: [{ className: 'Mage', role: 'dps' }] },
    ],
    ['unknown row state', { ...VALID, wanted: [row({ state: 'maybe' })] }],
    ['missing recruiting', { wanted: [], applyUrl: null }],
    ['61-char note', { ...VALID, wanted: [row({ note: 'x'.repeat(61) })] }],
  ];
  it.each(cases)('%s → 400', async (_label, body) => {
    const res = await put('deleg', body);
    expect(res.status).toBe(400);
  });

  it('13 entries → 400', async () => {
    const classes = [
      'Warrior',
      'Paladin',
      'Hunter',
      'Rogue',
      'Priest',
      'Shaman',
      'Mage',
      'Warlock',
      'Druid',
    ];
    const roles = ['tank', 'healer', 'dps'];
    const wanted = classes
      .flatMap((className) => roles.map((role) => row({ className, role })))
      .slice(0, 13);
    expect((await put('deleg', { ...VALID, wanted })).status).toBe(400);
  });
});

describe('gating (AC5)', () => {
  it('no token → 401', async () => {
    expect((await testApp.request.get(path(guildId))).status).toBe(401);
  });

  it('staff on an unknown guild → 404 for GET and PUT', async () => {
    expect((await get('admin', 999_999)).status).toBe(404);
    expect((await put('admin', VALID, 999_999)).status).toBe(404);
  });

  it('staff on a non-wow_guild hub → 404', async () => {
    expect((await get('admin', communityId)).status).toBe(404);
  });

  it('staff can edit any wow guild', async () => {
    expect((await put('admin', VALID)).status).toBe(200);
    expect((await get('admin')).body.updatedBy).not.toBeNull();
  });

  it('plugin inactive → the plugin guard refuses GET, PUT and DELETE', async () => {
    await plugins().deactivate('blizzard');
    try {
      for (const res of [
        await get('gm0'),
        await put('gm0', VALID),
        await del('gm0'),
      ]) {
        expect(res.status).toBe(403);
        expect(String(res.body.message)).toContain('not active');
      }
    } finally {
      await plugins().activate('blizzard');
    }
  });
});
