/**
 * Private standalone polls shared by link — integration (ROK-1750 spec §9).
 *
 * Real DB, real HTTP. Covers:
 *   1. private poll page (+ availability, other-polls) hidden from anon +
 *      non-invitees; vote → 403
 *   2. preview: minimal fields only; unknown / malformed / reset → one 404
 *   3. join: invitee + member rows, then view + vote; second join idempotent
 *   4. deactivated join → 403; creator join → joined:false, no rows
 *   5. archived poll: join → invitee only; vote rejected (poll closed)
 *   6. reset: non-creator 403, creator / admin 200, old token dead at once,
 *      already-joined users keep access
 *   7. GET /scheduling-polls/active visibility per caller
 *   8. create private: no broadcast, no channel card, picked members DM'd
 *      + rowed as invitees; private + linkedEventId → 400
 *
 * The test app is a per-worker singleton, so `jest.mock` never reaches it —
 * the Discord-facing services are spied on the live instances the app holds.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';

let testApp: TestApp;
let adminToken: string;
let tag = 0;

let interestSpy: jest.SpyInstance;
let pickedSpy: jest.SpyInstance;
let postEmbedSpy: jest.SpyInstance;
let updateEmbedSpy: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
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
  updateEmbedSpy = jest
    .spyOn(embed, 'fireUpdateEmbed')
    .mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ── Helpers ───────────────────────────────────────────────────

interface Member {
  token: string;
  userId: number;
}

async function loginAsMember(name = 'member'): Promise<Member> {
  const handle = `${name}${++tag}`;
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('MemberPass1!', 4);
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${handle}@test.local`,
        username: handle,
        role: 'member',
      })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email: `${handle}@test.local`,
    passwordHash: hash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: `${handle}@test.local`, password: 'MemberPass1!' });
  return { token: res.body.access_token as string, userId: user.id };
}

interface CreatedPoll {
  matchId: number;
  lineupId: number;
  shareToken: string;
}

function auth(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

async function createPoll(
  token: string,
  extra: Record<string, unknown> = {},
): Promise<CreatedPoll> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set(...auth(token))
    .send({ gameId: testApp.seed.game.id, visibility: 'private', ...extra });
  expect(res.status).toBe(201);
  return {
    matchId: res.body.id as number,
    lineupId: res.body.lineupId as number,
    shareToken: res.body.shareToken as string,
  };
}

async function addSlot(matchId: number): Promise<number> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + 3 * 86_400_000),
        suggestedBy: 'user',
      })
      .returning(),
    'slot',
  );
  return slot.id;
}

const getPage = (poll: CreatedPoll, token?: string) => {
  const req = testApp.request.get(
    `/lineups/${poll.lineupId}/schedule/${poll.matchId}`,
  );
  return token ? req.set(...auth(token)) : req;
};

const vote = (poll: CreatedPoll, token: string, slotId: number) =>
  testApp.request
    .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/vote`)
    .set(...auth(token))
    .send({ slotId });

const preview = (shareToken: string) =>
  testApp.request.get(`/scheduling-polls/share/${shareToken}`);

const join = (shareToken: string, token: string) =>
  testApp.request
    .post(`/scheduling-polls/share/${shareToken}/join`)
    .set(...auth(token));

const reset = (matchId: number, token: string) =>
  testApp.request
    .post(`/scheduling-polls/${matchId}/share-token/reset`)
    .set(...auth(token));

const listActive = (token: string) =>
  testApp.request.get('/scheduling-polls/active').set(...auth(token));

async function inviteeRows(lineupId: number, userId: number) {
  return testApp.db
    .select()
    .from(schema.communityLineupInvitees)
    .where(
      and(
        eq(schema.communityLineupInvitees.lineupId, lineupId),
        eq(schema.communityLineupInvitees.userId, userId),
      ),
    );
}

async function memberRows(matchId: number, userId: number) {
  return testApp.db
    .select()
    .from(schema.communityLineupMatchMembers)
    .where(
      and(
        eq(schema.communityLineupMatchMembers.matchId, matchId),
        eq(schema.communityLineupMatchMembers.userId, userId),
      ),
    );
}

async function deactivate(userId: number): Promise<void> {
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/** A well-formed (43-char base64url) token no poll holds. */
const UNKNOWN_TOKEN = 'A'.repeat(42) + 'b';

// ── 1. Private poll page is hidden from outsiders ─────────────

describe('ROK-1750 private poll — outsiders', () => {
  it('404s the poll page for anon + non-invitees and 403s their vote', async () => {
    const creator = await loginAsMember('creator');
    const outsider = await loginAsMember('outsider');
    const poll = await createPoll(creator.token);
    const slotId = await addSlot(poll.matchId);

    expect((await getPage(poll)).status).toBe(404);
    expect((await getPage(poll, outsider.token)).status).toBe(404);
    expect((await vote(poll, outsider.token, slotId)).status).toBe(403);
    // The creator still sees their own poll.
    expect((await getPage(poll, creator.token)).status).toBe(200);
  });

  // Review m3: the page's side reads apply the same 404 to an outsider.
  it('404s availability + other-polls for a non-invitee, like the page', async () => {
    const creator = await loginAsMember('creator');
    const outsider = await loginAsMember('outsider');
    const poll = await createPoll(creator.token);
    const side = (path: string, token: string) =>
      testApp.request
        .get(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/${path}`)
        .set(...auth(token));

    expect((await side('availability', outsider.token)).status).toBe(404);
    expect((await side('other-polls', outsider.token)).status).toBe(404);
    expect((await side('availability', creator.token)).status).toBe(200);
    expect((await side('other-polls', creator.token)).status).toBe(200);
    expect((await side('availability', adminToken)).status).toBe(200);
  });
});

// ── 2. Preview ────────────────────────────────────────────────

describe('ROK-1750 share preview', () => {
  it('returns only the minimal landing-card fields, signed out', async () => {
    const creator = await loginAsMember('creator');
    const poll = await createPoll(creator.token);
    await addSlot(poll.matchId);

    const res = await preview(poll.shareToken);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'creatorDisplayName',
      'gameCoverUrl',
      'gameName',
      'isOpen',
      'memberCount',
    ]);
    expect(res.body).toMatchObject({
      gameName: testApp.seed.game.name,
      isOpen: true,
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/discordId|slot|proposedTime/i);
  });

  it('gives unknown, malformed and reset tokens one identical 404', async () => {
    const creator = await loginAsMember('creator');
    const poll = await createPoll(creator.token);
    expect((await reset(poll.matchId, creator.token)).status).toBe(200);

    const responses = await Promise.all(
      [UNKNOWN_TOKEN, 'not-a-token', poll.shareToken].map(preview),
    );
    for (const res of responses) expect(res.status).toBe(404);
    const [unknown, malformed, wasReset] = responses.map((r) => r.body);
    expect(malformed).toEqual(unknown);
    expect(wasReset).toEqual(unknown);
  });
});

// ── 3 + 4. Join ───────────────────────────────────────────────

describe('ROK-1750 share join', () => {
  it('rows the visitor as invitee + member, then lets them view and vote', async () => {
    const creator = await loginAsMember('creator');
    const visitor = await loginAsMember('visitor');
    const poll = await createPoll(creator.token);
    const slotId = await addSlot(poll.matchId);

    const first = await join(poll.shareToken, visitor.token);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      lineupId: poll.lineupId,
      matchId: poll.matchId,
      joined: true,
    });
    const invitees = await inviteeRows(poll.lineupId, visitor.userId);
    expect(invitees).toHaveLength(1);
    expect(nonEmpty(invitees, 'invitee')[0].invitedBy).toBe(creator.userId);
    expect(await memberRows(poll.matchId, visitor.userId)).toHaveLength(1);

    expect((await getPage(poll, visitor.token)).status).toBe(200);
    expect((await vote(poll, visitor.token, slotId)).status).toBe(200);
    // Joining nudges open pages but never posts a Discord card.
    expect(updateEmbedSpy).toHaveBeenCalledWith(poll.matchId);
    expect(postEmbedSpy).not.toHaveBeenCalled();
  });

  it('is idempotent — second join reports joined:false, adds no rows', async () => {
    const creator = await loginAsMember('creator');
    const visitor = await loginAsMember('visitor');
    const poll = await createPoll(creator.token);

    expect((await join(poll.shareToken, visitor.token)).body.joined).toBe(true);
    const second = await join(poll.shareToken, visitor.token);
    expect(second.status).toBe(200);
    expect(second.body.joined).toBe(false);
    expect(await inviteeRows(poll.lineupId, visitor.userId)).toHaveLength(1);
    expect(await memberRows(poll.matchId, visitor.userId)).toHaveLength(1);
  });

  // ROK-1753: JwtStrategy rejects a deactivated user's token (401
  // USER_DEACTIVATED) before NotDeactivatedGuard's 403 can run.
  it('401s a deactivated user and writes no rows', async () => {
    const creator = await loginAsMember('creator');
    const visitor = await loginAsMember('visitor');
    const poll = await createPoll(creator.token);
    await deactivate(visitor.userId);

    const res = await join(poll.shareToken, visitor.token);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'USER_DEACTIVATED' });
    expect(await inviteeRows(poll.lineupId, visitor.userId)).toHaveLength(0);
    expect(await memberRows(poll.matchId, visitor.userId)).toHaveLength(0);
  });

  it('reports joined:false for the creator and adds no invitee row', async () => {
    const creator = await loginAsMember('creator');
    const poll = await createPoll(creator.token);

    const res = await join(poll.shareToken, creator.token);
    expect(res.status).toBe(200);
    expect(res.body.joined).toBe(false);
    expect(await inviteeRows(poll.lineupId, creator.userId)).toHaveLength(0);
  });

  it('404s join on an unknown or malformed token', async () => {
    const visitor = await loginAsMember('visitor');
    expect((await join(UNKNOWN_TOKEN, visitor.token)).status).toBe(404);
    expect((await join('short', visitor.token)).status).toBe(404);
  });
});

// ── 5. Archived poll ──────────────────────────────────────────

describe('ROK-1750 share join on a closed poll', () => {
  it('grants the invitee row only, and the vote is rejected', async () => {
    const creator = await loginAsMember('creator');
    const visitor = await loginAsMember('visitor');
    const poll = await createPoll(creator.token);
    const slotId = await addSlot(poll.matchId);
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, poll.lineupId));

    const res = await join(poll.shareToken, visitor.token);
    expect(res.status).toBe(200);
    expect(res.body.joined).toBe(true);
    expect(await inviteeRows(poll.lineupId, visitor.userId)).toHaveLength(1);
    expect(await memberRows(poll.matchId, visitor.userId)).toHaveLength(0);

    const voted = await vote(poll, visitor.token, slotId);
    expect(voted.status).toBe(400);
    expect(voted.body.message).toBe('This poll is no longer accepting votes');
  });
});

// ── 6. Reset ──────────────────────────────────────────────────

describe('ROK-1750 share-token reset', () => {
  it('403s a non-creator and leaves the token working', async () => {
    const creator = await loginAsMember('creator');
    const outsider = await loginAsMember('outsider');
    const poll = await createPoll(creator.token);

    expect((await reset(poll.matchId, outsider.token)).status).toBe(403);
    expect((await preview(poll.shareToken)).status).toBe(200);
  });

  it('rotates for the creator; old token dies, joined users keep access', async () => {
    const creator = await loginAsMember('creator');
    const joined = await loginAsMember('joined');
    const late = await loginAsMember('late');
    const poll = await createPoll(creator.token);
    expect((await join(poll.shareToken, joined.token)).body.joined).toBe(true);

    const res = await reset(poll.matchId, creator.token);
    expect(res.status).toBe(200);
    const fresh = res.body.shareToken as string;
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fresh).not.toBe(poll.shareToken);

    expect((await preview(poll.shareToken)).status).toBe(404);
    expect((await join(poll.shareToken, late.token)).status).toBe(404);
    expect(await inviteeRows(poll.lineupId, late.userId)).toHaveLength(0);
    expect((await preview(fresh)).status).toBe(200);
    expect((await getPage(poll, joined.token)).status).toBe(200);
  });

  it('lets an admin rotate a member-created poll', async () => {
    const creator = await loginAsMember('creator');
    const poll = await createPoll(creator.token);

    const res = await reset(poll.matchId, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.shareToken).not.toBe(poll.shareToken);
    expect((await preview(poll.shareToken)).status).toBe(404);
  });

  it('404s reset on a public poll', async () => {
    const creator = await loginAsMember('creator');
    const poll = await createPoll(creator.token, { visibility: 'public' });
    expect((await reset(poll.matchId, creator.token)).status).toBe(404);
  });
});

// ── Poll page shareToken projection ───────────────────────────

describe('ROK-1750 poll page visibility + shareToken', () => {
  it('shows the token to a signed-in invitee of a private poll', async () => {
    const creator = await loginAsMember('creator');
    const visitor = await loginAsMember('visitor');
    const poll = await createPoll(creator.token);
    await join(poll.shareToken, visitor.token);

    const res = await getPage(poll, visitor.token);
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('private');
    expect(res.body.shareToken).toBe(poll.shareToken);
  });

  it('hides a private poll page (and its token) from a deactivated invitee', async () => {
    const creator = await loginAsMember('creator');
    const visitor = await loginAsMember('visitor');
    const poll = await createPoll(creator.token);
    await join(poll.shareToken, visitor.token);
    await deactivate(visitor.userId);

    // ROK-1629: a deactivated viewer is not a member viewer, so a private
    // poll is as hidden from them as from an anonymous visitor.
    const res = await getPage(poll, visitor.token);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(poll.shareToken);
  });

  it('reports a public poll as public with a null token, anonymously', async () => {
    const creator = await loginAsMember('creator');
    const poll = await createPoll(creator.token, { visibility: 'public' });

    const res = await getPage(poll);
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('public');
    expect(res.body.shareToken).toBeNull();
  });
});

// ── 7. Active list ────────────────────────────────────────────

describe('ROK-1750 GET /scheduling-polls/active', () => {
  function matchIds(body: Array<{ matchId: number }>): number[] {
    return body.map((p) => p.matchId);
  }

  it('hides a private poll from outsiders; creator, invitee, admin see it', async () => {
    const creator = await loginAsMember('creator');
    const invitee = await loginAsMember('invitee');
    const outsider = await loginAsMember('outsider');
    const priv = await createPoll(creator.token);
    const pub = await createPoll(creator.token, { visibility: 'public' });
    await join(priv.shareToken, invitee.token);

    const outsiderList = await listActive(outsider.token);
    expect(outsiderList.status).toBe(200);
    expect(matchIds(outsiderList.body)).not.toContain(priv.matchId);
    expect(matchIds(outsiderList.body)).toContain(pub.matchId);

    for (const viewer of [creator.token, invitee.token, adminToken]) {
      const res = await listActive(viewer);
      expect(matchIds(res.body)).toEqual(
        expect.arrayContaining([priv.matchId, pub.matchId]),
      );
    }
    const rows = (await listActive(creator.token)).body as Array<{
      matchId: number;
      visibility: string;
    }>;
    expect(rows.find((r) => r.matchId === priv.matchId)?.visibility).toBe(
      'private',
    );
    expect(rows.find((r) => r.matchId === pub.matchId)?.visibility).toBe(
      'public',
    );
  });
});

// ── 8. Create fan-out ─────────────────────────────────────────

describe('ROK-1750 create private poll fan-out', () => {
  it('sends no broadcast and no channel card; DMs + invites picked members', async () => {
    const creator = await loginAsMember('creator');
    const picked = await loginAsMember('picked');
    const poll = await createPoll(creator.token, {
      memberUserIds: [picked.userId],
    });

    expect(poll.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(interestSpy).not.toHaveBeenCalled();
    expect(postEmbedSpy).not.toHaveBeenCalled();
    expect(pickedSpy).toHaveBeenCalledTimes(1);
    expect(pickedSpy.mock.calls[0][0]).toContain(picked.userId);
    expect(await inviteeRows(poll.lineupId, picked.userId)).toHaveLength(1);
    expect((await getPage(poll, picked.token)).status).toBe(200);
  });

  it('still broadcasts + posts the channel card for a public poll', async () => {
    const creator = await loginAsMember('creator');
    const poll = await createPoll(creator.token, { visibility: 'public' });

    expect(poll.shareToken).toBeNull();
    expect(interestSpy).toHaveBeenCalledTimes(1);
    expect(postEmbedSpy).toHaveBeenCalledTimes(1);
    expect(pickedSpy).not.toHaveBeenCalled();
  });

  it('rejects private + linkedEventId with 400 and creates nothing', async () => {
    const creator = await loginAsMember('creator');
    const res = await testApp.request
      .post('/scheduling-polls')
      .set(...auth(creator.token))
      .send({
        gameId: testApp.seed.game.id,
        visibility: 'private',
        linkedEventId: 1,
      });
    expect(res.status).toBe(400);
    const lineups = await testApp.db.select().from(schema.communityLineups);
    expect(lineups).toHaveLength(0);
  });
});
