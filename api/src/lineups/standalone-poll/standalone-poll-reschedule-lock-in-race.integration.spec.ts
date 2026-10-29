/**
 * ROK-2040 — claim-first reschedule lock-in.
 *
 * A reschedule poll used to lock in as `PATCH /events/:id/reschedule` and then
 * `POST …/complete`, so two organizers locking in the same poll at once both
 * moved the event and both emitted UPDATED. `POST /scheduling-polls/:matchId/
 * reschedule-lock-in` claims the poll first (the ROK-2032 claim): the loser
 * gets the same 409 as a `/lock-in` loser and moves nothing.
 *
 * Observables:
 * - `EventsService.reschedule` — the one write that moves the event;
 * - `APP_EVENT_EVENTS.UPDATED` on `EventEmitter2.emit`. One lock-in emits
 *   two: the move (the embed stays RESCHEDULING while the poll is open) and
 *   the re-emit once the poll releases the event (ROK-1370). A second mover
 *   would add at least two more.
 */
import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { APP_EVENT_EVENTS } from '../../discord-bot/discord-bot.constants';
import { EventsService } from '../../events/events.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import * as queryHelpers from './standalone-poll-query.helpers';
import { NotificationService } from '../../notifications/notification.service';
import * as lifecycleHelpers from '../../events/event-lifecycle.helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SLOT_A = new Date('2099-11-12T20:00:00.000Z');
const SLOT_B = new Date('2099-11-13T20:00:00.000Z');
/** Bound for the fire-and-forget UPDATED re-emit; not a sleep. */
const CHAIN_DEADLINE_MS = 10_000;

interface ReschedulePoll {
  matchId: number;
  lineupId: number;
  eventId: number;
}

/** An admin-owned event with a reschedule poll open on two slots. */
async function seedReschedulePoll(): Promise<ReschedulePoll> {
  const start = new Date(Date.now() + 86_400_000);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Reschedule race',
        gameId: testApp.seed.game.id,
        duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
        maxAttendees: 10,
        creatorId: testApp.seed.adminUser.id,
      })
      .returning(),
    'event',
  );
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id, linkedEventId: event.id });
  expect(res.status).toBe(201);
  await testApp.db.insert(schema.communityLineupScheduleSlots).values(
    [SLOT_A, SLOT_B].map((proposedTime) => ({
      matchId: res.body.id as number,
      proposedTime,
      suggestedBy: 'user' as const,
    })),
  );
  return {
    matchId: res.body.id,
    lineupId: res.body.lineupId,
    eventId: event.id,
  };
}

/** The web's reschedule lock-in at `slot` (a two-hour event). */
function rescheduleLockIn(matchId: number, slot: Date, token = adminToken) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/reschedule-lock-in`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      startTime: slot.toISOString(),
      endTime: new Date(slot.getTime() + TWO_HOURS_MS).toISOString(),
    });
}

async function eventRow(eventId: number) {
  const [row] = await testApp.db
    .select({
      duration: schema.events.duration,
      reschedulingPollId: schema.events.reschedulingPollId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return row;
}

async function matchStatus(matchId: number): Promise<string | undefined> {
  const [row] = await testApp.db
    .select({ status: schema.communityLineupMatches.status })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId));
  return row?.status;
}

describe('POST /scheduling-polls/:matchId/reschedule-lock-in (ROK-2040)', () => {
  it('two concurrent lock-ins move the event once and emit one lock-in of UPDATED', async () => {
    const poll = await seedReschedulePoll();
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');
    const emit = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');
    const updatedEmits = (): number =>
      emit.mock.calls.filter(([key]) => key === APP_EVENT_EVENTS.UPDATED)
        .length;

    const results = await Promise.all([
      rescheduleLockIn(poll.matchId, SLOT_A),
      rescheduleLockIn(poll.matchId, SLOT_B),
    ]);

    expect(moves).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = nonEmpty(
      results.filter((r) => r.status === 200),
      'winner',
    )[0];
    const loser = nonEmpty(
      results.filter((r) => r.status === 409),
      'loser',
    )[0];
    expect(loser.body.message).toBe(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE);
    const event = await eventRow(poll.eventId);
    expect(event?.duration[0].toISOString()).toBe(winner.body.startTime);
    expect(event?.reschedulingPollId).toBeNull();
    expect(await matchStatus(poll.matchId)).toBe('scheduled');
    await waitFor(() => {
      expect(updatedEmits()).toBeGreaterThanOrEqual(2);
      return Promise.resolve();
    }, CHAIN_DEADLINE_MS);
    expect(updatedEmits()).toBe(2);
  });

  it('a lock-in after the poll is locked in 409s and leaves the event where it is', async () => {
    const poll = await seedReschedulePoll();
    expect((await rescheduleLockIn(poll.matchId, SLOT_A)).status).toBe(200);
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');

    const late = await rescheduleLockIn(poll.matchId, SLOT_B);

    expect(late.status).toBe(409);
    expect(late.body.message).toBe(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE);
    expect(moves).not.toHaveBeenCalled();
    const event = await eventRow(poll.eventId);
    expect(event?.duration[0].toISOString()).toBe(SLOT_A.toISOString());
  });
});

describe('reschedule lock-in failure paths (ROK-2040)', () => {
  it('a throw after the move commits keeps the claim, so a retry 409s instead of moving the event again', async () => {
    const poll = await seedReschedulePoll();
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');
    // `activityLog.log` runs after `rescheduleEvent` has committed the move.
    jest
      .spyOn(testApp.app.get(ActivityLogService), 'log')
      .mockRejectedValueOnce(new Error('activity log unavailable'));

    const first = await rescheduleLockIn(poll.matchId, SLOT_A);
    const retry = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(moves).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(first.body.startTime).toBe(SLOT_A.toISOString());
    expect(retry.status).toBe(409);
    expect(retry.body.message).toBe(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE);
    expect(await matchStatus(poll.matchId)).toBe('scheduled');
    expect((await eventRow(poll.eventId))?.reschedulingPollId).toBeNull();
  });

  it('a failed archive/release after the move still completes the lock-in', async () => {
    const poll = await seedReschedulePoll();
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');
    jest
      .spyOn(queryHelpers, 'clearReschedulingPollId')
      .mockRejectedValueOnce(new Error('connection reset'));

    const res = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(res.status).toBe(200);
    expect(res.body.startTime).toBe(SLOT_A.toISOString());
    expect(moves).toHaveBeenCalledTimes(1);
    expect(await matchStatus(poll.matchId)).toBe('scheduled');
    expect((await rescheduleLockIn(poll.matchId, SLOT_B)).status).toBe(409);
  });

  it('a poll creator who does not own the event gets 403 before the claim; the poll stays claimable', async () => {
    const poll = await seedReschedulePoll();
    const member = await createMemberAndLogin(
      testApp,
      'resched-poll-owner',
      'resched-poll-owner@test.local',
    );
    // The member owns the POLL (passes the poll check) but not the EVENT.
    await testApp.db
      .update(schema.communityLineups)
      .set({ createdBy: member.userId })
      .where(eq(schema.communityLineups.id, poll.lineupId));
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');

    const denied = await rescheduleLockIn(poll.matchId, SLOT_A, member.token);

    expect(denied.status).toBe(403);
    expect(moves).not.toHaveBeenCalled();
    expect(await matchStatus(poll.matchId)).toBe('scheduling');
    expect((await rescheduleLockIn(poll.matchId, SLOT_A)).status).toBe(200);
  });

  it('a linked event whose game changed gets 400 before the claim; the poll stays claimable', async () => {
    const poll = await seedReschedulePoll();
    await testApp.db
      .update(schema.events)
      .set({ gameId: null })
      .where(eq(schema.events.id, poll.eventId));
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');

    const denied = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(denied.status).toBe(400);
    expect(denied.body.message).toBe(
      "The event's game no longer matches the poll",
    );
    expect(moves).not.toHaveBeenCalled();
    expect(await matchStatus(poll.matchId)).toBe('scheduling');
    await testApp.db
      .update(schema.events)
      .set({ gameId: testApp.seed.game.id })
      .where(eq(schema.events.id, poll.eventId));
    expect((await rescheduleLockIn(poll.matchId, SLOT_A)).status).toBe(200);
  });

  it('a notification failure after the move is retried once: confirmations reset, one reschedule notification', async () => {
    const poll = await seedReschedulePoll();
    const member = await createMemberAndLogin(
      testApp,
      'resched-signed-up',
      'resched-signed-up@test.local',
    );
    await testApp.db.insert(schema.eventSignups).values({
      eventId: poll.eventId,
      userId: member.userId,
      status: 'signed_up',
      confirmationStatus: 'confirmed',
    });
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');
    // `notifyReschedule` → `createMany` runs after the duration UPDATE.
    jest
      .spyOn(testApp.app.get(NotificationService), 'createMany')
      .mockRejectedValueOnce(new Error('notification insert failed'));

    const res = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(res.status).toBe(200);
    expect(moves).toHaveBeenCalledTimes(1);
    const [signup] = await testApp.db
      .select({ confirmationStatus: schema.eventSignups.confirmationStatus })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, poll.eventId));
    // Not recovery's: the original reset ran before `createMany` threw. The
    // recovery's own reset is pinned by the reset-failure case below.
    expect(signup?.confirmationStatus).toBe('pending');
    const sent = await testApp.db
      .select({ payload: schema.notifications.payload })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, member.userId));
    const rescheduled = sent.filter(
      (n) =>
        (n.payload as { newStartTime?: string } | null)?.newStartTime ===
        SLOT_A.toISOString(),
    );
    expect(rescheduled).toHaveLength(1);
  });
});

/** A confirmed signup by a fresh member, so the reschedule has someone to tell. */
async function seedConfirmedMember(eventId: number, tag: string) {
  const member = await createMemberAndLogin(
    testApp,
    `resched-${tag}`,
    `resched-${tag}@test.local`,
  );
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId: member.userId,
    status: 'signed_up',
    confirmationStatus: 'confirmed',
  });
  return member;
}

/** `event_rescheduled` rows for `userId` whose new start is `slot`. */
async function rescheduledTo(userId: number, slot: Date) {
  const rows = await testApp.db
    .select({
      type: schema.notifications.type,
      payload: schema.notifications.payload,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  return rows.filter(
    (n) =>
      n.type === 'event_rescheduled' &&
      (n.payload as { newStartTime?: string } | null)?.newStartTime ===
        slot.toISOString(),
  );
}

async function confirmationOf(eventId: number) {
  const [signup] = await testApp.db
    .select({ confirmationStatus: schema.eventSignups.confirmationStatus })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return signup?.confirmationStatus;
}

describe('reschedule lock-in recovery (ROK-2040 delta)', () => {
  it('a throw reading the event after the claim releases the claim, so a retry can lock in', async () => {
    const poll = await seedReschedulePoll();
    const moves = jest.spyOn(testApp.app.get(EventsService), 'reschedule');
    jest
      .spyOn(lifecycleHelpers, 'findExistingOrThrow')
      .mockRejectedValueOnce(new Error('connection reset'));

    const failed = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(failed.status).toBe(500);
    expect(moves).not.toHaveBeenCalled();
    expect(await matchStatus(poll.matchId)).toBe('scheduling');
    const retry = await rescheduleLockIn(poll.matchId, SLOT_A);
    expect(retry.status).toBe(200);
    expect(retry.body.startTime).toBe(SLOT_A.toISOString());
  });

  it('a failure after the notifications were written does not send them twice', async () => {
    const poll = await seedReschedulePoll();
    const member = await seedConfirmedMember(poll.eventId, 'dedup');
    // `activityLog.log` runs after `notifyReschedule`'s `createMany` committed.
    jest
      .spyOn(testApp.app.get(ActivityLogService), 'log')
      .mockRejectedValueOnce(new Error('activity log unavailable'));

    const res = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(res.status).toBe(200);
    expect(await rescheduledTo(member.userId, SLOT_A)).toHaveLength(1);
  });

  it('an earlier move to the same slot does not stop the recovery from notifying this one', async () => {
    const poll = await seedReschedulePoll();
    const member = await seedConfirmedMember(poll.eventId, 'moved-back');
    // A past move to SLOT_A from somewhere else (the event moved away since).
    await testApp.db.insert(schema.notifications).values({
      userId: member.userId,
      type: 'event_rescheduled',
      title: 'Event Rescheduled',
      message: 'earlier move',
      payload: {
        eventId: poll.eventId,
        oldStartTime: SLOT_B.toISOString(),
        newStartTime: SLOT_A.toISOString(),
      },
    });
    jest
      .spyOn(testApp.app.get(NotificationService), 'createMany')
      .mockRejectedValueOnce(new Error('notification insert failed'));

    const res = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(res.status).toBe(200);
    expect(await rescheduledTo(member.userId, SLOT_A)).toHaveLength(2);
  });

  it('a failed confirmation reset after the move is redone by the recovery', async () => {
    const poll = await seedReschedulePoll();
    const member = await seedConfirmedMember(poll.eventId, 'reset');
    // `resetSignupConfirmations` opens with a DELETE, after the move's UPDATE.
    jest.spyOn(testApp.db, 'delete').mockImplementationOnce(() => {
      throw new Error('reminder reset failed');
    });

    const res = await rescheduleLockIn(poll.matchId, SLOT_A);

    expect(res.status).toBe(200);
    expect(res.body.startTime).toBe(SLOT_A.toISOString());
    expect(await confirmationOf(poll.eventId)).toBe('pending');
    expect(await rescheduledTo(member.userId, SLOT_A)).toHaveLength(1);
  });
});
