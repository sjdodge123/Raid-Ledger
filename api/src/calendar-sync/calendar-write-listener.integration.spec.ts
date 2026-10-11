/**
 * ROK-1596 A4: `CalendarWriteListener` fan-out (epic ROK-669 §4.5.1, plan
 * D10). Each emit is asserted by the reconcile job ids it leaves on the real
 * BullMQ queue. The worker is paused for the whole file so a job is never
 * consumed under an assertion; the end-to-end case runs the queued key
 * through `reconcileCalendarCopy` itself.
 */
import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import {
  createFutureEvent,
  createMemberAndLogin,
} from '../events/signups.integration.spec-helpers';
import {
  APP_EVENT_EVENTS,
  SIGNUP_EVENTS,
} from '../discord-bot/discord-bot.constants';
import * as schema from '../drizzle/schema';
import { EventSeriesService } from '../events/event-series.service';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_WRITE_QUEUE,
  reconcileJobId,
} from './calendar-sync.constants';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import { reconcileCalendarCopy } from './write/calendar-write-reconcile.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

let testApp: TestApp;
let adminToken: string;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let emitter: EventEmitter2;
let queue: Queue;
let processor: CalendarWriteProcessor;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  emitter = testApp.app.get(EventEmitter2);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  processor = testApp.app.get(CalendarWriteProcessor);
  await processor.worker.pause(true);
});

afterAll(() => {
  void processor.worker.resume();
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  await queue.drain(true);
});

afterEach(async () => {
  await queue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

interface Member {
  userId: number;
  token: string;
  connectionId: number;
}

/** A member with a connected (fake) calendar; write on unless told off. */
async function member(writeEnabled = true): Promise<Member> {
  seq += 1;
  const { userId, token } = await createMemberAndLogin(
    testApp,
    `cal-ls-${seq}`,
    `cal-ls-${seq}@example.test`,
  );
  const result = fake.seedConnection({ id: `ls-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ writeEnabled })
    .where(eq(schema.calendarConnections.id, id));
  return { userId, token, connectionId: id };
}

function newEvent(): Promise<number> {
  return createFutureEvent(testApp, adminToken, { title: 'Raid Night' });
}

async function signUp(eventId: number, userId: number | null) {
  const [row] = await testApp.db
    .insert(schema.eventSignups)
    .values({
      eventId,
      userId,
      discordUserId: userId === null ? `discord-only-${eventId}` : null,
      status: 'signed_up',
      confirmationStatus: 'pending',
    })
    .returning({ id: schema.eventSignups.id });
  if (!row) throw new Error('signup insert returned no row');
  return row.id;
}

async function seedLink(eventId: number, m: Member): Promise<void> {
  await testApp.db.insert(schema.calendarEventLinks).values({
    connectionId: m.connectionId,
    userId: m.userId,
    eventId,
    calendarId: 'rl-cal',
    providerEventId: `copy-${eventId}-${m.userId}`,
  });
}

/** The reconcile job queued for (member, event), or null. */
async function jobFor(m: Member, eventId: number) {
  const job = await queue.getJob(
    reconcileJobId(m.connectionId, eventId, m.userId),
  );
  return job ?? null;
}

async function expectQueued(m: Member, eventId: number): Promise<void> {
  const job = await jobFor(m, eventId);
  expect(job?.data).toEqual({
    kind: 'reconcile',
    connectionId: m.connectionId,
    eventId,
    userId: m.userId,
  });
}

async function queuedIds(): Promise<string[]> {
  const jobs = await queue.getJobs(['delayed', 'waiting']);
  return jobs.map((j) => String(j.id)).sort();
}

describe('signup emits', () => {
  it.each([
    SIGNUP_EVENTS.CREATED,
    SIGNUP_EVENTS.UPDATED,
    SIGNUP_EVENTS.DELETED,
  ])('%s with a userId queues that user only', async (name) => {
    const [a, b] = [await member(), await member()];
    const eventId = await newEvent();
    await signUp(eventId, a.userId);
    await signUp(eventId, b.userId);
    await emitter.emitAsync(name, { eventId, userId: a.userId, action: 'x' });
    expect(await queuedIds()).toEqual([
      reconcileJobId(a.connectionId, eventId, a.userId),
    ]);
    await expectQueued(a, eventId);
  });

  it('roster_updated (no userId) fans out to signups ∪ links, not write-off users', async () => {
    const [signed, linkOnly, writeOff] = [
      await member(),
      await member(),
      await member(false),
    ];
    const eventId = await newEvent();
    await signUp(eventId, signed.userId);
    await signUp(eventId, writeOff.userId);
    await seedLink(eventId, linkOnly);
    await emitter.emitAsync(SIGNUP_EVENTS.UPDATED, {
      eventId,
      action: 'roster_updated',
    });
    expect(await queuedIds()).toEqual(
      [
        reconcileJobId(signed.connectionId, eventId, signed.userId),
        reconcileJobId(linkOnly.connectionId, eventId, linkOnly.userId),
      ].sort(),
    );
  });

  it('a Discord-only signup (signupId, no userId) is skipped, not fanned out', async () => {
    const other = await member();
    const eventId = await newEvent();
    await signUp(eventId, other.userId);
    const signupId = await signUp(eventId, null);
    await emitter.emitAsync(SIGNUP_EVENTS.DELETED, {
      eventId,
      signupId,
      action: 'discord_signup_cancelled',
    });
    expect(await queuedIds()).toEqual([]);
  });

  it('F11: a signupId-only emit for a web signup (bench move) queues that user', async () => {
    const [m, other] = [await member(), await member()];
    const eventId = await newEvent();
    const signupId = await signUp(eventId, m.userId);
    await signUp(eventId, other.userId);
    await emitter.emitAsync(SIGNUP_EVENTS.UPDATED, {
      eventId,
      signupId,
      action: 'tentative_reslotted',
    });
    expect(await queuedIds()).toEqual([
      reconcileJobId(m.connectionId, eventId, m.userId),
    ]);
    await expectQueued(m, eventId);
  });
});

describe('kill switch', () => {
  it('kill switch off → no job for any emit', async () => {
    const m = await member();
    const eventId = await newEvent();
    await signUp(eventId, m.userId);
    await seedLink(eventId, m);
    await setCalendarSyncEnabled(settings, false);
    await emitter.emitAsync(SIGNUP_EVENTS.CREATED, {
      eventId,
      userId: m.userId,
      action: 'x',
    });
    await emitter.emitAsync(APP_EVENT_EVENTS.UPDATED, { eventId });
    await emitter.emitAsync(APP_EVENT_EVENTS.DELETED, { eventId });
    expect(await queuedIds()).toEqual([]);
  });
});

describe('event lifecycle emits', () => {
  it.each([APP_EVENT_EVENTS.UPDATED, APP_EVENT_EVENTS.CANCELLED])(
    '%s fans out over the event',
    async (name) => {
      const [signed, linkOnly] = [await member(), await member()];
      const eventId = await newEvent();
      await signUp(eventId, signed.userId);
      await seedLink(eventId, linkOnly);
      await emitter.emitAsync(name, { eventId });
      await expectQueued(signed, eventId);
      await expectQueued(linkOnly, eventId);
    },
  );

  it('RESCHEDULING is a no-op', async () => {
    const m = await member();
    const eventId = await newEvent();
    await signUp(eventId, m.userId);
    await emitter.emitAsync(APP_EVENT_EVENTS.RESCHEDULING, { eventId });
    expect(await queuedIds()).toEqual([]);
  });

  it('DELETE /events/:id queues each link before the row goes; the job deletes the copy', async () => {
    const m = await member();
    const eventId = await newEvent();
    await signUp(eventId, m.userId);
    const deps = processor.reconcileDeps();
    const key = { connectionId: m.connectionId, eventId, userId: m.userId };
    expect(await reconcileCalendarCopy(deps, key)).toMatchObject({
      result: 'created',
    });
    await queue.drain(true);
    const res = await testApp.request
      .delete(`/events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBeLessThan(300);
    await expectQueued(m, eventId);
    expect(await reconcileCalendarCopy(deps, key)).toMatchObject({
      result: 'deleted',
    });
    expect(fake.store.allCopies()).toHaveLength(0);
  });

  it('series cancel queues one job per cancelled event', async () => {
    const m = await member();
    const first = await newEvent();
    const ids = [first, await newEvent()];
    await testApp.db
      .update(schema.events)
      .set({ recurrenceGroupId: randomUUID() })
      .where(inArray(schema.events.id, ids));
    for (const id of ids) await signUp(id, m.userId);
    await testApp.app
      .get(EventSeriesService)
      .cancel(first, m.userId, true, 'all', {});
    await waitFor(async () => {
      expect(await queuedIds()).toEqual(
        ids.map((id) => reconcileJobId(m.connectionId, id, m.userId)).sort(),
      );
    });
  });
});

it('end to end: a real sign-up queues the triple; reconciling it writes one copy', async () => {
  const m = await member();
  const eventId = await newEvent();
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${m.token}`)
    .send({});
  expect({ status: res.status, body: res.body as unknown }).toMatchObject({
    status: 201,
  });
  await waitFor(() => expectQueued(m, eventId));
  const job = await jobFor(m, eventId);
  if (!job) throw new Error('reconcile job vanished after waitFor');
  await job.remove();
  const deps = processor.reconcileDeps();
  expect(
    await reconcileCalendarCopy(deps, {
      connectionId: m.connectionId,
      eventId,
      userId: m.userId,
    }),
  ).toMatchObject({
    result: 'created',
  });
  expect(fake.store.allCopies()).toHaveLength(1);
});
