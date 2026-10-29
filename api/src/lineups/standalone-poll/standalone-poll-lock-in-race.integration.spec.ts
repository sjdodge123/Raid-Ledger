/**
 * ROK-2032 — claim-first lock-in from the create form.
 *
 * The form used to `POST /events` (which announces on Discord) and only then
 * `POST …/complete`, so two organizers locking in the same poll both created
 * and announced an event. `POST /scheduling-polls/:matchId/lock-in` claims the
 * match first: the loser gets a 409 and never creates or announces anything.
 *
 * Observables for "one announce":
 * - `APP_EVENT_EVENTS.CREATED` on `EventEmitter2.emit` (synchronous inside
 *   `eventsService.create`) — drives the Discord event embed;
 * - `LineupNotificationService.notifyEventCreated` — the EVENT CREATED post
 *   the lock-in fan-out fires after the signups (stubbed so nothing outlives
 *   the test).
 */
import { and, eq, isNotNull } from 'drizzle-orm';
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
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { APP_EVENT_EVENTS } from '../../discord-bot/discord-bot.constants';
import { LineupNotificationService } from '../lineup-notification.service';
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

const SLOT = new Date('2099-11-12T20:00:00.000Z');
const SLOT_END = new Date('2099-11-12T22:00:00.000Z');
/** Bound for the fire-and-forget DM → announce tail; not a sleep. */
const CHAIN_DEADLINE_MS = 10_000;

interface Poll {
  matchId: number;
  lineupId: number;
  voters: number[];
}

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
    tag,
  );
  return user.id;
}

/** A standalone poll opened by the admin. */
async function openStandalonePoll(): Promise<Omit<Poll, 'voters'>> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(res.status).toBe(201);
  return { matchId: res.body.id, lineupId: res.body.lineupId };
}

/** A REGULAR lineup match on `scheduling` (the ROK-2024 open lock-in). */
async function seedLineupMatch(): Promise<Omit<Poll, 'voters'>> {
  const [lineup] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Lock-in race lineup',
        createdBy: testApp.seed.adminUser.id,
        status: 'decided',
        visibility: 'public',
        publicSlug: generatePublicSlug(),
      })
      .returning(),
    'lineup',
  );
  const [match] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning(),
    'match',
  );
  await testApp.db.insert(schema.communityLineupMatchMembers).values({
    matchId: match.id,
    userId: testApp.seed.adminUser.id,
    source: 'voted',
  });
  return { matchId: match.id, lineupId: lineup.id };
}

/** The admin plus two members vote yes on SLOT. */
async function seedPoll(kind: 'standalone' | 'lineup'): Promise<Poll> {
  const poll =
    kind === 'standalone'
      ? await openStandalonePoll()
      : await seedLineupMatch();
  const voters = [
    testApp.seed.adminUser.id,
    await createMember(`race-a-${kind}`),
    await createMember(`race-b-${kind}`),
  ];
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId: poll.matchId,
        proposedTime: SLOT,
        suggestedBy: 'user',
      })
      .returning(),
    'slot',
  );
  await testApp.db.insert(schema.communityLineupScheduleVotes).values(
    voters.map((userId) => ({
      userId,
      slotId: slot.id,
      stance: 'yes' as const,
    })),
  );
  return { ...poll, voters };
}

/** The create form's lock-in body at SLOT on a 5-spot generic roster. */
function lockIn(matchId: number) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/lock-in`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      event: {
        title: 'Lock-in race',
        startTime: SLOT.toISOString(),
        endTime: SLOT_END.toISOString(),
        gameId: testApp.seed.game.id,
        slotConfig: { type: 'generic', player: 5 },
        maxAttendees: 5,
      },
      startTime: SLOT.toISOString(),
    });
}

/** Spies on both announce observables; EVENT CREATED is stubbed. */
function spyAnnounces() {
  const emit = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');
  const eventCreated = jest
    .spyOn(testApp.app.get(LineupNotificationService), 'notifyEventCreated')
    .mockResolvedValue(undefined);
  const createdEmits = () =>
    emit.mock.calls.filter(([key]) => key === APP_EVENT_EVENTS.CREATED).length;
  return { eventCreated, createdEmits };
}

async function eventIdsFromPoll(matchId: number): Promise<number[]> {
  const rows = await testApp.db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.createdFromPollId, matchId));
  return rows.map((r) => r.id);
}

async function matchRow(matchId: number) {
  const [row] = await testApp.db
    .select({
      status: schema.communityLineupMatches.status,
      linkedEventId: schema.communityLineupMatches.linkedEventId,
    })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId));
  return row;
}

async function lineupStatus(lineupId: number): Promise<string | undefined> {
  const [row] = await testApp.db
    .select({ status: schema.communityLineups.status })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId));
  return row?.status;
}

async function signedUpUserIds(eventId: number): Promise<number[]> {
  const rows = await testApp.db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        isNotNull(schema.eventSignups.userId),
      ),
    );
  return rows.flatMap((r) => (r.userId === null ? [] : [r.userId])).sort();
}

/** Two concurrent lock-ins; returns the winner's event id. */
async function raceLockIns(poll: Poll): Promise<number> {
  const results = await Promise.all([
    lockIn(poll.matchId),
    lockIn(poll.matchId),
  ]);
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
  expect(winner.body).toEqual({
    event: expect.objectContaining({ id: expect.any(Number) }),
    benchPickFallback: false,
  });
  return winner.body.event.id;
}

/** EVENT CREATED landed exactly once, for the winner's event. */
async function expectOneAnnounce(
  spies: ReturnType<typeof spyAnnounces>,
  eventId: number,
): Promise<void> {
  expect(spies.createdEmits()).toBe(1);
  await waitFor(() => {
    expect(spies.eventCreated).toHaveBeenCalled();
    return Promise.resolve();
  }, CHAIN_DEADLINE_MS);
  expect(spies.eventCreated).toHaveBeenCalledTimes(1);
  expect(spies.eventCreated.mock.calls[0]?.[2]).toBe(eventId);
}

describe('POST /scheduling-polls/:matchId/lock-in — concurrent lock-ins (ROK-2032)', () => {
  it('standalone poll: one 200 + one 409, ONE event, ONE announce, roster ready', async () => {
    const poll = await seedPoll('standalone');
    const spies = spyAnnounces();

    const eventId = await raceLockIns(poll);

    expect(await eventIdsFromPoll(poll.matchId)).toEqual([eventId]);
    expect(await matchRow(poll.matchId)).toEqual({
      status: 'scheduled',
      linkedEventId: eventId,
    });
    expect(await lineupStatus(poll.lineupId)).toBe('archived');
    // ROK-2031: the slot voters are signed up when the 200 arrives (no wait).
    expect(await signedUpUserIds(eventId)).toEqual([...poll.voters].sort());
    await expectOneAnnounce(spies, eventId);
  });

  it('open lineup poll (ROK-2024): links the winner, lineup NOT archived, one announce', async () => {
    const poll = await seedPoll('lineup');
    const spies = spyAnnounces();

    const eventId = await raceLockIns(poll);

    expect(await eventIdsFromPoll(poll.matchId)).toEqual([eventId]);
    expect(await matchRow(poll.matchId)).toEqual({
      status: 'scheduled',
      linkedEventId: eventId,
    });
    expect(await lineupStatus(poll.lineupId)).toBe('decided');
    expect(await signedUpUserIds(eventId)).toEqual([...poll.voters].sort());
    await expectOneAnnounce(spies, eventId);
  });
});

describe('POST /scheduling-polls/:matchId/lock-in — a late second lock-in (ROK-2032)', () => {
  it('409s with the locked-in copy (not a 400) and creates no second event', async () => {
    const poll = await seedPoll('standalone');
    const spies = spyAnnounces();
    const first = await lockIn(poll.matchId);
    expect(first.status).toBe(200);
    const eventId: number = first.body.event.id;

    const late = await lockIn(poll.matchId);

    expect({ status: late.status, message: late.body.message }).toEqual({
      status: 409,
      message: SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE,
    });
    expect(await eventIdsFromPoll(poll.matchId)).toEqual([eventId]);
    await expectOneAnnounce(spies, eventId);
  });
});

describe('POST /scheduling-polls/:matchId/lock-in — create failure (ROK-2032)', () => {
  it('releases the claim so a retry locks the poll in', async () => {
    const poll = await seedPoll('standalone');
    const spies = spyAnnounces();
    jest
      .spyOn(testApp.app.get(EventsService), 'create')
      .mockRejectedValueOnce(new Error('create exploded'));

    const failed = await lockIn(poll.matchId);

    expect(failed.status).toBe(500);
    expect(await matchRow(poll.matchId)).toEqual({
      status: 'scheduling',
      linkedEventId: null,
    });
    expect(await eventIdsFromPoll(poll.matchId)).toEqual([]);
    expect(spies.createdEmits()).toBe(0);

    const retry = await lockIn(poll.matchId);

    expect(retry.status).toBe(200);
    const eventId: number = retry.body.event.id;
    expect(await eventIdsFromPoll(poll.matchId)).toEqual([eventId]);
    expect(await matchRow(poll.matchId)).toEqual({
      status: 'scheduled',
      linkedEventId: eventId,
    });
    await expectOneAnnounce(spies, eventId);
  });
});
