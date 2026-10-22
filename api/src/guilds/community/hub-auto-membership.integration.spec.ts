/**
 * ROK-1893 P1 §7 A1–A8 (as amended by §8d) — hub auto-membership on event
 * signup, and the signed-in user's join prompts, against a real database.
 * Fleet-only. Every case builds its own users, hubs and events.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import { insertCommunityHub } from './community-proposals.queries';
import { refreshMemberCount } from './community-membership.queries';
import { HubAutoMembershipService } from './hub-auto-membership.service';

interface Who {
  id: number;
  token: string;
}
type Mode = 'off' | 'suggest' | 'auto';

let testApp: TestApp;
let adminToken: string;
let gameId: number;
let auto: HubAutoMembershipService;
let seq = 0;

const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

async function mkUser(inDiscord = true): Promise<Who> {
  const username = next('am');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username,
        discordId: `92${String(Date.now() % 1e9).padStart(9, '0')}${String(seq).padStart(5, '0')}`,
        role: 'member',
        guildMemberSeenAt: inDiscord ? new Date() : null,
      })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, { sub: user.id, username });
  return { id: user.id, token };
}

/** An active community hub led by `leader` in `mode`. */
async function mkHub(leader: Who, mode: Mode): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId,
    name: next('AmHub'),
    blurb: 'Auto-membership hub',
    status: 'active',
    proposedBy: leader.id,
    reviewedBy: null,
  });
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId: hub.id, userId: leader.id, role: 'leader' });
  await refreshMemberCount(testApp.db, hub.id);
  await setMode(hub.id, mode);
  return hub.id;
}

async function setMode(hubId: number, mode: Mode): Promise<void> {
  await testApp.db
    .update(schema.guilds)
    .set({ autoMembership: mode })
    .where(eq(schema.guilds.id, hubId));
}

/** A future event tagged to `hubId` (null = untagged). */
async function mkEvent(hubId: number | null): Promise<number> {
  const start = new Date(Date.now() + 48 * 3600 * 1000);
  const end = new Date(start.getTime() + 3600 * 1000);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: next('AmEvent'),
        gameId,
        duration: [start, end],
        maxAttendees: 20,
        creatorId: testApp.seed.adminUser.id,
        guildId: hubId,
      })
      .returning(),
    'event',
  );
  return event.id;
}

type Method = 'get' | 'post' | 'patch';
function call(method: Method, path: string, token: string, body?: object) {
  const r = testApp.request[method](path).set(
    'Authorization',
    `Bearer ${token}`,
  );
  return body === undefined ? r : r.send(body);
}

async function promptRow(hubId: number, userId: number) {
  const p = schema.hubJoinPrompts;
  const [row] = await testApp.db
    .select()
    .from(p)
    .where(and(eq(p.guildId, hubId), eq(p.userId, userId)));
  return row ?? null;
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
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  auto = testApp.app.get(HubAutoMembershipService);
});

afterEach(() => jest.restoreAllMocks());

describe('signup → auto-membership (A1–A4)', () => {
  it('A1: suggest — the signer gets an open "Join" prompt, no membership', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, 'suggest');
    const event = await mkEvent(hub);
    const res = await call('post', `/events/${event}/signup`, u.token, {});
    expect(res.status).toBe(201);
    await waitFor(async () => {
      expect((await promptRow(hub, u.id))?.kind).toBe('suggest');
    });
    expect(await memberRow(hub, u.id)).toBeNull();
    const list = await call('get', '/users/me/hub-join-prompts', u.token);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      items: [
        { kind: 'suggest', hubId: hub, source: 'signup', sourceRef: event },
      ],
    });
  });

  it('A2: auto — the signer is joined (source auto) and told once', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, 'auto');
    const event = await mkEvent(hub);
    const res = await call('post', `/events/${event}/signup`, u.token, {});
    expect(res.status).toBe(201);
    await waitFor(async () => {
      expect((await memberRow(hub, u.id))?.joinSource).toBe('auto');
    });
    const member = await memberRow(hub, u.id);
    expect(member?.leftAt).toBeNull();
    expect((await promptRow(hub, u.id))?.kind).toBe('auto-joined');
  });

  it('A2b: auto, signer not in the Discord server → a suggest prompt instead', async () => {
    const [leader, u] = [await mkUser(), await mkUser(false)];
    const hub = await mkHub(leader, 'auto');
    expect(await auto.onSignup(await mkEvent(hub), u.id)).toBe('suggest');
    expect(await memberRow(hub, u.id)).toBeNull();
    expect((await promptRow(hub, u.id))?.kind).toBe('suggest');
  });

  it('A3: off — nothing happens', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, 'off');
    expect(await auto.onSignup(await mkEvent(hub), u.id)).toBe('none');
    expect(await promptRow(hub, u.id)).toBeNull();
    expect(await memberRow(hub, u.id)).toBeNull();
  });

  it('A4: untagged event, hidden hub, banned and left signers → nothing', async () => {
    const [leader, u, banned, left] = [
      await mkUser(),
      await mkUser(),
      await mkUser(),
      await mkUser(),
    ];
    expect(await auto.onSignup(await mkEvent(null), u.id)).toBe('none');
    const hidden = await mkHub(leader, 'auto');
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hidden));
    expect(await auto.onSignup(await mkEvent(hidden), u.id)).toBe('none');
    expect(await memberRow(hidden, u.id)).toBeNull();
    const hub = await mkHub(leader, 'auto');
    await testApp.db.insert(schema.hubCommunityMembers).values([
      { guildId: hub, userId: banned.id, role: 'member', bannedAt: new Date() },
      { guildId: hub, userId: left.id, role: 'member', leftAt: new Date() },
    ]);
    const event = await mkEvent(hub);
    expect(await auto.onSignup(event, banned.id)).toBe('none');
    expect(await auto.onSignup(event, left.id)).toBe('none');
    expect((await memberRow(hub, banned.id))?.bannedAt).not.toBeNull();
    expect((await memberRow(hub, left.id))?.leftAt).not.toBeNull();
    expect(await promptRow(hub, left.id)).toBeNull();
  });

  it('A4b: a failing hook never fails the signup', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, 'auto');
    const spy = jest
      .spyOn(auto, 'onSignup')
      .mockRejectedValue(new Error('boom'));
    const res = await call(
      'post',
      `/events/${await mkEvent(hub)}/signup`,
      u.token,
      {},
    );
    expect(res.status).toBe(201);
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
      return Promise.resolve();
    });
    expect(await memberRow(hub, u.id)).toBeNull();
  });
});

describe('prompts (A5–A6)', () => {
  it('A5: "Not now" sticks across a second signup, even after a switch to auto', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, 'suggest');
    expect(await auto.onSignup(await mkEvent(hub), u.id)).toBe('suggest');
    const promptId = (await promptRow(hub, u.id))?.id ?? -1;
    const d = await call(
      'post',
      `/users/me/hub-join-prompts/${promptId}/dismiss`,
      u.token,
    );
    expect(d.status).toBe(204);
    expect(await auto.onSignup(await mkEvent(hub), u.id)).toBe('none');
    await setMode(hub, 'auto');
    expect(await auto.onSignup(await mkEvent(hub), u.id)).toBe('none');
    expect(await memberRow(hub, u.id)).toBeNull();
    expect((await promptRow(hub, u.id))?.dismissedAt).not.toBeNull();
    const list = await call('get', '/users/me/hub-join-prompts', u.token);
    expect(list.body).toEqual({ items: [] });
  });

  it('A6: Join on a suggest prompt joins with source prompt and closes it', async () => {
    const [leader, u, other] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader, 'suggest');
    await auto.onSignup(await mkEvent(hub), u.id);
    const prompt = await promptRow(hub, u.id);
    const id = prompt?.id ?? -1;
    const stranger = await call(
      'post',
      `/users/me/hub-join-prompts/${id}/accept`,
      other.token,
    );
    expect(stranger.status).toBe(404);
    const res = await call(
      'post',
      `/users/me/hub-join-prompts/${id}/accept`,
      u.token,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hubId: hub, joined: true, memberCount: 2 });
    expect((await memberRow(hub, u.id))?.joinSource).toBe('prompt');
    expect((await promptRow(hub, u.id))?.dismissedAt).not.toBeNull();
  });
});

describe('PATCH /hubs/:id/auto-membership (A7) + defaults (A8)', () => {
  it('A7: only the Leader or staff may change the mode', async () => {
    const [leader, member] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, 'off');
    await testApp.db
      .insert(schema.hubCommunityMembers)
      .values({ guildId: hub, userId: member.id, role: 'member' });
    const path = `/hubs/${hub}/auto-membership`;
    expect(
      (await call('patch', path, member.token, { mode: 'auto' })).status,
    ).toBe(403);
    const ok = await call('patch', path, leader.token, { mode: 'auto' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ mode: 'auto' });
    expect(
      (await call('patch', path, adminToken, { mode: 'off' })).status,
    ).toBe(200);
    expect(
      (await call('patch', path, leader.token, { mode: 'all' })).status,
    ).toBe(400);
    const [row] = await testApp.db
      .select({ mode: schema.guilds.autoMembership })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, hub));
    expect(row?.mode).toBe('off');
  });

  it('A7b: a non-community hub is a 400 for staff', async () => {
    const name = next('AmWow');
    const [wow] = nonEmpty(
      await testApp.db
        .insert(schema.guilds)
        .values({
          gameId,
          kind: 'wow_guild',
          region: 'us',
          name,
          nameKey: name.toLowerCase(),
          source: 'test',
        })
        .returning(),
      'wow guild',
    );
    const res = await call(
      'patch',
      `/hubs/${wow.id}/auto-membership`,
      adminToken,
      { mode: 'suggest' },
    );
    expect(res.status).toBe(400);
  });

  it('A8: a new community hub defaults to suggest; only the leader sees it on the page', async () => {
    const [leader, member] = [await mkUser(), await mkUser()];
    const hub = await insertCommunityHub(testApp.db, {
      gameId,
      name: next('AmNew'),
      blurb: 'fresh',
      status: 'active',
      proposedBy: leader.id,
      reviewedBy: null,
    });
    expect(hub.autoMembership).toBe('suggest');
    await testApp.db.insert(schema.hubCommunityMembers).values([
      { guildId: hub.id, userId: leader.id, role: 'leader' as const },
      { guildId: hub.id, userId: member.id, role: 'member' as const },
    ]);
    const page = await call('get', `/guilds/${hub.id}`, leader.token);
    expect({ status: page.status, body: page.body as unknown }).toMatchObject({
      status: 200,
      body: { guild: { autoMembership: 'suggest' } },
    });
    const asMember = await call('get', `/guilds/${hub.id}`, member.token);
    expect(asMember.status).toBe(200);
    expect(asMember.body).toHaveProperty('guild');
    expect(asMember.body).not.toHaveProperty('guild.autoMembership');
  });
});
