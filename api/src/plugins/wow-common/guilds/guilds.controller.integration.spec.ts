/**
 * ROK-1785 — `/plugins/wow/guilds` against a real database: the 403 matrix on
 * `GET /:id` and the editors endpoints (GM, delegated rank, delegated member,
 * plain member, soft-removed member, non-member, admin), the roster shape,
 * `by-character`, `?gameId` and `/mine`.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const OLD = new Date('2026-09-01T20:00:00.000Z');
const BASE = '/plugins/wow/guilds';

type Who = 'gm' | 'officer' | 'deleg' | 'plain' | 'removed' | 'outsider';

let testApp: TestApp;
let guildId: number;
let otherGuildId: number;
const tokens = {} as Record<Who | 'admin', string>;
const charIds = {} as Record<Who, string>;
const memberIds = {} as Record<Who, number>;

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

/** A user with a local login + a character + (optionally) a member row. */
async function seedUser(who: Who, rankIndex: number | null, seenAt = SNAP) {
  const email = `${who}@guild.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: who, role: 'member' })
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
        role: 'dps',
        roleOverride: who === 'gm' ? 'tank' : null,
        isMain: true,
      })
      .returning(),
    'character',
  );
  charIds[who] = char.id;
  if (rankIndex !== null) {
    memberIds[who] = await insertMember(guid, who, rankIndex, seenAt);
  }
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
}

async function insertMember(
  guid: string | null,
  name: string,
  rankIndex: number,
  seenAt: Date,
  gid = guildId,
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId: gid,
        guid,
        characterName: name,
        rankIndex,
        rankName: `Rank ${rankIndex}`,
        source: 'addon_import',
        lastSeenAt: seenAt,
      })
      .returning(),
    'member',
  );
  return row.id;
}

const get = (path: string, who?: Who | 'admin') => {
  const req = testApp.request.get(`${BASE}${path}`);
  return who ? req.set('Authorization', `Bearer ${tokens[who]}`) : req;
};

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Ledger Keepers');
  otherGuildId = await insertGuild('Other Guild');
  await seedUser('gm', 0);
  await seedUser('officer', 1);
  await seedUser('deleg', 3);
  await seedUser('plain', 3);
  await seedUser('removed', 3, OLD);
  await seedUser('outsider', null);
  await insertMember('Player-1-unlinked', 'Unlinked', 3, SNAP);
  await testApp.db.insert(schema.guildEditors).values([
    { guildId, kind: 'rank', rankIndex: 1 },
    { guildId, kind: 'member', guildMemberId: memberIds.deleg },
  ]);
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

afterAll(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('GET /:id — view matrix', () => {
  it.each([
    ['gm', { canEdit: true, canManageEditors: true }],
    ['officer', { canEdit: true, canManageEditors: false }],
    ['deleg', { canEdit: true, canManageEditors: false }],
    ['plain', { canEdit: false, canManageEditors: false }],
    ['admin', { canEdit: true, canManageEditors: true }],
  ] as const)('%s → 200 with viewer %o', async (who, viewer) => {
    const res = await get(`/${guildId}`, who);
    expect(res.status).toBe(200);
    expect(res.body.viewer).toEqual(viewer);
    expect(res.body.guild.name).toBe('Ledger Keepers');
  });

  it.each(['removed', 'outsider'] as const)('%s → 403', async (who) => {
    expect((await get(`/${guildId}`, who)).status).toBe(403);
  });

  it('401 without a token; admin gets 404 for a missing guild', async () => {
    expect((await get(`/${guildId}`)).status).toBe(401);
    expect((await get('/999999', 'admin')).status).toBe(404);
  });

  it('groups the live roster by rank, links characters, drops soft-removed', async () => {
    const res = await get(`/${guildId}`, 'plain');
    const ranks = res.body.ranks as {
      rankIndex: number;
      members: { name: string; characterId: string | null }[];
    }[];
    expect(ranks.map((r) => r.rankIndex)).toEqual([0, 1, 3]);
    const rank3 = ranks.find((r) => r.rankIndex === 3);
    expect(rank3?.members.map((m) => m.name)).toEqual([
      'deleg',
      'plain',
      'Unlinked',
    ]);
    expect(rank3?.members[2]?.characterId).toBeNull();
    expect(ranks[0]?.members[0]).toMatchObject({
      characterId: charIds.gm,
      effectiveRole: 'tank',
      isMain: true,
    });
  });
});

describe('editors endpoints — manage matrix', () => {
  it.each(['gm', 'admin'] as const)('%s lists editors', async (who) => {
    const res = await get(`/${guildId}/editors`, who);
    expect(res.status).toBe(200);
    expect(res.body.editors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rank',
          rankIndex: 1,
          rankName: 'Rank 1',
        }),
        expect.objectContaining({ kind: 'member', memberName: 'deleg' }),
      ]),
    );
  });

  it.each(['officer', 'deleg', 'plain', 'removed', 'outsider'] as const)(
    '%s → 403 on list, create and delete',
    async (who) => {
      const auth = `Bearer ${tokens[who]}`;
      expect((await get(`/${guildId}/editors`, who)).status).toBe(403);
      const post = await testApp.request
        .post(`${BASE}/${guildId}/editors`)
        .set('Authorization', auth)
        .send({ kind: 'rank', rankIndex: 2 });
      expect(post.status).toBe(403);
      const del = await testApp.request
        .delete(`${BASE}/${guildId}/editors/1`)
        .set('Authorization', auth);
      expect(del.status).toBe(403);
    },
  );

  it('GM grants a rank, a duplicate is 409, delete is 204 then 404', async () => {
    const auth = `Bearer ${tokens.gm}`;
    const post = () =>
      testApp.request
        .post(`${BASE}/${guildId}/editors`)
        .set('Authorization', auth)
        .send({ kind: 'rank', rankIndex: 3 });
    const created = await post();
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    expect(created.body).toMatchObject({
      kind: 'rank',
      rankName: 'Rank 3',
      grantedBy: 'gm',
    });
    expect((await post()).status).toBe(409);
    const del = () =>
      testApp.request
        .delete(`${BASE}/${guildId}/editors/${id}`)
        .set('Authorization', auth);
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
  });

  it('400 on rank 0 and on a member of another guild', async () => {
    const outsiderRow = await insertMember(
      null,
      'Elsewhere',
      2,
      SNAP,
      otherGuildId,
    );
    const send = (body: object) =>
      testApp.request
        .post(`${BASE}/${guildId}/editors`)
        .set('Authorization', `Bearer ${tokens.gm}`)
        .send(body);
    expect((await send({ kind: 'rank', rankIndex: 0 })).status).toBe(400);
    expect(
      (await send({ kind: 'member', guildMemberId: outsiderRow })).status,
    ).toBe(400);
    await testApp.db
      .delete(schema.guildMembers)
      .where(eq(schema.guildMembers.id, outsiderRow));
  });
});

describe('GET /by-character/:characterId', () => {
  it('returns the guild + rank name without auth', async () => {
    const res = await get(`/by-character/${charIds.gm}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      rankName: 'Rank 0',
      guild: { id: guildId },
    });
  });

  it.each(['removed', 'outsider'] as const)(
    '%s → { data: null }',
    async (who) => {
      const res = await get(`/by-character/${charIds[who]}`);
      expect(res.body).toEqual({ data: null });
    },
  );
});

describe('GET /?gameId= and /mine', () => {
  it('members see their guild; non-members none; admin every guild', async () => {
    const q = `?gameId=${testApp.seed.game.id}`;
    const names = async (who: Who | 'admin') =>
      ((await get(q, who)).body.guilds as { name: string }[]).map(
        (g) => g.name,
      );
    expect(await names('plain')).toEqual(['Ledger Keepers']);
    expect(await names('outsider')).toEqual([]);
    expect(await names('removed')).toEqual([]);
    expect(await names('admin')).toEqual(['Ledger Keepers', 'Other Guild']);
    expect((await get('?gameId=abc', 'plain')).status).toBe(400);
  });

  it('/mine carries the viewer rank and edit right', async () => {
    const gm = await get('/mine', 'gm');
    expect(gm.body.guilds).toEqual([
      expect.objectContaining({
        id: guildId,
        rankIndex: 0,
        rankName: 'Rank 0',
        canEdit: true,
      }),
    ]);
    const plain = await get('/mine', 'plain');
    expect(plain.body.guilds[0]).toMatchObject({
      rankIndex: 3,
      canEdit: false,
    });
    expect((await get('/mine', 'outsider')).body.guilds).toEqual([]);
  });
});
