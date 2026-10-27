/**
 * SPIKE (throwaway, never pushed) — which scheduling-poll lock-in paths fire
 * the lineup EVENT CREATED announcement (`notifyEventCreated`)?
 *
 *   (a) expired lock-in: POST /lineups/:id/schedule/:matchId/create-event
 *   (b) open lock-in, lineup-derived match: POST /events {schedulingMatchId}
 *       then POST /scheduling-polls/:matchId/complete {eventId,startTime}
 *   (c) open lock-in, standalone poll (POST /scheduling-polls): same as (b)
 *
 * (b)/(c) are exactly the two calls `create-event-form.tsx` makes.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { LineupNotificationService } from '../lineup-notification.service';

const SLOT = new Date('2099-10-10T21:00:00.000Z');
const SLOT_END = new Date('2099-10-10T23:00:00.000Z');

describe('SPIKE: EVENT CREATED per lock-in path', () => {
  let testApp: TestApp;
  let adminToken: string;
  let spy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(() => {
    spy = jest.spyOn(
      testApp.app.get(LineupNotificationService),
      'notifyEventCreated',
    );
  });

  afterEach(async () => {
    spy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  /** Lineup-derived match on `scheduling`, admin = organiser + voter. */
  async function seedLineupPoll(
    lineupStatus: 'archived' | 'decided',
  ): Promise<{ lineupId: number; matchId: number; slotId: number }> {
    const [lineup] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: 'Spike',
          createdBy: testApp.seed.adminUser.id,
          status: lineupStatus,
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
      source: 'voted' as const,
    });
    const slotId = await addSlotAndVote(match.id);
    return { lineupId: lineup.id, matchId: match.id, slotId };
  }

  async function addSlotAndVote(matchId: number): Promise<number> {
    const [slot] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupScheduleSlots)
        .values({ matchId, proposedTime: SLOT, suggestedBy: 'user' })
        .returning(),
      'slot',
    );
    await testApp.db.insert(schema.communityLineupScheduleVotes).values({
      slotId: slot.id,
      userId: testApp.seed.adminUser.id,
      stance: 'yes',
    });
    return slot.id;
  }

  /** The web's open-poll lock-in: POST /events then POST complete. */
  async function openLockIn(matchId: number): Promise<number> {
    const created = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Spike Night',
        startTime: SLOT.toISOString(),
        endTime: SLOT_END.toISOString(),
        gameId: testApp.seed.game.id,
        schedulingMatchId: matchId,
      });
    console.log(`PROBE POST /events status=${created.status}`);
    expect(created.status).toBe(201);
    const eventId = created.body.id as number;
    const done = await testApp.request
      .post(`/scheduling-polls/${matchId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventId, startTime: SLOT.toISOString() });
    console.log(`PROBE POST complete status=${done.status}`);
    expect(done.status).toBe(200);
    return eventId;
  }

  /** Proves the fire-and-forget complete() chain ran before we judge. */
  async function waitForSignup(eventId: number): Promise<void> {
    await waitFor(async () => {
      const rows = await testApp.db
        .select({ id: schema.eventSignups.id })
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.eventId, eventId));
      expect(rows.length).toBeGreaterThan(0);
    }, 5000);
  }

  /** Give a late announcement the same window path (a) needs, then report. */
  async function settleAndCount(label: string): Promise<number> {
    try {
      await waitFor(async () => expect(spy).toHaveBeenCalled(), 3000);
    } catch {
      /* not called within the window — reported below */
    }
    console.log(`PROBE path=${label} notifyEventCreated calls=${spy.mock.calls.length}`);
    return spy.mock.calls.length;
  }

  it('(a) expired lock-in via /create-event DOES announce', async () => {
    const poll = await seedLineupPoll('archived');
    const res = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/create-event`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slotId: poll.slotId });
    expect(res.status).toBe(201);
    await waitFor(async () => expect(spy).toHaveBeenCalledTimes(1), 5000);
    expect(await settleAndCount('a-expired-create-event')).toBe(1);
    const [matchArg, , eventIdArg] = spy.mock.calls[0] as [
      { id: number },
      Date,
      number,
    ];
    expect(matchArg.id).toBe(poll.matchId);
    expect(eventIdArg).toBe(res.body.eventId);
  });

  it('(b) open lineup-poll lock-in via POST /events + complete: records calls', async () => {
    const poll = await seedLineupPoll('decided');
    const eventId = await openLockIn(poll.matchId);
    await waitForSignup(eventId);
    expect(await settleAndCount('b-open-lineup-events+complete')).toBe(0);
  });

  it('(c) open standalone-poll lock-in via POST /events + complete: records calls', async () => {
    const opened = await testApp.request
      .post('/scheduling-polls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: testApp.seed.game.id });
    expect(opened.status).toBe(201);
    const matchId = opened.body.id as number;
    await addSlotAndVote(matchId);
    const eventId = await openLockIn(matchId);
    await waitForSignup(eventId);
    expect(await settleAndCount('c-open-standalone-events+complete')).toBe(0);
  });
});
