/**
 * ROK-1370 Part 3 — repeatable reschedule cycle + cron/query suppression.
 *
 * Part 2 (#951) made lock-in move the linked event in place instead of
 * cancelling it. Part 1 adds poll-start suppression so the OLD-time event stops
 * firing reminders / start+completion scans / role-gap alerts while a poll is
 * open, resuming once the poll locks in. This suite proves:
 *
 *   - An event can be rescheduled AGAIN (two full poll→lock-in cycles), never
 *     cancelled, moved to each winning time, linkage set then cleared each time.
 *   - The cron candidate queries (reminder / start / completion) EXCLUDE the
 *     event only while its reschedulingPollId is set, and INCLUDE it once clear.
 *
 * The embed-state transitions and Discord Scheduled Event teardown/recreate are
 * covered at the unit tier (discord-embed.factory + event.listener specs) and by
 * the authored Discord smoke tests — the integration app has no live Discord
 * client, so those side effects are no-ops here.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { fetchCandidateEvents } from '../../notifications/event-reminder.helpers';
import {
  findStartCandidates,
  findCompletionCandidates,
} from '../../discord-bot/services/scheduled-event.db-helpers';

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

async function createEvent(
  title: string,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
) {
  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + TWO_HOURS_MS);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      gameId: testApp.seed.game.id,
      duration: [start, end],
      maxAttendees: 10,
      creatorId: testApp.seed.adminUser.id,
      ...overrides,
    })
    .returning();
  return event;
}

function postSchedulingPoll(linkedEventId: number) {
  return testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id, linkedEventId });
}

/** Drive the two-step lock-in: reschedule in place, then complete the poll. */
async function lockInAtNewTime(eventId: number, matchId: number, start: Date) {
  const rr = await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + TWO_HOURS_MS).toISOString(),
    });
  expect(rr.status).toBe(200);
  const cr = await testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(cr.status).toBe(200);
}

async function readEvent(eventId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return row;
}

/** Run one poll→lock-in cycle, asserting linkage set→cleared + move + no cancel. */
async function runCycle(eventId: number, newStart: Date) {
  const pollRes = await postSchedulingPoll(eventId);
  expect(pollRes.status).toBe(201);
  const matchId = pollRes.body.id as number;

  const duringPoll = await readEvent(eventId);
  expect((duringPoll as Record<string, unknown>).reschedulingPollId).toBe(
    matchId,
  );
  expect(duringPoll.cancelledAt).toBeNull();

  await lockInAtNewTime(eventId, matchId, newStart);

  const after = await readEvent(eventId);
  expect((after as Record<string, unknown>).reschedulingPollId).toBeNull();
  expect(after.cancelledAt).toBeNull();
  expect(new Date(after.duration[0]).getTime()).toBe(newStart.getTime());
  return matchId;
}

function describeRepeatableCycle() {
  it('reschedules the same event twice (poll → lock-in → poll → lock-in)', async () => {
    const event = await createEvent('Repeatable Reschedule');

    const firstStart = new Date(Date.now() + 7 * 86_400_000);
    const firstMatch = await runCycle(event.id, firstStart);

    const secondStart = new Date(Date.now() + 14 * 86_400_000);
    const secondMatch = await runCycle(event.id, secondStart);

    // Distinct polls each cycle; event survived both, never cancelled.
    expect(secondMatch).not.toBe(firstMatch);
    const final = await readEvent(event.id);
    expect(final.id).toBe(event.id);
    expect(final.cancelledAt).toBeNull();
  });
}
describe(
  'ROK-1370 Part 3 — repeatable reschedule cycle',
  describeRepeatableCycle,
);

/** Insert a minimal standalone lineup + scheduling match, returning the match
 *  id (a valid FK target for events.reschedulingPollId). */
async function createPollMatch(): Promise<number> {
  const slug = `sup${Math.random().toString(36).slice(2, 10)}`;
  const [lineup] = await testApp.db
    .insert(schema.communityLineups)
    .values({
      title: 'Suppression Test Poll',
      status: 'decided',
      createdBy: testApp.seed.adminUser.id,
      publicSlug: slug,
      publicShareEnabled: false,
      phaseDurationOverride: { standalone: true },
    })
    .returning();
  const [match] = await testApp.db
    .insert(schema.communityLineupMatches)
    .values({
      lineupId: lineup.id,
      gameId: testApp.seed.game.id,
      status: 'scheduling',
      thresholdMet: true,
      voteCount: 0,
    })
    .returning();
  return match.id;
}

/** Assert a query helper includes an event, excludes it while a poll is open,
 *  then includes it again once the linkage clears. */
async function assertSuppressedWhilePolling(
  eventId: number,
  query: () => Promise<Array<{ id: number }>>,
) {
  const ids = async () => (await query()).map((e) => e.id);
  const matchId = await createPollMatch();

  expect(await ids()).toContain(eventId);

  await testApp.db
    .update(schema.events)
    .set({ reschedulingPollId: matchId })
    .where(eq(schema.events.id, eventId));
  expect(await ids()).not.toContain(eventId);

  await testApp.db
    .update(schema.events)
    .set({ reschedulingPollId: null })
    .where(eq(schema.events.id, eventId));
  expect(await ids()).toContain(eventId);
}

function describeQuerySuppression() {
  it('reminder candidates exclude an event while its poll is open', async () => {
    // Starts in ~2h — inside the reminder window (now-90s .. now+24h).
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const event = await createEvent('Reminder Window', {
      duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
    });
    await assertSuppressedWhilePolling(event.id, () =>
      fetchCandidateEvents(testApp.db, new Date()),
    );
  });

  it('start-scan candidates exclude an event while its poll is open', async () => {
    // Started 1h ago, ends in 1h, with a bound Scheduled Event.
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const event = await createEvent('Start Scan', {
      duration: [start, new Date(Date.now() + 60 * 60 * 1000)],
      discordScheduledEventId: 'se-start-1',
    });
    await assertSuppressedWhilePolling(event.id, () =>
      findStartCandidates(testApp.db),
    );
  });

  it('completion-scan candidates exclude an event while its poll is open', async () => {
    // Ended 1h ago, with a bound Scheduled Event.
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const event = await createEvent('Completion Scan', {
      duration: [start, new Date(Date.now() - 60 * 60 * 1000)],
      discordScheduledEventId: 'se-complete-1',
    });
    await assertSuppressedWhilePolling(event.id, () =>
      findCompletionCandidates(testApp.db),
    );
  });
}
describe(
  'ROK-1370 Part 1 — cron/query suppression while poll open',
  describeQuerySuppression,
);
