/**
 * ROK-1617 item E — a standalone poll hearts the game for YES-voters only.
 *
 * Locking a standalone poll in auto-hearts the game for its voters
 * (`StandalonePollService.fireAutoSignup` → `insertPollInterests`). That set
 * used to be "everyone who answered the poll", so a member whose only answer
 * was "doesn't work" had a heart written onto their profile — the inversion
 * the lock-in path (`scheduling-event.helpers.ts`) already refuses. Operator
 * ruling 2026-09-20: "The yes voter".
 *
 * The auto-signup/auto-heart chain is fire-and-forget (the HTTP handler does
 * not await it), so every assertion here waits for the write to land first —
 * see `waitForInterest`. Negative assertions are only made once a POSITIVE
 * one has proven the insert already ran, so "no row" means suppressed, never
 * "not yet".
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { and, eq } from 'drizzle-orm';

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

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** A member who exists only to carry a vote row — no login needed. */
async function createMember(tag: string): Promise<number> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${tag}@test.local`,
      username: tag,
      role: 'member',
    })
    .returning();
  return user.id;
}

/** Open a standalone poll for the seeded game as the admin. */
async function openPoll(): Promise<number> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** Add a proposed time slot to the poll's match. */
async function addSlot(matchId: number, proposedTime: Date): Promise<number> {
  const [slot] = await testApp.db
    .insert(schema.communityLineupScheduleSlots)
    .values({ matchId, proposedTime, suggestedBy: 'user' })
    .returning();
  return slot.id;
}

/** Record one member's answer to one slot. */
async function addVote(
  slotId: number,
  userId: number,
  stance: 'yes' | 'no',
): Promise<void> {
  await testApp.db
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId, userId, stance });
}

/** The event the lock-in signs the winning slot's voters up to. */
async function createEvent(start: Date): Promise<number> {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Locked In',
      gameId: testApp.seed.game.id,
      duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
      maxAttendees: 10,
      creatorId: testApp.seed.adminUser.id,
    })
    .returning();
  return event.id;
}

/** POST the lock-in that triggers auto-signup + auto-heart. */
async function completePoll(
  matchId: number,
  eventId: number,
  startTime: Date,
): Promise<void> {
  const res = await testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ eventId, startTime: startTime.toISOString() });
  expect(res.status).toBe(200);
}

/**
 * Every user id holding a POLL-sourced heart for the seeded game.
 *
 * `insertPollInterests` stamps `source: 'poll'`, and the unique key is
 * (user, game, source) — so a member who already hearted this game manually
 * or via Steam holds a separate row. Filtering on the source keeps these
 * assertions about what the lock-in wrote, not about what was already there.
 */
async function pollHeartedUserIds(): Promise<number[]> {
  const rows = await testApp.db
    .select({ userId: schema.gameInterests.userId })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.gameId, testApp.seed.game.id),
        eq(schema.gameInterests.source, 'poll'),
      ),
    );
  return rows.map((r) => r.userId);
}

/** Wait (≤2s) until `userId` has been hearted — the write is not awaited. */
async function waitForInterest(userId: number): Promise<number[]> {
  let ids: number[] = [];
  await waitFor(async () => {
    ids = await pollHeartedUserIds();
    expect(ids).toContain(userId);
  });
  return ids;
}

/** Open a poll with one slot and lock it in at that slot's time. */
async function runSingleSlotPoll(
  votes: { userId: number; stance: 'yes' | 'no' }[],
): Promise<void> {
  const matchId = await openPoll();
  const slotTime = new Date(Date.now() + 86_400_000);
  const slotId = await addSlot(matchId, slotTime);
  for (const v of votes) await addVote(slotId, v.userId, v.stance);
  const eventId = await createEvent(slotTime);
  await completePoll(matchId, eventId, slotTime);
}

describe('ROK-1617 item E — standalone poll auto-heart is yes-voters only', () => {
  it('hearts a yes-voter and never a member whose only answer was "doesn\'t work"', async () => {
    const yesVoter = await createMember('heart-yes');
    const noVoter = await createMember('heart-no');

    await runSingleSlotPoll([
      { userId: yesVoter, stance: 'yes' },
      { userId: noVoter, stance: 'no' },
    ]);

    // The yes-voter's row landing proves the bulk insert already ran, so the
    // no-voter's absence below is a decision, not a race.
    const hearted = await waitForInterest(yesVoter);
    expect(hearted).toContain(yesVoter);
    expect(hearted).not.toContain(noVoter);
  });

  it('hearts a member who said yes to one time and no to another exactly once', async () => {
    const mixedVoter = await createMember('heart-mixed');
    const matchId = await openPoll();
    const winning = new Date(Date.now() + 86_400_000);
    const rejected = new Date(Date.now() + 172_800_000);
    await addVote(await addSlot(matchId, winning), mixedVoter, 'no');
    await addVote(await addSlot(matchId, rejected), mixedVoter, 'yes');
    const eventId = await createEvent(winning);

    await completePoll(matchId, eventId, winning);

    // Hearted for the GAME even though they rejected the time that won.
    const hearted = await waitForInterest(mixedVoter);
    expect(hearted.filter((id) => id === mixedVoter)).toHaveLength(1);
  });

  it('never re-hearts a yes-voter who explicitly un-hearted the game', async () => {
    const suppressed = await createMember('heart-suppressed');
    const plain = await createMember('heart-plain');
    await testApp.db
      .insert(schema.gameInterestSuppressions)
      .values({ userId: suppressed, gameId: testApp.seed.game.id });

    await runSingleSlotPoll([
      { userId: suppressed, stance: 'yes' },
      { userId: plain, stance: 'yes' },
    ]);

    const hearted = await waitForInterest(plain);
    expect(hearted).toContain(plain);
    expect(hearted).not.toContain(suppressed);
  });
});
