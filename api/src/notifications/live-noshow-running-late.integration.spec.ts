/**
 * Live no-show × running-late grace window integration tests (ROK-1424).
 *
 * Reported 2026-08-19 (Baldur's Gate 3): the operator clicked "Running late"
 * on the event reminder and was STILL named in the 👋 No-show Alert at
 * start+15. `live-noshow.service.ts` never read `event_signups.running_late_at`,
 * so the marker had no effect on detection at all.
 *
 * These tests drive `LiveNoShowService.checkNoShows()` — the exact entry point
 * the cron hits — against a real PostgreSQL database, and assert on the rows
 * the pipeline actually writes (`notifications`, `event_reminders_sent`).
 */
import { and, asc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { LiveNoShowService } from './live-noshow.service';
import { ActiveEventCacheService } from '../events/active-event-cache.service';
import { at, nonEmpty } from '../common/testing/narrow';

const MIN = 60 * 1000;

/** Create a member with a resolvable discord ID (needed for presence checks). */
async function createPlayer(testApp: TestApp, username: string) {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord-${username}`,
        username,
        displayName: username,
        role: 'member',
      })
      .returning(),
    'created player',
  );
  return user;
}

/** Create a scheduled event whose start is `minutesSinceStart` in the past. */
async function createLiveEvent(
  testApp: TestApp,
  creatorId: number,
  minutesSinceStart: number,
  maxAttendees: number,
) {
  const start = new Date(Date.now() - minutesSinceStart * MIN);
  const end = new Date(start.getTime() + 3 * 60 * MIN);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: "Baldur's Gate 3",
        creatorId,
        duration: [start, end] as [Date, Date],
        maxAttendees,
      })
      .returning(),
    'created live event',
  );
  return event;
}

/** Move an existing event's start further into the past (later cron tick). */
async function advanceEventStart(
  testApp: TestApp,
  eventId: number,
  minutesSinceStart: number,
) {
  const start = new Date(Date.now() - minutesSinceStart * MIN);
  const end = new Date(start.getTime() + 3 * 60 * MIN);
  await testApp.db
    .update(schema.events)
    .set({ duration: [start, end] as [Date, Date] })
    .where(eq(schema.events.id, eventId));
}

/** Sign a user up, optionally flagged running late (`lateMinutes` = ETA). */
async function signUp(
  testApp: TestApp,
  eventId: number,
  userId: number,
  late?: { lateMinutes?: number | null },
) {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'signed_up',
    runningLateAt: late ? new Date() : null,
    lateMinutes: late?.lateMinutes ?? null,
  });
}

/** Simulate Phase 1 having already nudged these users on an earlier tick. */
async function markPhase1Reminded(
  testApp: TestApp,
  eventId: number,
  userIds: number[],
) {
  await testApp.db.insert(schema.eventRemindersSent).values(
    userIds.map((userId) => ({
      eventId,
      userId,
      reminderType: 'noshow_reminder',
    })),
  );
}

/** Move a user's signup to the bench (a `roster_assignments` bench row). */
async function benchSignup(testApp: TestApp, eventId: number, userId: number) {
  const [signup] = nonEmpty(
    await testApp.db
      .select({ id: schema.eventSignups.id })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      ),
    'signup',
  );
  await testApp.db
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId: signup.id, role: 'bench' });
}

/** All escalation ("No-show Alert") notifications sent to the creator. */
async function escalations(testApp: TestApp, creatorId: number) {
  return (
    testApp.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, creatorId),
          eq(schema.notifications.type, 'missed_event_nudge'),
        ),
      )
      // Oldest first, so escalatedNames' "most recent" is the last row by time,
      // not whatever order the planner happens to return (TDB:384).
      .orderBy(asc(schema.notifications.createdAt))
  );
}

/**
 * Names listed in the most recent escalation payload, sorted — the payload's
 * order is not part of the contract, so assertions must not depend on it.
 */
function escalatedNames(rows: Array<{ payload: unknown }>): string[] {
  const payload = at(rows, -1).payload as {
    absentPlayers: Array<{ displayName: string }>;
  };
  return payload.absentPlayers.map((p) => p.displayName).sort();
}

/** User ids from an unordered select, sorted so assertions are order-free. */
function sortedUserIds(rows: Array<{ userId: number }>): number[] {
  return rows.map((r) => r.userId).sort((a, b) => a - b);
}

/** Phase 1 nudge rows recorded for an event. */
async function phase1Rows(testApp: TestApp, eventId: number) {
  return testApp.db
    .select()
    .from(schema.eventRemindersSent)
    .where(
      and(
        eq(schema.eventRemindersSent.eventId, eventId),
        eq(schema.eventRemindersSent.reminderType, 'noshow_reminder'),
      ),
    );
}

/** Escalation dedup rows recorded for an event. */
async function escalationDedupRows(testApp: TestApp, eventId: number) {
  return testApp.db
    .select()
    .from(schema.eventRemindersSent)
    .where(
      and(
        eq(schema.eventRemindersSent.eventId, eventId),
        eq(schema.eventRemindersSent.reminderType, 'noshow_escalation'),
      ),
    );
}

describe('Regression: ROK-1424 — running-late grace window (integration)', () => {
  let testApp: TestApp;
  let service: LiveNoShowService;
  let eventCache: ActiveEventCacheService;

  /** Refresh the active-event cache, then run one cron tick. */
  const runCronTick = async () => {
    await eventCache.refresh();
    await service.checkNoShows();
  };

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(LiveNoShowService, { strict: false });
    eventCache = testApp.app.get(ActiveEventCacheService, { strict: false });
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // =================================================================
  // AC2 — Phase 1 (start+5 nudge)
  // =================================================================

  describe('Phase 1 nudge', () => {
    it('skips the nudge for a running-late player but still nudges the others', async () => {
      const creator = testApp.seed.adminUser;
      const late = await createPlayer(testApp, 'LatePlayer');
      const absent = await createPlayer(testApp, 'AbsentPlayer');
      const event = await createLiveEvent(testApp, creator.id, 6, 2);
      await signUp(testApp, event.id, late.id, {});
      await signUp(testApp, event.id, absent.id);

      await runCronTick();

      const reminded = await phase1Rows(testApp, event.id);
      expect(sortedUserIds(reminded)).toEqual([absent.id]);
    });

    it('nudges the running-late player once the extended window expires', async () => {
      const creator = testApp.seed.adminUser;
      const late = await createPlayer(testApp, 'LatePlayer');
      // Default grace is 15 min, so Phase 1 defers from start+5 to start+20.
      const event = await createLiveEvent(testApp, creator.id, 21, 1);
      await signUp(testApp, event.id, late.id, {});

      await runCronTick();

      const reminded = await phase1Rows(testApp, event.id);
      expect(sortedUserIds(reminded)).toEqual([late.id]);
    });
  });

  // =================================================================
  // AC1/AC2 — Phase 2 (start+15 creator escalation)
  // =================================================================

  describe('Phase 2 escalation', () => {
    it('excludes the running-late player from the start+15 alert (the reported bug)', async () => {
      const creator = testApp.seed.adminUser;
      const late = await createPlayer(testApp, 'LatePlayer');
      const absent = await createPlayer(testApp, 'AbsentPlayer');
      const event = await createLiveEvent(testApp, creator.id, 16, 2);
      await signUp(testApp, event.id, late.id, {});
      await signUp(testApp, event.id, absent.id);
      await markPhase1Reminded(testApp, event.id, [late.id, absent.id]);

      await runCronTick();

      const alerts = await escalations(testApp, creator.id);
      expect(alerts).toHaveLength(1);
      expect(escalatedNames(alerts)).toEqual(['AbsentPlayer']);
    });

    it('honors a late_minutes ETA longer than the default grace', async () => {
      const creator = testApp.seed.adminUser;
      const late = await createPlayer(testApp, 'LatePlayer');
      const absent = await createPlayer(testApp, 'AbsentPlayer');
      // ETA of 30 min pushes Phase 2 from start+15 out to start+45.
      const event = await createLiveEvent(testApp, creator.id, 31, 2);
      await signUp(testApp, event.id, late.id, { lateMinutes: 30 });
      await signUp(testApp, event.id, absent.id);
      await markPhase1Reminded(testApp, event.id, [late.id, absent.id]);

      await runCronTick();

      const alerts = await escalations(testApp, creator.id);
      expect(alerts).toHaveLength(1);
      expect(escalatedNames(alerts)).toEqual(['AbsentPlayer']);
    });

    it('includes a player whose late_minutes ETA has already elapsed', async () => {
      const creator = testApp.seed.adminUser;
      const late = await createPlayer(testApp, 'LatePlayer');
      // ETA of 5 min → Phase 2 deadline is start+20, and we are at start+21.
      const event = await createLiveEvent(testApp, creator.id, 21, 1);
      await signUp(testApp, event.id, late.id, { lateMinutes: 5 });
      await markPhase1Reminded(testApp, event.id, [late.id]);

      await runCronTick();

      const alerts = await escalations(testApp, creator.id);
      expect(alerts).toHaveLength(1);
      expect(escalatedNames(alerts)).toEqual(['LatePlayer']);
    });
  });

  // =================================================================
  // AC3/AC4 — full suppression, then a late-fired escalation
  // =================================================================

  describe('all-late suppression and deferral', () => {
    it('sends no alert at all when every absent player is running late', async () => {
      const creator = testApp.seed.adminUser;
      const one = await createPlayer(testApp, 'LateOne');
      const two = await createPlayer(testApp, 'LateTwo');
      const event = await createLiveEvent(testApp, creator.id, 16, 2);
      await signUp(testApp, event.id, one.id, {});
      await signUp(testApp, event.id, two.id, {});
      await markPhase1Reminded(testApp, event.id, [one.id, two.id]);

      await runCronTick();

      expect(await escalations(testApp, creator.id)).toHaveLength(0);
      // The dedup row must NOT be burned, or the deferred alert can never fire.
      expect(await escalationDedupRows(testApp, event.id)).toHaveLength(0);
    });

    it('fires the deferred escalation on a later tick once the grace expires', async () => {
      const creator = testApp.seed.adminUser;
      const one = await createPlayer(testApp, 'LateOne');
      const two = await createPlayer(testApp, 'LateTwo');
      const event = await createLiveEvent(testApp, creator.id, 16, 2);
      await signUp(testApp, event.id, one.id, {});
      await signUp(testApp, event.id, two.id, {});
      await markPhase1Reminded(testApp, event.id, [one.id, two.id]);

      await runCronTick();
      expect(await escalations(testApp, creator.id)).toHaveLength(0);

      // Default grace defers Phase 2 to start+30; advance past it.
      await advanceEventStart(testApp, event.id, 31);
      await runCronTick();

      const alerts = await escalations(testApp, creator.id);
      expect(alerts).toHaveLength(1);
      expect(escalatedNames(alerts)).toEqual(['LateOne', 'LateTwo']);
      expect(await escalationDedupRows(testApp, event.id)).toHaveLength(1);
    });
  });

  // =================================================================
  // TDB:372 — nudged at +5, then benched / roached-out before +15
  // =================================================================

  describe('players who left the active roster after the Phase 1 nudge', () => {
    it('does not name a reminded player who was moved to the bench', async () => {
      const creator = testApp.seed.adminUser;
      const benched = await createPlayer(testApp, 'BenchedPlayer');
      const absent = await createPlayer(testApp, 'AbsentPlayer');
      const event = await createLiveEvent(testApp, creator.id, 16, 2);
      await signUp(testApp, event.id, benched.id, {});
      await signUp(testApp, event.id, absent.id);
      await markPhase1Reminded(testApp, event.id, [benched.id, absent.id]);
      await benchSignup(testApp, event.id, benched.id);

      await runCronTick();

      const alerts = await escalations(testApp, creator.id);
      expect(alerts).toHaveLength(1);
      expect(escalatedNames(alerts)).toEqual(['AbsentPlayer']);
    });

    it('does not name a reminded player who roached out', async () => {
      const creator = testApp.seed.adminUser;
      const roach = await createPlayer(testApp, 'RoachPlayer');
      const absent = await createPlayer(testApp, 'AbsentPlayer');
      // Backfills the roach's slot after the +5 nudge. A roached-out signup
      // does not count toward capacity, so without the backfill the roster is
      // no longer full and Phase 2 is suppressed before the filter under test
      // is ever reached. Not Phase-1-reminded, so never a Phase 2 candidate.
      const backfill = await createPlayer(testApp, 'BackfillPlayer');
      const event = await createLiveEvent(testApp, creator.id, 16, 2);
      await signUp(testApp, event.id, roach.id);
      await signUp(testApp, event.id, absent.id);
      await markPhase1Reminded(testApp, event.id, [roach.id, absent.id]);
      await signUp(testApp, event.id, backfill.id);
      await testApp.db
        .update(schema.eventSignups)
        .set({ status: 'roached_out', roachedOutAt: new Date() })
        .where(
          and(
            eq(schema.eventSignups.eventId, event.id),
            eq(schema.eventSignups.userId, roach.id),
          ),
        );

      await runCronTick();

      const alerts = await escalations(testApp, creator.id);
      expect(alerts).toHaveLength(1);
      expect(escalatedNames(alerts)).toEqual(['AbsentPlayer']);
    });
  });

  // =================================================================
  // Control — behavior without any running-late marker is unchanged
  // =================================================================

  it('still escalates normally when nobody is running late', async () => {
    const creator = testApp.seed.adminUser;
    const absent = await createPlayer(testApp, 'AbsentPlayer');
    const event = await createLiveEvent(testApp, creator.id, 16, 1);
    await signUp(testApp, event.id, absent.id);
    await markPhase1Reminded(testApp, event.id, [absent.id]);

    await runCronTick();

    const alerts = await escalations(testApp, creator.id);
    expect(alerts).toHaveLength(1);
    expect(escalatedNames(alerts)).toEqual(['AbsentPlayer']);
  });
});
