/**
 * ROK-1857 L3: a member's Google copy across a rescheduling poll, on the real
 * path — HTTP opens / closes / aborts the poll, the real emits reach
 * `CalendarWriteListener`, the RUNNING BullMQ worker reconciles against the
 * `FakeCalendarProvider`, and the link rows are read back from Postgres.
 *
 * Deterministic waits only: `settle()` waits for the listener fan-out the
 * step triggers (spied on the app's listener instance — the emitter wrapper
 * resolves `instance[method]` per call), awaits it, then drains the write
 * queue by promoting the 5 s debounce delay instead of sleeping through it.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { LINEUP_PHASE_QUEUE } from '../../lineups/queue/lineup-phase.constants';
import { SettingsService } from '../../settings/settings.service';
import { setCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { CALENDAR_WRITE_QUEUE } from '../calendar-sync.constants';
import { CALENDAR_FAKE_PROVIDER } from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import type { CalendarWriteJobData } from './calendar-write.enqueue.helpers';
import { CalendarWriteListener } from './calendar-write.listener';
import { CalendarWriteProcessor } from './calendar-write.processor';
import type { ReconcileOutcome } from './calendar-write-reconcile.helpers';

jest.setTimeout(60_000);

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const DAY_MS = 86_400_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

interface Outcome {
  data: CalendarWriteJobData;
  result: ReconcileOutcome;
}

let testApp: TestApp;
let adminToken: string;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let queue: Queue;
let phaseQueue: Queue;
let processor: CalendarWriteProcessor;
let listener: CalendarWriteListener;
let outcomes: Outcome[] = [];
let spies: jest.SpyInstance[] = [];
let seq = 0;

function recordOutcome(job: Job<CalendarWriteJobData>, result: unknown) {
  outcomes.push({ data: job.data, result: result as ReconcileOutcome });
}

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  phaseQueue = testApp.app.get<Queue>(getQueueToken(LINEUP_PHASE_QUEUE));
  processor = testApp.app.get(CalendarWriteProcessor);
  listener = testApp.app.get(CalendarWriteListener);
  // The worker RUNS in this file (the listener spec pauses it).
  await processor.worker.resume();
  processor.worker.on('completed', recordOutcome);
});

afterAll(() => {
  processor.worker.off('completed', recordOutcome);
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  await queue.drain(true);
  outcomes = [];
  spies = [
    jest.spyOn(listener, 'onEventUpdated'),
    jest.spyOn(listener, 'onSignupCreated'),
    jest.spyOn(listener, 'onSignupUpdated'),
    jest.spyOn(listener, 'onSignupDeleted'),
  ];
});

afterEach(async () => {
  jest.restoreAllMocks();
  await queue.drain(true);
  // Ids restart after truncate — a stale archive job must not hit the next case.
  await phaseQueue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── harness ─────────────────────────────────────────────────────────────

/** Listener fan-out calls so far (lifecycle + signup handlers). */
function fanoutCalls(): number {
  return spies.reduce((n, s) => n + s.mock.calls.length, 0);
}

/** Promote every debounced job, then wait until the write queue is idle. */
async function drainWriteQueue(): Promise<void> {
  await waitFor(
    async () => {
      for (const job of await queue.getJobs(['delayed'])) {
        await job.promote().catch(() => undefined);
      }
      const counts = await queue.getJobCounts('delayed', 'waiting', 'active');
      expect(counts).toEqual({ delayed: 0, waiting: 0, active: 0 });
    },
    20_000,
    50,
  );
}

/**
 * Wait for at least `minNew` fan-outs past `before` (emits are often
 * fire-and-forget after the HTTP response), await every fan-out's enqueue,
 * then drain the queue so every reconcile it caused has completed.
 */
async function settle(before: number, minNew = 1): Promise<void> {
  await waitFor(
    () => {
      expect(fanoutCalls()).toBeGreaterThanOrEqual(before + minNew);
      return Promise.resolve();
    },
    10_000,
    50,
  );
  await Promise.all(
    spies.flatMap((s) => s.mock.results.map((r) => r.value as unknown)),
  );
  await drainWriteQueue();
}

/** Run `step`, then settle the fan-out(s) it triggers. */
async function step(fn: () => Promise<unknown>, minNew = 1): Promise<void> {
  const before = fanoutCalls();
  await fn();
  await settle(before, minNew);
}

interface Member {
  userId: number;
  token: string;
  connectionId: number;
}

/** A member with an active, write-enabled (fake) Google connection. */
async function member(): Promise<Member> {
  seq += 1;
  const { userId, token } = await createMemberAndLogin(
    testApp,
    `cal-rp-${seq}`,
    `cal-rp-${seq}@example.test`,
  );
  const result = fake.seedConnection({ id: `rp-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ writeEnabled: true })
    .where(eq(schema.calendarConnections.id, id));
  return { userId, token, connectionId: id };
}

/** An event a day out, carrying the seeded game (the poll needs it). */
async function newEvent(): Promise<{ id: number; start: Date }> {
  const start = new Date(Date.now() + DAY_MS);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Reschedule Raid',
        gameId: testApp.seed.game.id,
        duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
        maxAttendees: 10,
        creatorId: testApp.seed.adminUser.id,
      })
      .returning(),
    'event',
  );
  return { id: event.id, start };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Real sign-up over HTTP; settles the copy it creates. */
async function signUp(eventId: number, m: Member): Promise<void> {
  await step(async () => {
    const res = await testApp.request
      .post(`/events/${eventId}/signup`)
      .set(auth(m.token))
      .send({});
    expect(res.status).toBe(201);
  });
}

/** POST /scheduling-polls linked to the event (as the reschedule-cycle spec). */
async function openPoll(
  eventId: number,
): Promise<{ matchId: number; lineupId: number }> {
  let ids = { matchId: 0, lineupId: 0 };
  await step(async () => {
    const res = await testApp.request
      .post('/scheduling-polls')
      .set(auth(adminToken))
      .send({ gameId: testApp.seed.game.id, linkedEventId: eventId });
    expect(res.status).toBe(201);
    ids = {
      matchId: res.body.id as number,
      lineupId: res.body.lineupId as number,
    };
  });
  return ids;
}

function rescheduleRequest(eventId: number, start: Date) {
  return testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set(auth(adminToken))
    .send({
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + TWO_HOURS_MS).toISOString(),
    });
}

function completeRequest(matchId: number) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set(auth(adminToken));
}

/**
 * The two-step lock-in (`lockInAtNewTime` in the reschedule-cycle spec).
 * Both requests land inside the 5 s debounce, so the two UPDATED fan-outs
 * share one pending job — the queue is drained only after both.
 */
async function lockInAtNewTime(eventId: number, matchId: number, start: Date) {
  await step(async () => {
    expect((await rescheduleRequest(eventId, start)).status).toBe(200);
    expect((await completeRequest(matchId)).status).toBe(200);
  }, 2);
}

async function abortLineup(lineupId: number): Promise<void> {
  await step(async () => {
    const res = await testApp.request
      .post(`/lineups/${lineupId}/abort`)
      .set(auth(adminToken))
      .send({ reason: 'rok-1857' });
    expect(res.status).toBe(200);
  });
}

/** Expiry: the poll's own archive job fires once its deadline has passed. */
async function expirePoll(lineupId: number): Promise<void> {
  await testApp.db
    .update(schema.communityLineups)
    .set({ phaseDeadline: new Date(Date.now() - 60_000) })
    .where(eq(schema.communityLineups.id, lineupId));
  const job = await phaseQueue.getJob(`lineup-phase-${lineupId}-archived`);
  if (!job) throw new Error(`no archive job queued for lineup ${lineupId}`);
  await step(async () => {
    await job.promote();
    await waitFor(async () => {
      const [row] = await testApp.db
        .select({ status: schema.communityLineups.status })
        .from(schema.communityLineups)
        .where(eq(schema.communityLineups.id, lineupId));
      expect(row?.status).toBe('archived');
    }, 10_000);
  });
}

async function linkFor(m: Member, eventId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.calendarEventLinks)
    .where(
      and(
        eq(schema.calendarEventLinks.connectionId, m.connectionId),
        eq(schema.calendarEventLinks.eventId, eventId),
      ),
    );
  return row ?? null;
}

/** The member's synced copy: its link row + the fake provider's copy. */
async function copyOf(m: Member, eventId: number) {
  const link = await linkFor(m, eventId);
  if (!link) throw new Error(`no link row for user ${m.userId}`);
  const copy = fake.store.getCopy(link.providerEventId);
  if (!copy) throw new Error(`link ${link.providerEventId} has no copy`);
  return { link, copy };
}

function outcomesFor(m: Member, since: number): ReconcileOutcome[] {
  return outcomes
    .slice(since)
    .filter((o) => o.data.connectionId === m.connectionId)
    .map((o) => o.result);
}

/** Copies the provider holds in the member's Raid Ledger calendar. */
function copiesIn(calendarId: string) {
  return fake.store.copiesIn(calendarId);
}

/** Copies the fake CREATED since the spy began: upserts with no existing ref. */
function freshCreates(upsert: { mock: { calls: unknown[][] } }): number {
  return upsert.mock.calls.filter((c) => c[3] === null).length;
}

/** Member signed up with a synced copy, then the poll opened. */
async function seedUnderPoll(m: Member) {
  const event = await newEvent();
  await signUp(event.id, m);
  const before = await copyOf(m, event.id);
  const poll = await openPoll(event.id);
  return { event, before, poll };
}

// ── cases ───────────────────────────────────────────────────────────────

describe('ROK-1857 — a Google copy across a rescheduling poll lifecycle', () => {
  it('1. opening the poll deletes the copy and its link row', async () => {
    const m = await member();
    const event = await newEvent();
    await signUp(event.id, m);
    const { link } = await copyOf(m, event.id);
    const del = jest.spyOn(fake, 'deleteEvent');
    await openPoll(event.id);
    expect(del).toHaveBeenCalledTimes(1);
    expect(copiesIn(link.calendarId)).toEqual([]);
    expect(await linkFor(m, event.id)).toBeNull();
  });

  it('2. lock-in creates exactly ONE new copy at the voted time', async () => {
    const m = await member();
    const { event, before, poll } = await seedUnderPoll(m);
    const upsert = jest.spyOn(fake, 'upsertEvent');
    const mark = outcomes.length;
    const newStart = new Date(Date.now() + 7 * DAY_MS);
    await lockInAtNewTime(event.id, poll.matchId, newStart);
    const after = await copyOf(m, event.id);
    expect(after.copy.start.getTime()).toBe(newStart.getTime());
    expect(after.copy.id).not.toBe(before.copy.id);
    expect(after.link.providerEventId).toBe(after.copy.id);
    expect(copiesIn(after.link.calendarId)).toHaveLength(1);
    // Two UPDATED emits (reschedule + complete) → one creation, no extras.
    const created = outcomesFor(m, mark).filter((o) => o.result === 'created');
    expect(created).toHaveLength(1);
    expect(freshCreates(upsert)).toBe(1);
  });

  it('3. aborting the lineup restores the copy at the ORIGINAL time', async () => {
    const m = await member();
    const { event, before, poll } = await seedUnderPoll(m);
    await abortLineup(poll.lineupId);
    const after = await copyOf(m, event.id);
    expect(after.copy.start.getTime()).toBe(event.start.getTime());
    expect(after.copy.id).not.toBe(before.copy.id);
    expect(copiesIn(after.link.calendarId)).toHaveLength(1);
  });

  it('4. poll expiry (archive deadline job) restores the copy like abort', async () => {
    const m = await member();
    const { event, before, poll } = await seedUnderPoll(m);
    await expirePoll(poll.lineupId);
    const after = await copyOf(m, event.id);
    expect(after.copy.start.getTime()).toBe(event.start.getTime());
    expect(after.copy.id).not.toBe(before.copy.id);
    expect(copiesIn(after.link.calendarId)).toHaveLength(1);
  });
});

describe('ROK-1857 — closing on the same slot, and polls back to back', () => {
  it('2a. closing on the SAME slot creates one fresh copy at the original time', async () => {
    const m = await member();
    const { event, before, poll } = await seedUnderPoll(m);
    const upsert = jest.spyOn(fake, 'upsertEvent');
    await step(async () => {
      expect((await completeRequest(poll.matchId)).status).toBe(200);
    });
    const after = await copyOf(m, event.id);
    expect(after.copy.start.getTime()).toBe(event.start.getTime());
    expect(after.copy.id).not.toBe(before.copy.id);
    expect(copiesIn(after.link.calendarId)).toHaveLength(1);
    expect(freshCreates(upsert)).toBe(1);
  });

  it('2b. two polls back to back leave ONE copy at the second time', async () => {
    const m = await member();
    const event = await newEvent();
    await signUp(event.id, m);
    const del = jest.spyOn(fake, 'deleteEvent');
    const upsert = jest.spyOn(fake, 'upsertEvent');
    const first = await openPoll(event.id);
    const startA = new Date(Date.now() + 7 * DAY_MS);
    await lockInAtNewTime(event.id, first.matchId, startA);
    const afterA = await copyOf(m, event.id);
    expect(afterA.copy.start.getTime()).toBe(startA.getTime());
    expect(freshCreates(upsert)).toBe(1);
    const second = await openPoll(event.id);
    expect(await linkFor(m, event.id)).toBeNull();
    const startB = new Date(Date.now() + 14 * DAY_MS);
    await lockInAtNewTime(event.id, second.matchId, startB);
    const afterB = await copyOf(m, event.id);
    expect(afterB.copy.start.getTime()).toBe(startB.getTime());
    expect(afterB.copy.id).not.toBe(afterA.copy.id);
    expect(copiesIn(afterB.link.calendarId)).toHaveLength(1);
    expect(freshCreates(upsert)).toBe(2); // exactly one creation per close
    expect(del).toHaveBeenCalledTimes(2); // one delete per open
  });
});

describe('ROK-1857 — cases where nothing may be restored or moved', () => {
  it.each(['abort', 'close'] as const)(
    '5. event cancelled during the poll → nothing restored on %s',
    async (ending) => {
      const m = await member();
      const del = jest.spyOn(fake, 'deleteEvent');
      const { event, before, poll } = await seedUnderPoll(m);
      // The L1 rule removed the copy at OPEN, before the cancel ran.
      expect(del).toHaveBeenCalledTimes(1);
      expect(await linkFor(m, event.id)).toBeNull();
      const upsert = jest.spyOn(fake, 'upsertEvent');
      await step(async () => {
        const res = await testApp.request
          .patch(`/events/${event.id}/cancel`)
          .set(auth(adminToken))
          .send({});
        expect(res.status).toBe(200);
      });
      if (ending === 'abort') await abortLineup(poll.lineupId);
      else
        await step(async () => {
          expect((await completeRequest(poll.matchId)).status).toBe(200);
        }, 0); // complete skips the re-emit for a cancelled event
      expect(upsert).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledTimes(1); // nothing left for the cancel
      expect(copiesIn(before.link.calendarId)).toEqual([]);
      expect(await linkFor(m, event.id)).toBeNull();
    },
  );

  it('6. a manual time edit with no poll PATCHes the same copy in place', async () => {
    const m = await member();
    const event = await newEvent();
    await signUp(event.id, m);
    const before = await copyOf(m, event.id);
    const del = jest.spyOn(fake, 'deleteEvent');
    const newStart = new Date(Date.now() + 3 * DAY_MS);
    await step(async () => {
      expect((await rescheduleRequest(event.id, newStart)).status).toBe(200);
    });
    const after = await copyOf(m, event.id);
    expect(after.copy.id).toBe(before.copy.id);
    expect(after.copy.start.getTime()).toBe(newStart.getTime());
    expect(del).not.toHaveBeenCalled();
  });
});

describe('ROK-1857 — members who must not get a fresh copy', () => {
  /**
   * D9 documented gap: a `needs_reconnect` connection is frozen
   * (`connection_inactive`), so its copy stays at the OLD time through the
   * poll and after lock-in. Reconnecting re-queues the event (PATCH to the
   * new time); until then the user's calendar is stale. The active control
   * member proves the open/close fan-outs ran.
   */
  it('7. a needs_reconnect connection is untouched on open and close', async () => {
    const [stale, control] = [await member(), await member()];
    const event = await newEvent();
    await signUp(event.id, stale);
    await signUp(event.id, control);
    const before = await copyOf(stale, event.id);
    const controlBefore = await copyOf(control, event.id);
    await testApp.db
      .update(schema.calendarConnections)
      .set({ status: 'needs_reconnect' })
      .where(eq(schema.calendarConnections.id, stale.connectionId));
    const del = jest.spyOn(fake, 'deleteEvent');
    const poll = await openPoll(event.id);
    // Frozen reasons win over `rescheduling`: only the control's copy goes.
    expect(del.mock.calls.map((c) => c[1].providerEventId)).toEqual([
      controlBefore.copy.id,
    ]);
    expect(await linkFor(control, event.id)).toBeNull();
    expect(await linkFor(stale, event.id)).not.toBeNull();
    expect(fake.store.getCopy(before.copy.id)).toEqual(before.copy);
    const newStart = new Date(Date.now() + 7 * DAY_MS);
    await lockInAtNewTime(event.id, poll.matchId, newStart);
    expect((await copyOf(control, event.id)).copy.start.getTime()).toBe(
      newStart.getTime(),
    );
    const after = await copyOf(stale, event.id);
    expect(after.copy).toEqual(before.copy);
    expect(after.link.providerEventId).toBe(before.link.providerEventId);
  });

  it('9. a member who un-signs during the poll gets no copy on close', async () => {
    const [leaver, control] = [await member(), await member()];
    const event = await newEvent();
    await signUp(event.id, leaver);
    await signUp(event.id, control);
    const { link } = await copyOf(leaver, event.id);
    const poll = await openPoll(event.id);
    await step(async () => {
      const res = await testApp.request
        .delete(`/events/${event.id}/signup`)
        .set(auth(leaver.token));
      expect(res.status).toBe(200);
    });
    const newStart = new Date(Date.now() + 7 * DAY_MS);
    await lockInAtNewTime(event.id, poll.matchId, newStart);
    expect((await copyOf(control, event.id)).copy.start.getTime()).toBe(
      newStart.getTime(),
    );
    expect(copiesIn(link.calendarId)).toEqual([]);
    expect(await linkFor(leaver, event.id)).toBeNull();
  });
});

describe('ROK-1857 — a member with "send my events" off', () => {
  it('8. sending turned off during the poll → no copy on close; the control gets one', async () => {
    const [quiet, control] = [await member(), await member()];
    const event = await newEvent();
    await signUp(event.id, quiet);
    await signUp(event.id, control);
    const { link } = await copyOf(quiet, event.id);
    const poll = await openPoll(event.id);
    await testApp.db
      .update(schema.calendarConnections)
      .set({ writeEnabled: false })
      .where(eq(schema.calendarConnections.id, quiet.connectionId));
    const newStart = new Date(Date.now() + 7 * DAY_MS);
    await lockInAtNewTime(event.id, poll.matchId, newStart);
    expect((await copyOf(control, event.id)).copy.start.getTime()).toBe(
      newStart.getTime(),
    );
    expect(copiesIn(link.calendarId)).toEqual([]);
    expect(await linkFor(quiet, event.id)).toBeNull();
  });
});
