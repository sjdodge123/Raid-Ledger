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

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const BEFORE_ANY_LINK = new Date('2026-01-01T00:00:00.000Z');
const BASE = '/plugins/wow/guilds';

type Who = 'gm' | 'deleg' | 'early' | 'repin' | 'plain' | 'outsider' | 'oper';

let testApp: TestApp;
let guildId: number;
const tokens = {} as Record<Who | 'admin', string>;
const memberIds = {} as Record<Who, number>;
const charIds = {} as Record<Who, string>;

interface Member {
  name: string;
  linkedAccount?: { username: string; linkedSince: string };
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
