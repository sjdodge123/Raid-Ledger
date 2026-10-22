/**
 * ROK-1893 P3 — hub-tagged scheduling polls against a real database:
 * create with `hubId` (member / non-member / wrong game / hidden hub), the
 * poll page `hub` + `isHubMember`, the active list `hub`, `GET /hubs/:id/polls`,
 * reschedule polls inheriting the event's hub, and an event created from a
 * hub poll's match inheriting the hub (D16). Fleet-only.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import { insertCommunityHub } from '../../guilds/community/community-proposals.queries';
import { refreshMemberCount } from '../../guilds/community/community-membership.queries';

interface Who {
  id: number;
  token: string;
}

let testApp: TestApp;
let adminToken: string;
let seq = 0;
const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

async function mkUser(): Promise<Who> {
  const username = next('hp');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username, role: 'member' })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, { sub: user.id, username });
  return { id: user.id, token };
}

/** An active community hub for `gameId` with `leader` + live `members`. */
async function mkHub(leader: Who, members: Who[] = [], gameId?: number) {
  const hub = await insertCommunityHub(testApp.db, {
    gameId: gameId ?? testApp.seed.game.id,
    name: next('Hub'),
    blurb: 'Hub poll hub',
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
  return hub;
}

function createPoll(token: string, body: Record<string, unknown>) {
  return testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId: testApp.seed.game.id, ...body });
}

/** The poll's ids from the create response (`id` is the match id). */
function pollIds(body: unknown): { matchId: number; lineupId: number } {
  const b = body as { id: number; lineupId: number };
  return { matchId: b.id, lineupId: b.lineupId };
}

type ListItem = { matchId: number; hub?: unknown };

function get(path: string, token: string) {
  return testApp.request.get(path).set('Authorization', `Bearer ${token}`);
}

async function lineupGuildId(matchId: number): Promise<number | null> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ guildId: schema.communityLineups.guildId })
      .from(schema.communityLineupMatches)
      .innerJoin(
        schema.communityLineups,
        eq(schema.communityLineups.id, schema.communityLineupMatches.lineupId),
      )
      .where(eq(schema.communityLineupMatches.id, matchId)),
    'lineup',
  );
  return row.guildId;
}

async function addYesVote(matchId: number, userId: number): Promise<void> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + 864e5),
        suggestedBy: 'user',
      })
      .returning(),
    'slot',
  );
  await testApp.db
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId: slot.id, userId, stance: 'yes' });
}

describe('hub polls — create with hubId', () => {
  it('stores the hub when a live member tags the poll', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    const res = await createPoll(leader.token, { hubId: hub.id });
    expect(res.status).toBe(201);
    expect(await lineupGuildId(pollIds(res.body).matchId)).toBe(hub.id);
  });

  it('403s a non-member', async () => {
    const hub = await mkHub(await mkUser());
    const outsider = await mkUser();
    const res = await createPoll(outsider.token, { hubId: hub.id });
    expect(res.status).toBe(403);
  });

  it('400s a hub of another game', async () => {
    const leader = await mkUser();
    const [other] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: next('Other Game'), slug: next('other-game') })
        .returning(),
      'game',
    );
    const hub = await mkHub(leader, [], other.id);
    const res = await createPoll(leader.token, { hubId: hub.id });
    expect(res.status).toBe(400);
  });

  it('400s a hidden hub', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hub.id));
    const res = await createPoll(leader.token, { hubId: hub.id });
    expect(res.status).toBe(400);
  });
});

describe('hub polls — reads', () => {
  it('poll page carries hub + isHubMember; active list + hub list carry hub', async () => {
    const leader = await mkUser();
    const outsider = await mkUser();
    const hub = await mkHub(leader);
    const res = await createPoll(leader.token, { hubId: hub.id });
    expect(res.status).toBe(201);
    const { matchId, lineupId } = pollIds(res.body);
    await addYesVote(matchId, leader.id);
    await addYesVote(matchId, outsider.id);
    const page = await get(
      `/lineups/${lineupId}/schedule/${matchId}`,
      outsider.token,
    );
    expect(page.status).toBe(200);
    expect(page.body.hub).toEqual({
      id: hub.id,
      name: hub.name,
      memberCount: 1,
      viewerIsMember: false,
    });
    const voters = (
      page.body.slots as {
        votes: { userId: number; isHubMember?: boolean }[];
      }[]
    ).flatMap((s) => s.votes);
    expect(voters.find((v) => v.userId === leader.id)?.isHubMember).toBe(true);
    expect(voters.find((v) => v.userId === outsider.id)?.isHubMember).toBe(
      false,
    );
    const active = await get('/scheduling-polls/active', outsider.token);
    expect(
      (active.body as ListItem[]).find((p) => p.matchId === matchId)?.hub,
    ).toEqual({ id: hub.id, name: hub.name });
    const hubList = await get(`/hubs/${hub.id}/polls`, outsider.token);
    expect(hubList.status).toBe(200);
    expect((hubList.body as ListItem[]).map((p) => p.matchId)).toEqual([
      matchId,
    ]);
  });
});

describe('hub polls — hub list', () => {
  it('hub list excludes untagged polls and polls of another visible hub', async () => {
    const leader = await mkUser();
    const otherLeader = await mkUser();
    const hub = await mkHub(leader);
    const otherHub = await mkHub(otherLeader);
    const mine = await createPoll(leader.token, { hubId: hub.id });
    const other = await createPoll(otherLeader.token, { hubId: otherHub.id });
    const untagged = await createPoll((await mkUser()).token, {});
    expect([mine.status, other.status, untagged.status]).toEqual([
      201, 201, 201,
    ]);
    const hubList = await get(`/hubs/${hub.id}/polls`, adminToken);
    expect((hubList.body as ListItem[]).map((p) => p.matchId)).toEqual([
      pollIds(mine.body).matchId,
    ]);
  });

  it('a private hub poll is not listed for a non-invitee', async () => {
    const leader = await mkUser();
    const outsider = await mkUser();
    const hub = await mkHub(leader);
    const res = await createPoll(leader.token, {
      hubId: hub.id,
      visibility: 'private',
    });
    expect(res.status).toBe(201);
    const { matchId } = pollIds(res.body);
    const forCreator = await get(`/hubs/${hub.id}/polls`, leader.token);
    expect((forCreator.body as ListItem[]).map((p) => p.matchId)).toEqual([
      matchId,
    ]);
    const forOutsider = await get(`/hubs/${hub.id}/polls`, outsider.token);
    expect(forOutsider.status).toBe(200);
    expect(forOutsider.body).toEqual([]);
  });
});

describe('hub polls — hidden hub', () => {
  it('hidden hub: page hub null, no voter flags, empty hub list', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    const res = await createPoll(leader.token, { hubId: hub.id });
    expect(res.status).toBe(201);
    const { matchId, lineupId } = pollIds(res.body);
    await addYesVote(matchId, leader.id);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hub.id));
    const page = await get(
      `/lineups/${lineupId}/schedule/${matchId}`,
      adminToken,
    );
    expect(page.body.hub).toBeNull();
    expect(page.body.slots[0]?.votes[0]).not.toHaveProperty('isHubMember');
    const active = await get('/scheduling-polls/active', adminToken);
    const item = (active.body as ListItem[]).find((p) => p.matchId === matchId);
    expect(item).toBeDefined();
    expect(item?.hub).toBeNull();
    const hubList = await get(`/hubs/${hub.id}/polls`, adminToken);
    expect(hubList.body).toEqual([]);
  });
});

describe('hub polls — inheritance', () => {
  it('a reschedule poll inherits its event hub', async () => {
    const hub = await mkHub(await mkUser());
    const start = new Date(Date.now() + 2 * 864e5);
    const [event] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({
          title: 'Hub night',
          gameId: testApp.seed.game.id,
          creatorId: testApp.seed.adminUser.id,
          duration: [start, new Date(start.getTime() + 72e5)],
          guildId: hub.id,
        })
        .returning(),
      'event',
    );
    const res = await createPoll(adminToken, { linkedEventId: event.id });
    expect(res.status).toBe(201);
    expect(await lineupGuildId(pollIds(res.body).matchId)).toBe(hub.id);
  });

  it('a reschedule poll does not inherit a hub of another game', async () => {
    const [other] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: next('Other'), slug: next('other') })
        .returning(),
      'game',
    );
    const hub = await mkHub(await mkUser(), [], other.id);
    const start = new Date(Date.now() + 2 * 864e5);
    const [event] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({
          title: 'Mismatched hub night',
          gameId: testApp.seed.game.id,
          creatorId: testApp.seed.adminUser.id,
          duration: [start, new Date(start.getTime() + 72e5)],
          guildId: hub.id,
        })
        .returning(),
      'event',
    );
    const res = await createPoll(adminToken, { linkedEventId: event.id });
    expect(res.status).toBe(201);
    expect(await lineupGuildId(pollIds(res.body).matchId)).toBeNull();
  });
});

describe('hub polls — lock-in', () => {
  it('a plain member who made a hub poll locks it in: the event inherits the hub (no 403)', async () => {
    const member = await mkUser();
    const hub = await mkHub(await mkUser(), [member]);
    const poll = await createPoll(member.token, { hubId: hub.id });
    expect(poll.status).toBe(201);
    const start = new Date(Date.now() + 3 * 864e5);
    const res = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${member.token}`)
      .send({
        title: 'Member lock-in',
        gameId: testApp.seed.game.id,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 72e5).toISOString(),
        schedulingMatchId: pollIds(poll.body).matchId,
      });
    expect(res.status).toBe(201);
    const [row] = nonEmpty(
      await testApp.db
        .select({ guildId: schema.events.guildId })
        .from(schema.events)
        .where(eq(schema.events.id, (res.body as { id: number }).id)),
      'event',
    );
    expect(row.guildId).toBe(hub.id);
  });

  it('an event created from a hub poll match inherits the hub', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    const poll = await createPoll(leader.token, { hubId: hub.id });
    const start = new Date(Date.now() + 3 * 864e5);
    const res = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'From the poll',
        gameId: testApp.seed.game.id,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 72e5).toISOString(),
        schedulingMatchId: pollIds(poll.body).matchId,
      });
    expect(res.status).toBe(201);
    const [row] = nonEmpty(
      await testApp.db
        .select({ guildId: schema.events.guildId })
        .from(schema.events)
        .where(eq(schema.events.id, (res.body as { id: number }).id)),
      'event',
    );
    expect(row.guildId).toBe(hub.id);
  });
});
