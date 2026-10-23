/**
 * ROK-1893 P3 — operator ruling 2026-10-23: until P2b routes hub polls to the
 * hub's own Discord channel, a hub-tagged poll shows ONLY on its hub. Against
 * a real database: creating a hub poll fires no default-channel card and no
 * game-interest DMs, and it is left off the site-wide banner list and the
 * weekly digest — while an untagged poll keeps all of them (regression).
 * Fleet-only.
 */
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
import { fetchUpcomingPollRows } from '../../notifications/weekly-digest-upcoming.helpers';
import { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';

let testApp: TestApp;
let seq = 0;
let interestSpy: jest.SpyInstance;
let pickedSpy: jest.SpyInstance;
let postEmbedSpy: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  const notifications = testApp.app.get(StandalonePollNotificationService);
  const embed = testApp.app.get(SchedulingPollEmbedService);
  interestSpy = jest
    .spyOn(notifications, 'notifyInterestedUsers')
    .mockResolvedValue(undefined);
  pickedSpy = jest
    .spyOn(notifications, 'notifyPickedMembers')
    .mockResolvedValue(undefined);
  postEmbedSpy = jest
    .spyOn(embed, 'firePostInitialEmbed')
    .mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function mkUser(): Promise<{ id: number; token: string }> {
  const username = `hpf-${++seq}-${Date.now() % 100000}`;
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

/** An active community hub on the seed game led by `leaderId`. */
async function mkHub(leaderId: number) {
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name: `Fanout Hub ${++seq}`,
    blurb: 'Hub poll fan-out',
    status: 'active',
    proposedBy: leaderId,
    reviewedBy: null,
  });
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId: hub.id, userId: leaderId, role: 'leader' as const });
  await refreshMemberCount(testApp.db, hub.id);
  return hub;
}

async function createPoll(token: string, body: Record<string, unknown>) {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId: testApp.seed.game.id, ...body });
  expect(res.status).toBe(201);
  return res.body as { id: number; lineupId: number };
}

async function bannerMatchIds(token: string): Promise<number[]> {
  const res = await testApp.request
    .get('/scheduling-polls/active')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body as { matchId: number }[]).map((p) => p.matchId);
}

async function digestMatchIds(): Promise<number[]> {
  return (await fetchUpcomingPollRows(testApp.db)).map((r) => r.matchId);
}

describe('hub poll fan-out (ruling 2026-10-23)', () => {
  it('a hub poll posts no default-channel card and sends no interest DMs', async () => {
    const leader = await mkUser();
    const picked = await mkUser();
    const hub = await mkHub(leader.id);
    const poll = await createPoll(leader.token, {
      hubId: hub.id,
      memberUserIds: [picked.id],
    });
    expect(postEmbedSpy).not.toHaveBeenCalled();
    expect(interestSpy).not.toHaveBeenCalled();
    // Only the members the creator picked are told, as on a private poll.
    expect(pickedSpy).toHaveBeenCalledTimes(1);
    expect(pickedSpy.mock.calls[0]?.[0]).toEqual([picked.id]);
    expect(pickedSpy.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ matchId: poll.id, lineupId: poll.lineupId }),
    );
  });

  it('an untagged poll still posts the card and broadcasts (regression)', async () => {
    const creator = await mkUser();
    const poll = await createPoll(creator.token, {});
    expect(postEmbedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: poll.id }),
      poll.lineupId,
      testApp.seed.game.id,
    );
    expect(interestSpy).toHaveBeenCalledTimes(1);
    expect(interestSpy.mock.calls[0]?.[3]).toBe(poll.id);
    expect(pickedSpy).not.toHaveBeenCalled();
  });
});

describe('hub poll lists (ruling 2026-10-23)', () => {
  it('banner + digest omit the hub poll and keep the untagged one; the hub list has it', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader.id);
    const hubPoll = await createPoll(leader.token, { hubId: hub.id });
    const plain = await createPoll((await mkUser()).token, {});
    const banner = await bannerMatchIds(leader.token);
    expect(banner).toContain(plain.id);
    expect(banner).not.toContain(hubPoll.id);
    const digest = await digestMatchIds();
    expect(digest).toContain(plain.id);
    expect(digest).not.toContain(hubPoll.id);
    const hubList = await testApp.request
      .get(`/hubs/${hub.id}/polls`)
      .set('Authorization', `Bearer ${leader.token}`);
    expect(hubList.status).toBe(200);
    expect((hubList.body as { matchId: number }[]).map((p) => p.matchId)).toEqual(
      [hubPoll.id],
    );
  });
});
