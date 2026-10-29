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
function rescheduleLockIn(matchId: number, slot: Date) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/reschedule-lock-in`)
    .set('Authorization', `Bearer ${adminToken}`)
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
