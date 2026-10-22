/**
 * ROK-1893 P1 §7 I1–I9 (as amended by §8a/§8d) — hub invite links against a
 * real database. Fleet-only. Every case builds its own users + hub. The bot
 * invite is stubbed by spying on the app's real `HubDiscordInviteService`
 * (a `jest.mock` never reaches the shared singleton app).
 */
import { and, eq } from 'drizzle-orm';
import {
  HubInviteJoinResponseSchema,
  HubInviteListSchema,
  HubInvitePreviewSchema,
  HubInviteSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import { insertCommunityHub } from '../community-proposals.queries';
import { refreshMemberCount } from '../community-membership.queries';
import { HubDiscordInviteService } from './hub-discord-invite.service';

interface Who {
  id: number;
  token: string;
}

let testApp: TestApp;
let gameId: number;
let seq = 0;
const DISCORD_URL = 'https://discord.gg/rok1893-test';
const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

async function mkUser(inDiscord = true): Promise<Who> {
  const username = next('hi');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username,
        discordId: `93${String(Date.now() % 1e9).padStart(9, '0')}${String(seq).padStart(5, '0')}`,
        role: 'member',
        guildMemberSeenAt: inDiscord ? new Date() : null,
      })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, { sub: user.id, username });
  return { id: user.id, token };
}

/** An active community hub led by `leader`, plus live `members`. */
async function mkHub(leader: Who, members: Who[] = []): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId,
    name: next('InvHub'),
    blurb: 'Invite hub',
    status: 'active',
    proposedBy: leader.id,
    reviewedBy: null,
  });
  await testApp.db.insert(schema.hubCommunityMembers).values([
    { guildId: hub.id, userId: leader.id, role: 'leader' as const },
    ...members.map((m) => ({
      guildId: hub.id,
      userId: m.id,
      role: 'member' as const,
    })),
  ]);
  await refreshMemberCount(testApp.db, hub.id);
  return hub.id;
}

type Method = 'get' | 'post' | 'put' | 'delete';
function call(method: Method, path: string, who?: Who, body?: object) {
  const r = testApp.request[method](path);
  const authed = who ? r.set('Authorization', `Bearer ${who.token}`) : r;
  return body === undefined ? authed : authed.send(body);
}

async function mkInvite(hubId: number, who: Who, body: object = {}) {
  const res = await call('post', `/hubs/${hubId}/invites`, who, body);
  expect(res.status).toBe(201);
  const invite = HubInviteSchema.parse(res.body);
  const token = invite.token;
  if (token === null) throw new Error('maker must see the token');
  return { id: invite.id, token };
}

async function inviteRow(id: number): Promise<schema.HubInviteSelect> {
  const i = schema.hubInvites;
  const [row] = nonEmpty(
    await testApp.db.select().from(i).where(eq(i.id, id)),
    'invite',
  );
  return row;
}

async function setInvite(id: number, patch: Partial<schema.HubInviteInsert>) {
  await testApp.db
    .update(schema.hubInvites)
    .set(patch)
    .where(eq(schema.hubInvites.id, id));
}

async function memberRow(hubId: number, userId: number) {
  const m = schema.hubCommunityMembers;
  const [row] = await testApp.db
    .select()
    .from(m)
    .where(and(eq(m.guildId, hubId), eq(m.userId, userId)));
  return row ?? null;
}

beforeAll(async () => {
  testApp = await getTestApp();
  gameId = testApp.seed.game.id;
  jest
    .spyOn(testApp.app.get(HubDiscordInviteService), 'serverInviteUrl')
    .mockResolvedValue(DISCORD_URL);
});

afterAll(() => jest.restoreAllMocks());

describe('I1 create / list / revoke (ruling a: any live member)', () => {
  it('a plain member creates a 7-day unlimited link → 201 with an /h/ url', async () => {
    const [leader, member] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [member]);
    const res = await call('post', `/hubs/${hub}/invites`, member, {});
    expect(res.status).toBe(201);
    const invite = HubInviteSchema.parse(res.body);
    expect(invite.url).toBe(`${invite.url?.split('/h/')[0]}/h/${invite.token}`);
    expect(invite.maxUses).toBeNull();
    const days = (Date.parse(invite.expiresAt ?? '') - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('a non-member → 403 on create and list', async () => {
    const [leader, outsider] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    expect(
      (await call('post', `/hubs/${hub}/invites`, outsider, {})).status,
    ).toBe(403);
    expect((await call('get', `/hubs/${hub}/invites`, outsider)).status).toBe(
      403,
    );
  });

  it('the 6th live link → 409 "Revoke one to make another"; a revoked one frees a slot', async () => {
    const [leader, member] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [member]);
    const made: { id: number; token: string }[] = [];
    for (let n = 0; n < 5; n++) made.push(await mkInvite(hub, member));
    const sixth = await call('post', `/hubs/${hub}/invites`, member, {});
    expect(sixth.status).toBe(409);
    expect(JSON.stringify(sixth.body)).toContain('Revoke one to make another');
    const first = nonEmpty(made, 'made')[0];
    await call('delete', `/hubs/${hub}/invites/${first.id}`, member);
    expect(
      (await call('post', `/hubs/${hub}/invites`, member, {})).status,
    ).toBe(201);
  });
});

describe('I1 cap under concurrency', () => {
  it('two concurrent creates at 4 live links → one 201, one 409, 5 live', async () => {
    const [leader, member] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [member]);
    for (let n = 0; n < 4; n++) await mkInvite(hub, member);
    const res = await Promise.all([
      call('post', `/hubs/${hub}/invites`, member, {}),
      call('post', `/hubs/${hub}/invites`, member, {}),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    const i = schema.hubInvites;
    const rows = await testApp.db
      .select()
      .from(i)
      .where(and(eq(i.guildId, hub), eq(i.createdBy, member.id)));
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(5);
  });
});

describe('I1 list / revoke', () => {
  it('a member lists only their own links; the Leader lists all, with tokens', async () => {
    const [leader, a, b] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [a, b]);
    const ia = await mkInvite(hub, a);
    const ib = await mkInvite(hub, b);
    const asA = HubInviteListSchema.parse(
      (await call('get', `/hubs/${hub}/invites`, a)).body,
    );
    expect(asA.items.map((x) => x.id)).toEqual([ia.id]);
    expect(asA.liveByViewer).toBe(1);
    const asLeader = HubInviteListSchema.parse(
      (await call('get', `/hubs/${hub}/invites`, leader)).body,
    );
    expect(asLeader.items.map((x) => x.id).sort()).toEqual(
      [ia.id, ib.id].sort(),
    );
    expect(asLeader.items.every((x) => x.token !== null && x.canRevoke)).toBe(
      true,
    );
  });

  it('revoke: another member → 403; the maker → 204; the Leader → 204', async () => {
    const [leader, a, b] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [a, b]);
    const i1 = await mkInvite(hub, a);
    const i2 = await mkInvite(hub, a);
    expect(
      (await call('delete', `/hubs/${hub}/invites/${i1.id}`, b)).status,
    ).toBe(403);
    expect((await inviteRow(i1.id)).revokedAt).toBeNull();
    expect(
      (await call('delete', `/hubs/${hub}/invites/${i1.id}`, a)).status,
    ).toBe(204);
    expect((await inviteRow(i1.id)).revokedAt).not.toBeNull();
    expect(
      (await call('delete', `/hubs/${hub}/invites/${i2.id}`, leader)).status,
    ).toBe(204);
    expect((await inviteRow(i2.id)).revokedAt).not.toBeNull();
  });
});

describe('I2 public preview', () => {
  it('signed out: ok + hub card + the bot server invite; viewer fields empty', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    const { token } = await mkInvite(hub, leader);
    const res = await call('get', `/hubs/invites/${token}`);
    expect(res.status).toBe(200);
    const p = HubInvitePreviewSchema.parse(res.body);
    expect(p).toMatchObject({
      state: 'ok',
      alreadyMember: false,
      inDiscordServer: null,
      discordServerInviteUrl: DISCORD_URL,
    });
    expect(p.hub?.id).toBe(hub);
  });

  it('signed in as a member: alreadyMember, no Discord invite offered', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    const { token } = await mkInvite(hub, leader);
    const p = HubInvitePreviewSchema.parse(
      (await call('get', `/hubs/invites/${token}`, leader)).body,
    );
    expect(p).toMatchObject({ alreadyMember: true, inDiscordServer: true });
    expect(p.discordServerInviteUrl).toBeNull();
  });

  it('malformed and unknown tokens → 404', async () => {
    expect((await call('get', '/hubs/invites/not-a-token')).status).toBe(404);
    expect((await call('get', `/hubs/invites/${'A'.repeat(43)}`)).status).toBe(
      404,
    );
  });

  it.each([
    ['expired', { expiresAt: new Date(Date.now() - 60_000) }],
    ['revoked', { revokedAt: new Date() }],
    ['exhausted', { maxUses: 1, useCount: 1 }],
  ] as const)('%s link → preview state %s', async (state, patch) => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    const inv = await mkInvite(hub, leader);
    await setInvite(inv.id, patch);
    const p = HubInvitePreviewSchema.parse(
      (await call('get', `/hubs/invites/${inv.token}`)).body,
    );
    expect(p.state).toBe(state);
  });
});

describe('I3–I7, I9 redeem', () => {
  it('I3: redeem → live member, join_source invite, use_count 1', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    const inv = await mkInvite(hub, leader);
    const res = await call('post', `/hubs/invites/${inv.token}/join`, u);
    expect(res.status).toBe(200);
    expect(HubInviteJoinResponseSchema.parse(res.body)).toEqual({
      hubId: hub,
      joined: true,
      memberCount: 2,
    });
    const row = await memberRow(hub, u.id);
    expect(row).toMatchObject({
      joinSource: 'invite',
      inviteId: inv.id,
      leftAt: null,
    });
    expect((await inviteRow(inv.id)).useCount).toBe(1);
  });

  it('I4: re-redeem by a member → 200 no-op, use_count unchanged', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    const inv = await mkInvite(hub, leader);
    await call('post', `/hubs/invites/${inv.token}/join`, u);
    const again = await call('post', `/hubs/invites/${inv.token}/join`, u);
    expect(again.status).toBe(200);
    expect(HubInviteJoinResponseSchema.parse(again.body).joined).toBe(false);
    expect((await inviteRow(inv.id)).useCount).toBe(1);
  });

  it('I5: banned → 403, use_count unchanged; the ban revokes their own links', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [u]);
    const inv = await mkInvite(hub, leader);
    const theirs = await mkInvite(hub, u);
    const ban = await call('put', `/hubs/${hub}/bans/${u.id}`, leader, {});
    expect([200, 204]).toContain(ban.status);
    expect((await inviteRow(theirs.id)).revokedAt).not.toBeNull();
    expect(
      (await call('post', `/hubs/invites/${inv.token}/join`, u)).status,
    ).toBe(403);
    expect((await inviteRow(inv.id)).useCount).toBe(0);
  });
});

describe('I6, I7, I9 refused redeems', () => {
  it.each([
    ['expired', { expiresAt: new Date(Date.now() - 60_000) }],
    ['revoked', { revokedAt: new Date() }],
    ['exhausted', { maxUses: 1, useCount: 1 }],
  ] as const)('I6: %s link → 410, no membership', async (state, patch) => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    const inv = await mkInvite(hub, leader);
    await setInvite(inv.id, patch);
    const res = await call('post', `/hubs/invites/${inv.token}/join`, u);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ state });
    expect(await memberRow(hub, u.id)).toBeNull();
  });

  it('I7: two concurrent redeems of a max_uses=1 link → exactly one joins', async () => {
    const [leader, a, b] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    const inv = await mkInvite(hub, leader, { maxUses: 1 });
    const res = await Promise.all([
      call('post', `/hubs/invites/${inv.token}/join`, a),
      call('post', `/hubs/invites/${inv.token}/join`, b),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 410]);
    expect((await inviteRow(inv.id)).useCount).toBe(1);
  });

  it('a redeem racing a ban of the link maker → no deadlock (hub lock first)', async () => {
    const [leader, maker, u] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [maker]);
    const inv = await mkInvite(hub, maker);
    const [redeem, ban] = await Promise.all([
      call('post', `/hubs/invites/${inv.token}/join`, u),
      call('put', `/hubs/${hub}/bans/${maker.id}`, leader, {}),
    ]);
    // A deadlock aborts one side with a 500; either serial order is fine.
    expect([200, 410]).toContain(redeem.status);
    expect([200, 204]).toContain(ban.status);
    expect((await inviteRow(inv.id)).revokedAt).not.toBeNull();
  });

  it('I9: not in the Discord server → 403, no membership', async () => {
    const leader = await mkUser();
    const outsider = await mkUser(false);
    const hub = await mkHub(leader);
    const inv = await mkInvite(hub, leader);
    const res = await call('post', `/hubs/invites/${inv.token}/join`, outsider);
    expect(res.status).toBe(403);
    expect(await memberRow(hub, outsider.id)).toBeNull();
    expect((await inviteRow(inv.id)).useCount).toBe(0);
  });
});

describe('I8 unavailable hubs', () => {
  it.each([
    ['hidden', { hiddenAt: new Date() }],
    [
      'archived',
      {
        status: 'archived' as const,
        archivedAt: new Date(),
        archivedReason: 'admin' as const,
      },
    ],
  ] as const)(
    '%s hub → preview hub-unavailable (hub null); join → 404',
    async (_k, patch) => {
      const [leader, u] = [await mkUser(), await mkUser()];
      const hub = await mkHub(leader);
      const inv = await mkInvite(hub, leader);
      await testApp.db
        .update(schema.guilds)
        .set(patch)
        .where(eq(schema.guilds.id, hub));
      const p = HubInvitePreviewSchema.parse(
        (await call('get', `/hubs/invites/${inv.token}`)).body,
      );
      expect(p).toMatchObject({ state: 'hub-unavailable', hub: null });
      expect(
        (await call('post', `/hubs/invites/${inv.token}/join`, u)).status,
      ).toBe(404);
    },
  );
});
