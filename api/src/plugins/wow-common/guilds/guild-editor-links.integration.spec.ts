/**
 * ROK-1794 (review P2s) — against a real database:
 * - the roster's `linkedAccount` (RL username + confirmed-link time) reaches
 *   staff only — never a member, a delegated officer or a visitor;
 * - each editor grant's `effective` is the access check's own answer (a rank
 *   grant never; a member grant only when made at/after its row's confirmed
 *   link), with `linkedUsername` for member grants.
 */
import * as bcrypt from 'bcrypt';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { hasConfirmedMemberGrant } from './guild-delegation.helpers';
import { findLinkedMemberRows } from './guild-membership.helpers';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const BEFORE_ANY_LINK = new Date('2026-01-01T00:00:00.000Z');
const BASE = '/plugins/wow/guilds';

type Who = 'gm' | 'deleg' | 'early' | 'repin' | 'plain' | 'outsider' | 'oper';

let testApp: TestApp;
let guildId: number;
const tokens = {} as Record<Who | 'admin', string>;
const memberIds = {} as Record<Who, number>;
const charIds = {} as Record<Who, string>;
const userIds = {} as Record<Who, number>;

interface Member {
  name: string;
  linkedAccount?: { username: string; linkedSince: string; linkVia?: string };
}
interface Editor {
  kind: string;
  memberName: string | null;
  createdAt: string;
  effective?: boolean;
  linkedUsername?: string | null;
}

async function insertMember(guid: string, name: string, rankIndex: number) {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: name,
        rankIndex,
        rankName: `Rank ${rankIndex}`,
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  return row.id;
}

/** A local-login user + character (+ a member row unless rankIndex null). */
async function seedUser(who: Who, rankIndex: number | null) {
  const email = `${who}@links.test`;
  const role = who === 'oper' ? 'operator' : 'member';
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: who, role })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const guid = `Player-1-${who}`;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: who,
        addonGuid: guid,
      })
      .returning(),
    'character',
  );
  charIds[who] = char.id;
  userIds[who] = user.id;
  if (rankIndex !== null)
    memberIds[who] = await insertMember(guid, who, rankIndex);
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
}

const get = (path: string, who: Who | 'admin') =>
  testApp.request
    .get(`${BASE}${path}`)
    .set('Authorization', `Bearer ${tokens[who]}`);

async function rosterAs(who: Who | 'admin'): Promise<Member[]> {
  const res = await get(`/${guildId}`, who);
  expect(res.status).toBe(200);
  const ranks = res.body.ranks as { members: Member[] }[];
  return ranks.flatMap((r) => r.members);
}

async function charCreatedAt(who: Who): Promise<string> {
  const [ch] = nonEmpty(
    await testApp.db
      .select({ at: schema.characters.createdAt })
      .from(schema.characters)
      .where(eq(schema.characters.id, charIds[who])),
    'character',
  );
  return ch.at.toISOString();
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name: 'Link Watch',
        nameKey: 'link watch',
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  guildId = g.id;
  await seedUser('gm', 0);
  for (const who of ['deleg', 'early', 'repin', 'plain'] as const) {
    await seedUser(who, 3);
  }
  await seedUser('outsider', null);
  await seedUser('oper', null);
  const unlinked = await insertMember('Player-1-nobody', 'Unlinked', 3);
  await testApp.db.insert(schema.guildEditors).values([
    { guildId, kind: 'rank', rankIndex: 0 },
    { guildId, kind: 'member', guildMemberId: memberIds.deleg },
    { guildId, kind: 'member', guildMemberId: memberIds.repin },
    { guildId, kind: 'member', guildMemberId: unlinked },
    // Granted before the holder's character (and so its link) existed.
    {
      guildId,
      kind: 'member',
      guildMemberId: memberIds.early,
      createdAt: BEFORE_ANY_LINK,
    },
  ]);
  // 'repin' re-claims its GUID after the grant: the confirmed link moves on.
  await testApp.db.insert(schema.activityLog).values({
    entityType: 'addon_guid',
    entityId: 1,
    action: 'addon_guid_claimed',
    metadata: { characterId: charIds.repin },
    createdAt: sql`now() + interval '1 second'`,
  });
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('roster linkedAccount — staff only (ROK-1794 review)', () => {
  it.each(['admin', 'oper'] as const)(
    '%s sees each linked row’s RL account and confirmed-link time',
    async (who) => {
      const members = await rosterAs(who);
      const byName = new Map(members.map((m) => [m.name, m]));
      expect(byName.get('gm')?.linkedAccount).toEqual({
        username: 'gm',
        linkedSince: await charCreatedAt('gm'),
        linkVia: 'import',
      });
      expect(byName.get('Unlinked')).not.toHaveProperty('linkedAccount');
      // A later GUID claim moves the confirmed-link time past the character's creation.
      const repin = byName.get('repin')?.linkedAccount;
      expect(repin?.username).toBe('repin');
      expect(Date.parse(repin?.linkedSince ?? '')).toBeGreaterThan(
        Date.parse(await charCreatedAt('repin')),
      );
    },
  );

  it.each(['plain', 'deleg'] as const)(
    '%s (member / delegated officer) gets no linkedAccount on any row',
    async (who) => {
      const members = await rosterAs(who);
      expect(members.length).toBeGreaterThan(0);
      expect(
        members.filter((m) => 'linkedAccount' in m).map((m) => m.name),
      ).toEqual([]);
    },
  );

  it('a visitor (non-member) gets 403 and no roster at all', async () => {
    const res = await get(`/${guildId}`, 'outsider');
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('ranks');
  });
});

describe('roster linkedAccount.linkVia — picked-from-roster marker (ROK-2128 FLAG 3)', () => {
  it('marks a roster-claimed link roster_pick and every other link import', async () => {
    // 'plain' claimed its row from the roster pick list (holds no grant).
    await testApp.db.insert(schema.activityLog).values({
      entityType: 'character_claim',
      entityId: userIds.plain,
      action: 'roster_claimed',
      metadata: {
        characterId: charIds.plain,
        guildId,
        memberId: memberIds.plain,
      },
    });
    // 'deleg' was roster-picked by ANOTHER player, then moved to deleg by an
    // admin Change owner: deleg picked nothing (review 2 MINOR) → import.
    await testApp.db.insert(schema.activityLog).values({
      entityType: 'character_claim',
      entityId: userIds.gm,
      action: 'roster_claimed',
      metadata: { characterId: charIds.deleg, guildId },
    });
    // A non-claim audit naming 'gm' must not mark it.
    await testApp.db.insert(schema.activityLog).values({
      entityType: 'character_claim',
      entityId: 1,
      action: 'admin_reassigned',
      metadata: { characterId: charIds.gm },
    });
    const members = await rosterAs('admin');
    const via = Object.fromEntries(
      members.map((m) => [m.name, m.linkedAccount?.linkVia ?? null]),
    );
    expect(via).toMatchObject({
      plain: 'roster_pick',
      gm: 'import',
      deleg: 'import',
      repin: 'import',
      Unlinked: null,
    });
  });

  it('a non-staff viewer still gets no linkedAccount (so no linkVia)', async () => {
    const members = await rosterAs('plain');
    expect(members.some((m) => 'linkedAccount' in m)).toBe(false);
  });
});

describe('editor grants effective + linkedUsername (ROK-1794 review)', () => {
  async function editors(): Promise<Editor[]> {
    const res = await get(`/${guildId}/editors`, 'admin');
    expect(res.status).toBe(200);
    return res.body.editors as Editor[];
  }

  it('rank grant false; member grant true only when made at/after the confirmed link', async () => {
    const list = await editors();
    const pick = (e: Editor) => ({
      kind: e.kind,
      memberName: e.memberName,
      effective: e.effective,
      linkedUsername: e.linkedUsername,
    });
    expect(list.map(pick)).toEqual(
      expect.arrayContaining([
        {
          kind: 'rank',
          memberName: null,
          effective: false,
          linkedUsername: null,
        },
        {
          kind: 'member',
          memberName: 'deleg',
          effective: true,
          linkedUsername: 'deleg',
        },
        {
          kind: 'member',
          memberName: 'early',
          effective: false,
          linkedUsername: 'early',
        },
        {
          kind: 'member',
          memberName: 'repin',
          effective: false,
          linkedUsername: 'repin',
        },
        {
          kind: 'member',
          memberName: 'Unlinked',
          effective: false,
          linkedUsername: null,
        },
      ]),
    );
    expect(list).toHaveLength(5);
  });

  it('effective agrees with the ladder the access check resolves for the holder', async () => {
    for (const [who, role] of [
      ['deleg', 'officer'],
      ['early', 'member'],
      ['repin', 'member'],
    ] as const) {
      const res = await get(`/${guildId}`, who);
      expect({ who, role: res.body.viewer?.role }).toEqual({ who, role });
    }
  });

  it('effective ⇔ grant createdAt ≥ the row’s staff-visible linkedSince', async () => {
    const since = new Map(
      (await rosterAs('admin')).flatMap((m) =>
        m.linkedAccount ? [[m.name, m.linkedAccount.linkedSince] as const] : [],
      ),
    );
    for (const e of (await editors()).filter((x) => x.memberName !== null)) {
      const linked =
        e.memberName === null ? undefined : since.get(e.memberName);
      const expected =
        linked !== undefined && Date.parse(e.createdAt) >= Date.parse(linked);
      expect({ name: e.memberName, effective: e.effective }).toEqual({
        name: e.memberName,
        effective: expected,
      });
    }
  });
});

/**
 * ROK-2128 AC7 / D4: a roster pick never confers a member grant made before
 * it, and an admin Change owner never hands the old owner's grant to the new
 * owner (review 1 MAJOR) — staff re-grant after seeing the new link.
 */
const FOREVER = 'world-of-warcraft-forever';
let fGuild: number;

async function foreverGame(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER })
      .returning({ id: schema.games.id }),
    'forever game',
  );
  return made.id;
}

async function rosterRow(name: string, guid: string): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId: fGuild,
        guid,
        characterName: name,
        rankIndex: 3,
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning({ id: schema.guildMembers.id }),
    'roster row',
  );
  return m.id;
}

async function player(handle: string): Promise<{ id: number; token: string }> {
  const email = `${handle}@ac7.test`;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: handle,
        role: 'member',
      })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: u.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return { id: u.id, token: res.body.access_token as string };
}

async function claimRow(memberId: number, token: string): Promise<string> {
  const res = await testApp.request
    .post(`/plugins/wow/roster-claim/members/${memberId}/claim`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ruleset: 'normal' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const grant = (memberId: number) =>
  testApp.db
    .insert(schema.guildEditors)
    .values({ guildId: fGuild, kind: 'member', guildMemberId: memberId });

/** The member grant, for a user who IS linked to exactly `memberId`. */
async function grantHonoured(userId: number, memberId: number) {
  const rows = await findLinkedMemberRows(testApp.db, userId, fGuild);
  expect(rows.map((r) => r.memberId)).toEqual([memberId]);
  return hasConfirmedMemberGrant(testApp.db, fGuild, rows);
}

describe('roster claim + Change owner vs member grants (ROK-2128 AC7)', () => {
  beforeAll(async () => {
    const [g] = nonEmpty(
      await testApp.db
        .insert(schema.guilds)
        .values({
          gameId: await foreverGame(),
          region: 'us',
          name: 'AC7 Watch',
          nameKey: 'ac7 watch',
          source: 'addon_import',
          lastSnapshotAt: SNAP,
        })
        .returning({ id: schema.guilds.id }),
      'forever guild',
    );
    fGuild = g.id;
  });

  it('a member grant made BEFORE a roster claim is not honoured for the claimer', async () => {
    const memberId = await rosterRow('Grant First', 'G-AC7-FIRST');
    await grant(memberId);
    const picker = await player('ac7picker');
    await claimRow(memberId, picker.token);
    expect(await grantHonoured(picker.id, memberId)).toBe(false);
  });

  it('Change owner does not hand the old owner’s grant to the new owner', async () => {
    const memberId = await rosterRow('Moved Link', 'G-AC7-MOVED');
    const from = await player('ac7from');
    const to = await player('ac7to');
    const characterId = await claimRow(memberId, from.token);
    await grant(memberId); // staff confirm FROM's link
    expect(await grantHonoured(from.id, memberId)).toBe(true);
    const res = await testApp.request
      .put(`/admin/plugins/wow/characters/${characterId}/owner`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: to.id });
    expect(res.status).toBe(200);
    expect(await grantHonoured(to.id, memberId)).toBe(false);
  });
});
