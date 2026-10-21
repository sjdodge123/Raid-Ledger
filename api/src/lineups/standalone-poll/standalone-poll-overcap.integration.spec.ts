/**
 * ROK-1874 AC5–7 — locking a standalone poll onto a full roster benches the
 * overflow voter and DMs them "On the bench" instead of "Auto-signed up".
 *
 * Flow under test is the real one the create form drives: POST /events with
 * `schedulingMatchId` (which signs the creator up first), then
 * POST /scheduling-polls/:matchId/complete. The auto-signup + DM chain is
 * fire-and-forget after `/complete`, so every assertion first waits (via the
 * repo's `waitFor` poll helper) until EVERY selected voter's notification row
 * has landed — a missing "On the bench" row is then a decision, never "not
 * yet".
 *
 * Roster arithmetic (spec "Test tiers"): a generic roster with
 * `slotConfig.player = 2`, `maxAttendees = 2`. The creator's own signup takes
 * one spot, so creator + 2 other yes-voters overflows by exactly one.
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

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ROSTER_CAP = 2;
/** Bound for the fire-and-forget chain (N signups + N DMs); not a sleep. */
const CHAIN_DEADLINE_MS = 10_000;

/** A member who exists only to carry a vote row — no login needed. */
async function createMember(tag: string): Promise<number> {
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
  return user.id;
}

/** Open a standalone poll for the seeded game as the admin (the creator). */
async function openPoll(): Promise<number> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** Add one slot and a YES vote on it from every user in `yesVoters`. */
async function addSlotWithYesVotes(
  matchId: number,
  proposedTime: Date,
  yesVoters: number[],
): Promise<void> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime, suggestedBy: 'user' })
      .returning(),
    'slot',
  );
  for (const userId of yesVoters) {
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId: slot.id, userId, stance: 'yes' });
  }
}

/** POST /events from the poll on an N-spot generic roster; returns its id. */
async function createEventFromPoll(
  matchId: number,
  start: Date,
): Promise<number> {
  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Locked In Over Cap',
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + TWO_HOURS_MS).toISOString(),
      gameId: testApp.seed.game.id,
      slotConfig: { type: 'generic', player: ROSTER_CAP },
      maxAttendees: ROSTER_CAP,
      schedulingMatchId: matchId,
    });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** POST the lock-in that triggers auto-signup + the voter DMs. */
async function completePoll(
  matchId: number,
  eventId: number,
  start: Date,
): Promise<void> {
  const res = await testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ eventId, startTime: start.toISOString() });
  expect(res.status).toBe(200);
}

interface LineupNote {
  userId: number;
  title: string;
  eventId: unknown;
}

/** Every `community_lineup` notification row for `userIds`. */
async function lineupNotes(userIds: number[]): Promise<LineupNote[]> {
  const rows = await testApp.db
    .select({
      userId: schema.notifications.userId,
      title: schema.notifications.title,
      payload: schema.notifications.payload,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.type, 'community_lineup'));
  return rows
    .filter((r) => userIds.includes(r.userId))
    .map((r) => ({
      userId: r.userId,
      title: r.title,
      eventId: (r.payload as { eventId?: unknown } | null)?.eventId,
    }));
}

/** Wait until every one of `userIds` holds at least one lineup DM row. */
async function waitForAllNotified(userIds: number[]): Promise<LineupNote[]> {
  let notes: LineupNote[] = [];
  await waitFor(async () => {
    notes = await lineupNotes(userIds);
    const notified = [...new Set(notes.map((n) => n.userId))].sort();
    expect(notified).toEqual([...userIds].sort());
  }, CHAIN_DEADLINE_MS);
  return notes;
}

/** User ids whose roster assignment for `eventId` is the bench. */
async function benchedUserIds(eventId: number): Promise<number[]> {
  const rows = await testApp.db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, 'bench'),
      ),
    );
  return rows.map((r) => r.userId).filter((id): id is number => id !== null);
}

/** Open a one-slot poll, lock it via the create-form flow, return the event. */
async function lockPollWithYesVoters(yesVoters: number[]): Promise<number> {
  const matchId = await openPoll();
  const slotTime = new Date(Date.now() + 86_400_000);
  slotTime.setUTCMilliseconds(0);
  await addSlotWithYesVotes(matchId, slotTime, yesVoters);
  const eventId = await createEventFromPoll(matchId, slotTime);
  await completePoll(matchId, eventId, slotTime);
  return eventId;
}

describe('ROK-1874 AC5 — over-cap lock benches the overflow voter', () => {
  it('benches exactly one voter, who gets "On the bench"; everyone else "Auto-signed up"', async () => {
    const creator = testApp.seed.adminUser.id;
    const others = [
      await createMember('overcap-a'),
      await createMember('overcap-b'),
    ];
    const voters = [creator, ...others];

    const eventId = await lockPollWithYesVoters(voters);
    const notes = await waitForAllNotified(voters);

    const benched = await benchedUserIds(eventId);
    expect(benched).toHaveLength(1);
    const [benchedId] = benched;
    // The creator signed up first, so the overflow is one of the others.
    expect(others).toContain(benchedId);

    const benchedNotes = notes.filter((n) => n.userId === benchedId);
    expect(benchedNotes.map((n) => n.title)).toEqual(['On the bench']);
    expect(benchedNotes.map((n) => n.eventId)).toEqual([eventId]);

    for (const uid of voters.filter((id) => id !== benchedId)) {
      const mine = notes.filter((n) => n.userId === uid);
      expect({ uid, titles: mine.map((n) => n.title) }).toEqual({
        uid,
        titles: ['Auto-signed up'],
      });
    }
    // Nobody but the benched voter heard "On the bench".
    expect(
      notes.filter((n) => n.title === 'On the bench').map((n) => n.userId),
    ).toEqual([benchedId]);
  });
});

describe('ROK-1874 AC6 — at-cap lock benches nobody', () => {
  it('fills the roster exactly with no bench row and no "On the bench" DM', async () => {
    const creator = testApp.seed.adminUser.id;
    const other = await createMember('atcap-a');
    const voters = [creator, other];

    const eventId = await lockPollWithYesVoters(voters);
    const notes = await waitForAllNotified(voters);

    expect(await benchedUserIds(eventId)).toEqual([]);
    expect(notes.map((n) => n.title)).toEqual([
      'Auto-signed up',
      'Auto-signed up',
    ]);
    expect(notes.every((n) => n.eventId === eventId)).toBe(true);
  });
});
