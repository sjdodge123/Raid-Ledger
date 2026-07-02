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
  findReconciliationCandidates,
} from '../../discord-bot/services/scheduled-event.db-helpers';
import { findCreateCandidates } from '../../discord-bot/services/ephemeral-voice.db-helpers';
import { findLiveEventsInNoShowWindow } from '../../notifications/live-noshow.helpers';
import { RoleGapAlertService } from '../../notifications/role-gap-alert.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../../discord-bot/discord-bot.constants';

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
  return postPollAs(adminToken, linkedEventId);
}

/** POST /scheduling-polls as an arbitrary caller. */
function postPollAs(token: string, linkedEventId: number) {
  return testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId: testApp.seed.game.id, linkedEventId });
}

/** POST /scheduling-polls/:matchId/complete as an arbitrary caller. */
function completePollAs(token: string, matchId: number) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set('Authorization', `Bearer ${token}`);
}

/** Create a non-admin member and return their bearer token + id. */
async function loginAsMember(
  tag: string,
): Promise<{ token: string; userId: number }> {
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('MemberPass1!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${tag}@test.local`,
      username: tag,
      role: 'member',
    })
    .returning();
  await testApp.db.insert(schema.localCredentials).values({
    email: `${tag}@test.local`,
    passwordHash: hash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: `${tag}@test.local`, password: 'MemberPass1!' });
  return { token: res.body.access_token as string, userId: user.id };
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

// =====================================================================
// ROK-1370 P1/P2 — authorization on the destructive poll endpoints.
// Opening a poll linked to an event tears down its Scheduled Event +
// suppresses its scans; completing one re-emits UPDATED. Both must be
// restricted to the event/poll owner or an admin (Codex security review).
// =====================================================================

function describeCreateAuth() {
  it('403s a non-owner and leaves the event un-stamped (no side effects)', async () => {
    const owner = await loginAsMember('p1-owner');
    const stranger = await loginAsMember('p1-stranger');
    const event = await createEvent('P1 Owned', { creatorId: owner.userId });

    const res = await postPollAs(stranger.token, event.id);
    expect(res.status).toBe(403);

    const after = await readEvent(event.id);
    expect((after as Record<string, unknown>).reschedulingPollId).toBeNull();
    // The destructive path never ran: no lineup/match rows were created.
    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches);
    expect(matches).toHaveLength(0);
  });

  it('lets the event owner open a reschedule poll', async () => {
    const owner = await loginAsMember('p1-owner-ok');
    const event = await createEvent('P1 Owner OK', { creatorId: owner.userId });

    const res = await postPollAs(owner.token, event.id);
    expect(res.status).toBe(201);
    const after = await readEvent(event.id);
    expect((after as Record<string, unknown>).reschedulingPollId).toBe(
      res.body.id,
    );
  });

  it('lets an admin open a reschedule poll for any event', async () => {
    const owner = await loginAsMember('p1-owner-admin');
    const event = await createEvent('P1 Admin OK', { creatorId: owner.userId });

    const res = await postPollAs(adminToken, event.id);
    expect(res.status).toBe(201);
  });
}
describe('ROK-1370 P1 — create-poll authorization', describeCreateAuth);

function describeCompleteAuth() {
  it('403s a non-owner completing a linked poll and keeps the linkage', async () => {
    const owner = await loginAsMember('p2-owner');
    const stranger = await loginAsMember('p2-stranger');
    const event = await createEvent('P2 Owned', { creatorId: owner.userId });
    const poll = await postPollAs(owner.token, event.id);
    expect(poll.status).toBe(201);
    const matchId = poll.body.id as number;

    const res = await completePollAs(stranger.token, matchId);
    expect(res.status).toBe(403);

    // Flag NOT cleared — the UPDATED re-emit never fired.
    const after = await readEvent(event.id);
    expect((after as Record<string, unknown>).reschedulingPollId).toBe(matchId);
  });

  it('lets the poll/event owner complete their linked poll', async () => {
    const owner = await loginAsMember('p2-owner-ok');
    const event = await createEvent('P2 Owner OK', { creatorId: owner.userId });
    const poll = await postPollAs(owner.token, event.id);
    const matchId = poll.body.id as number;

    const res = await completePollAs(owner.token, matchId);
    expect(res.status).toBe(200);
    const after = await readEvent(event.id);
    expect((after as Record<string, unknown>).reschedulingPollId).toBeNull();
  });

  it('lets an admin complete any linked poll', async () => {
    const owner = await loginAsMember('p2-owner-admin');
    const event = await createEvent('P2 Admin OK', { creatorId: owner.userId });
    const poll = await postPollAs(owner.token, event.id);
    const matchId = poll.body.id as number;

    const res = await completePollAs(adminToken, matchId);
    expect(res.status).toBe(200);
  });
}
describe('ROK-1370 P2 — complete-poll authorization', describeCompleteAuth);

// =====================================================================
// ROK-1370 review round — the adversarial review found four MORE query
// paths that fired at the OLD time during an open poll (SE reconciliation,
// ephemeral-voice create scan, live no-show window, role-gap alerts) plus
// two lifecycle-emit gaps. Regression coverage for each.
// =====================================================================

/** Poll (≤2s) until `check` passes — the lifecycle emits are fire-and-forget
 *  (`.catch(noop)`, not awaited by the HTTP handler), so assertions must wait
 *  for the microtask chain to settle instead of asserting synchronously. */
async function waitForCondition(check: () => boolean): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

function describeReviewSuppression() {
  it('SE-reconciliation candidates exclude an event while its poll is open', async () => {
    // Future start, no bound SE (the RESCHEDULING teardown just cleared it).
    const event = await createEvent('Reconcile Scan');
    await assertSuppressedWhilePolling(event.id, () =>
      findReconciliationCandidates(testApp.db),
    );
  });

  it('ephemeral-voice create candidates exclude an event while its poll is open', async () => {
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const event = await createEvent('Ephemeral Create', {
      duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
    });
    await assertSuppressedWhilePolling(event.id, () =>
      findCreateCandidates(testApp.db, new Date(), 10 * 60 * 1000),
    );
  });

  it('live no-show window excludes an event while its poll is open', async () => {
    // Started 10 minutes ago, still running — inside the phase-1 window.
    const start = new Date(Date.now() - 10 * 60 * 1000);
    const event = await createEvent('NoShow Window', {
      duration: [start, new Date(Date.now() + 60 * 60 * 1000)],
    });
    await assertSuppressedWhilePolling(event.id, () =>
      findLiveEventsInNoShowWindow(testApp.db, new Date()),
    );
  });

  it('role-gap candidates exclude an event while its poll is open', async () => {
    // ROLE_GAP_WINDOW centers 4h out (±15m); probe the service's query.
    const start = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const event = await createEvent('Role Gap', {
      duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
      slotConfig: { type: 'mmo', tank: 2, healer: 4 },
    });
    const svc = testApp.app.get(RoleGapAlertService);
    const query = (): Promise<Array<{ id: number }>> =>
      (
        svc as unknown as {
          fetchCandidateEvents(now: Date): Promise<Array<{ id: number }>>;
        }
      ).fetchCandidateEvents(new Date());
    await assertSuppressedWhilePolling(event.id, query);
  });
}
describe(
  'ROK-1370 review — remaining old-time paths suppressed while poll open',
  describeReviewSuppression,
);

function describeLifecycleEmits() {
  it('poll open emits RESCHEDULING; lock-in completion re-emits UPDATED', async () => {
    const event = await createEvent('Emit Trace');
    const emitter = testApp.app.get(EventEmitter2);
    const emitSpy = jest.spyOn(emitter, 'emit');
    try {
      const pollRes = await postSchedulingPoll(event.id);
      expect(pollRes.status).toBe(201);
      expect(
        await waitForCondition(() =>
          emitSpy.mock.calls.some(
            ([key]) => key === APP_EVENT_EVENTS.RESCHEDULING,
          ),
        ),
      ).toBe(true);

      const matchId = pollRes.body.id as number;
      await lockInAtNewTime(
        event.id,
        matchId,
        new Date(Date.now() + 3 * 86_400_000),
      );
      // complete() must re-emit UPDATED after clearing the flag so the embed
      // resets RESCHEDULING → POSTED and the SE is recreated.
      expect(
        await waitForCondition(() =>
          emitSpy.mock.calls.some(([key]) => key === APP_EVENT_EVENTS.UPDATED),
        ),
      ).toBe(true);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('completing a poll whose event was cancelled mid-poll does NOT re-emit UPDATED', async () => {
    const event = await createEvent('Cancelled Mid-Poll');
    const pollRes = await postSchedulingPoll(event.id);
    expect(pollRes.status).toBe(201);
    const matchId = pollRes.body.id as number;

    await testApp.db
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, event.id));

    const emitter = testApp.app.get(EventEmitter2);
    const emitSpy = jest.spyOn(emitter, 'emit');
    try {
      const cr = await completePollAs(adminToken, matchId);
      expect(cr.status).toBe(200);
      // Bounded settle for the (absent) fire-and-forget emit, then assert the
      // UPDATED re-emit was skipped — it would recreate an SE for a dead event.
      const emitted = await waitForCondition(() =>
        emitSpy.mock.calls.some(([key]) => key === APP_EVENT_EVENTS.UPDATED),
      );
      expect(emitted).toBe(false);
    } finally {
      emitSpy.mockRestore();
    }
    const after = await readEvent(event.id);
    expect((after as Record<string, unknown>).reschedulingPollId).toBeNull();
  });
}
describe('ROK-1370 review — lifecycle emits', describeLifecycleEmits);
