/**
 * ROK-1844 — completing a standalone poll is owner/staff-only, validated and
 * one-shot.
 *
 * Before the fix `POST /scheduling-polls/:matchId/complete` only checked
 * ownership for a poll LINKED to an event, so any member could close any
 * unlinked poll (private ones included) and, by passing an arbitrary
 * `eventId`, sign every yes-voter onto an event they never chose. A repeat call
 * re-fired the signups. These cases pin each acceptance criterion:
 *
 *   AC1  only the poll creator, the linked-event creator or staff may complete
 *        (403; 404 for a private poll the caller cannot view)
 *   AC2  the body is a strict schema — malformed input is a 400
 *   AC3  a supplied `eventId` must be the caller's (or staff's) and belong to /
 *        be created from this match
 *   AC4  completion is a compare-and-set — a repeat call is a 409
 *
 * Every refusal also proves the side effects never ran: the poll stays open and
 * the yes-voter holds no signup. The auto-signup chain is fire-and-forget, so
 * "no signup" is only asserted where the request was refused BEFORE completion
 * (the poll is still `scheduling`), which the handler checks synchronously.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../common/testing/narrow';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

const DAY_MS = 86_400_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

interface Member {
  token: string;
  userId: number;
}

/** Create a non-admin member and return their bearer token + id. */
async function loginAsMember(tag: string): Promise<Member> {
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('MemberPass1!', 4);
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@test.local`,
        username: tag,
        role: 'member',
      })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email: `${tag}@test.local`,
    passwordHash: hash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: `${tag}@test.local`, password: 'MemberPass1!' });
  expect(res.status).toBe(200);
  return { token: res.body.access_token as string, userId: user.id };
}

/** A member who exists only to carry a yes-vote — no login needed. */
async function createVoter(tag: string): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${tag}@test.local`, username: tag })
      .returning(),
    'voter',
  );
  return user.id;
}

/** Open an UNLINKED standalone poll as `token`; returns the match id. */
async function openPoll(
  token: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId: testApp.seed.game.id, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** Add one slot a day out and a yes-vote on it; returns the slot time. */
async function addYesVote(matchId: number, voterId: number): Promise<Date> {
  const proposedTime = new Date(Date.now() + DAY_MS);
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime, suggestedBy: 'user' })
      .returning(),
    'slot',
  );
  await testApp.db
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId: slot.id, userId: voterId, stance: 'yes' });
  return proposedTime;
}

/** Insert an event for the seeded game owned by `creatorId`. */
async function createEvent(
  creatorId: number,
  start: Date,
  createdAt?: Date,
): Promise<number> {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Poll Night',
        gameId: testApp.seed.game.id,
        duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
        maxAttendees: 10,
        creatorId,
        ...(createdAt ? { createdAt } : {}),
      })
      .returning(),
    'event',
  );
  return event.id;
}

/** POST /scheduling-polls/:matchId/complete as `token` with `body`. */
function complete(token: string, matchId: number, body?: unknown) {
  const req = testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
}

/** The match status — `scheduling` while the poll is open. */
async function matchStatus(matchId: number): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ status: schema.communityLineupMatches.status })
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId)),
    'match',
  );
  return row.status;
}

/** Signup rows for `userId` on `eventId`. */
async function signupCount(eventId: number, userId: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return rows.length;
}

/** The poll was refused before completion: still open, nobody signed up. */
async function expectUntouched(
  matchId: number,
  eventId: number,
  voterId: number,
): Promise<void> {
  expect(await matchStatus(matchId)).toBe('scheduling');
  expect(await signupCount(eventId, voterId)).toBe(0);
}

/** A creator's open poll with one yes-voter and the creator's own event. */
async function seedOwnPoll(tag: string) {
  const creator = await loginAsMember(`${tag}-creator`);
  const voterId = await createVoter(`${tag}-voter`);
  const matchId = await openPoll(creator.token);
  const slotTime = await addYesVote(matchId, voterId);
  const eventId = await createEvent(creator.userId, slotTime);
  return { creator, voterId, matchId, slotTime, eventId };
}

function describeAc1() {
  it('403s a non-creator completing an unlinked public poll — no signups, poll still open', async () => {
    const { voterId, matchId, slotTime, eventId } = await seedOwnPoll('ac1');
    const stranger = await loginAsMember('ac1-stranger');
    const strangerEvent = await createEvent(stranger.userId, slotTime);

    const res = await complete(stranger.token, matchId, {
      eventId: strangerEvent,
      startTime: slotTime.toISOString(),
    });

    expect(res.status).toBe(403);
    await expectUntouched(matchId, strangerEvent, voterId);
    expect(await signupCount(eventId, voterId)).toBe(0);
  });

  it('404s a member completing a private poll they cannot view', async () => {
    const creator = await loginAsMember('ac1p-creator');
    const stranger = await loginAsMember('ac1p-stranger');
    const matchId = await openPoll(creator.token, { visibility: 'private' });

    const res = await complete(stranger.token, matchId);

    expect(res.status).toBe(404);
    expect(await matchStatus(matchId)).toBe('scheduling');
  });

  it('lets the creator complete their own poll and signs the yes-voter up', async () => {
    const { creator, voterId, matchId, slotTime, eventId } =
      await seedOwnPoll('ac1ok');

    const res = await complete(creator.token, matchId, {
      eventId,
      startTime: slotTime.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(await matchStatus(matchId)).toBe('scheduled');
    await waitFor(async () => {
      expect(await signupCount(eventId, voterId)).toBe(1);
    });
  });

  it("lets an admin complete another member's poll with that member's event", async () => {
    const { voterId, matchId, slotTime, eventId } = await seedOwnPoll('ac1a');

    const res = await complete(adminToken, matchId, {
      eventId,
      startTime: slotTime.toISOString(),
    });

    expect(res.status).toBe(200);
    await waitFor(async () => {
      expect(await signupCount(eventId, voterId)).toBe(1);
    });
  });
}
describe('ROK-1844 AC1 — only the creator or staff may complete', describeAc1);

function describeAc2() {
  const malformed: [string, unknown][] = [
    ['a non-numeric eventId', { eventId: 'abc' }],
    ['a negative eventId', { eventId: -1 }],
    ['a fractional eventId', { eventId: 1.5 }],
    ['a non-ISO startTime', { eventId: 1, startTime: 'next tuesday' }],
    ['an unknown key', { eventId: 1, voters: [1, 2, 3] }],
  ];
  it.each(malformed)('400s %s and leaves the poll open', async (_, body) => {
    const { creator, matchId } = await seedOwnPoll('ac2');

    const res = await complete(creator.token, matchId, body);

    expect(res.status).toBe(400);
    expect(await matchStatus(matchId)).toBe('scheduling');
  });
}
describe('ROK-1844 AC2 — the complete body is strictly validated', describeAc2);

function describeAc3() {
  it("403s the creator passing someone else's event", async () => {
    const { creator, voterId, matchId, slotTime } = await seedOwnPoll('ac3');
    const other = await loginAsMember('ac3-other');
    const foreignEvent = await createEvent(other.userId, slotTime);

    const res = await complete(creator.token, matchId, {
      eventId: foreignEvent,
      startTime: slotTime.toISOString(),
    });

    expect(res.status).toBe(403);
    await expectUntouched(matchId, foreignEvent, voterId);
  });

  it('403s the creator passing their own event that predates the poll', async () => {
    const { creator, voterId, matchId, slotTime } = await seedOwnPoll('ac3old');
    const oldEvent = await createEvent(
      creator.userId,
      slotTime,
      new Date(Date.now() - 7 * DAY_MS),
    );

    const res = await complete(creator.token, matchId, {
      eventId: oldEvent,
      startTime: slotTime.toISOString(),
    });

    expect(res.status).toBe(403);
    await expectUntouched(matchId, oldEvent, voterId);
  });

  it('404s an eventId that does not exist and leaves the poll open', async () => {
    const { creator, matchId } = await seedOwnPoll('ac3gone');

    const res = await complete(creator.token, matchId, { eventId: 999_999 });

    expect(res.status).toBe(404);
    expect(await matchStatus(matchId)).toBe('scheduling');
  });
}
describe('ROK-1844 AC3 — eventId must be ours and from this match', describeAc3);

function describeAc4() {
  it('409s a repeat complete and fires no second round of signups', async () => {
    const { creator, voterId, matchId, slotTime, eventId } =
      await seedOwnPoll('ac4');
    const body = { eventId, startTime: slotTime.toISOString() };
    expect((await complete(creator.token, matchId, body)).status).toBe(200);
    await waitFor(async () => {
      expect(await signupCount(eventId, voterId)).toBe(1);
    });
    // Withdraw the voter: a re-fired auto-signup would sign them up again.
    await testApp.db
      .delete(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    const repeat = await complete(creator.token, matchId, body);

    expect(repeat.status).toBe(409);
    expect(await signupCount(eventId, voterId)).toBe(0);
  });
}
describe('ROK-1844 AC4 — completion is one-shot', describeAc4);
