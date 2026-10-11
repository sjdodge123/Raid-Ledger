/**
 * ROK-1596 E1 (plan D9, Q4, F4, F7, F10): the event page's calendar routes —
 * copy state, Undo, and the one-event `.ics` — against Postgres + the Fake
 * provider (a `demo-fake:` connection routed by the DEMO_MODE double gate).
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import {
  createFutureEvent,
  createMemberAndLogin,
} from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import { reconcileCalendarCopy } from './write/calendar-write-reconcile.helpers';
import { formatIcsUtc } from './feed/ics-serialize.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const COPY = '/users/me/calendars/events';

let testApp: TestApp;
let adminToken: string;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let userId: number;
let token: string;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  seq += 1;
  ({ userId, token } = await createMemberAndLogin(
    testApp,
    `cal-ev-${seq}`,
    `cal-ev-${seq}@example.test`,
  ));
});

afterEach(async () => {
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedConnection(writeEnabled = true): Promise<number> {
  const result = fake.seedConnection({ id: `ev-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ writeEnabled })
    .where(eq(schema.calendarConnections.id, id));
  return id;
}

async function signedUpEvent(): Promise<number> {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Raid Night',
  });
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'signed_up',
    confirmationStatus: 'pending',
  });
  return eventId;
}

function reconcile(connectionId: number, eventId: number) {
  const deps = testApp.app.get(CalendarWriteProcessor).reconcileDeps();
  return reconcileCalendarCopy(deps, { connectionId, eventId, userId });
}

async function linkOf(eventId: number) {
  const t = schema.calendarEventLinks;
  const rows = await testApp.db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.userId, userId)));
  return rows;
}

const copiesOf = (eventId: number) =>
  fake.store
    .allCopies()
    .filter((c) => c.copyId.endsWith(`:${eventId}:${userId}`));

const getCopy = (eventId: number) =>
  testApp.request
    .get(`${COPY}/${eventId}`)
    .set('Authorization', `Bearer ${token}`);

const undo = (eventId: number) =>
  testApp.request
    .post(`${COPY}/${eventId}/undo`)
    .set('Authorization', `Bearer ${token}`);

/** Nest sends an empty body for a `null` return. */
const bodyOrNull = (res: { text: string; body: unknown }) =>
  res.text === '' ? null : res.body;

describe('GET /users/me/calendars/events/:eventId (D9)', () => {
  it('is null when the user has no write connection', async () => {
    await seedConnection(false);
    const eventId = await signedUpEvent();
    const res = await getCopy(eventId);
    expect(res.status).toBe(200);
    expect(bodyOrNull(res)).toBeNull();
  });

  it('is pending when sending is on, signed up, and no copy exists yet', async () => {
    await seedConnection();
    const eventId = await signedUpEvent();
    const res = await getCopy(eventId);
    expect(res.body).toEqual({
      provider: 'google',
      state: 'pending',
      openUrl: null,
    });
  });

  it('is null (not pending) without an active sign-up', async () => {
    await seedConnection();
    const eventId = await createFutureEvent(testApp, adminToken, {});
    expect(bodyOrNull(await getCopy(eventId))).toBeNull();
  });

  it('is synced with the Google eid Open URL once the copy exists (F4)', async () => {
    const connectionId = await seedConnection();
    const eventId = await signedUpEvent();
    expect(await reconcile(connectionId, eventId)).toEqual({
      result: 'created',
    });
    const [link] = await linkOf(eventId);
    const eid = Buffer.from(
      `${link?.providerEventId} ${link?.calendarId}`,
    ).toString('base64url');
    expect((await getCopy(eventId)).body).toEqual({
      provider: 'google',
      state: 'synced',
      openUrl: `https://www.google.com/calendar/event?eid=${eid}`,
    });
  });

  it('two write connections → the active one answers, deterministically (lane W)', async () => {
    const stale = await seedConnection();
    await testApp.db
      .update(schema.calendarConnections)
      .set({ status: 'needs_reconnect' })
      .where(eq(schema.calendarConnections.id, stale));
    const eventId = await signedUpEvent();
    await testApp.db.insert(schema.calendarEventLinks).values({
      connectionId: stale,
      userId,
      eventId,
      calendarId: 'primary',
      providerEventId: 'stale-copy',
      state: 'failed',
    });
    const fresh = await upsertCalendarConnection(testApp.db, {
      userId,
      provider: 'google',
      result: fake.seedConnection({ id: `ev-fresh-${seq}` }),
    });
    await testApp.db
      .update(schema.calendarConnections)
      .set({ writeEnabled: true })
      .where(eq(schema.calendarConnections.id, fresh.id));
    expect(bodyOrNull(await getCopy(eventId))).toEqual({
      provider: 'google',
      state: 'pending',
      openUrl: null,
    });
  });

  it('is failed (no Open URL) when the link failed', async () => {
    const connectionId = await seedConnection();
    const eventId = await signedUpEvent();
    await reconcile(connectionId, eventId);
    await testApp.db
      .update(schema.calendarEventLinks)
      .set({ state: 'failed' })
      .where(eq(schema.calendarEventLinks.eventId, eventId));
    expect((await getCopy(eventId)).body).toEqual({
      provider: 'google',
      state: 'failed',
      openUrl: null,
    });
  });

  it('is null while the calendar kill switch is off', async () => {
    const connectionId = await seedConnection();
    const eventId = await signedUpEvent();
    await reconcile(connectionId, eventId);
    await setCalendarSyncEnabled(settings, false);
    expect(bodyOrNull(await getCopy(eventId))).toBeNull();
  });
});

describe('POST /users/me/calendars/events/:eventId/undo (Q4)', () => {
  it('a link with no remote id (placeholder) → no provider delete (review m3)', async () => {
    const connectionId = await seedConnection();
    const eventId = await signedUpEvent();
    await testApp.db.insert(schema.calendarEventLinks).values({
      connectionId,
      userId,
      eventId,
      calendarId: 'primary',
      providerEventId: '',
      state: 'failed',
    });
    const deleteEvent = jest.spyOn(fake, 'deleteEvent');
    try {
      expect((await undo(eventId)).status).toBe(204);
      expect(deleteEvent).not.toHaveBeenCalled();
    } finally {
      deleteEvent.mockRestore();
    }
  });

  it('deletes the copy, suppresses the link, keeps the sign-up; reconcile is a noop', async () => {
    const connectionId = await seedConnection();
    const eventId = await signedUpEvent();
    await reconcile(connectionId, eventId);
    expect(copiesOf(eventId)).toHaveLength(1);

    expect((await undo(eventId)).status).toBe(204);
    expect(copiesOf(eventId)).toHaveLength(0);
    expect((await linkOf(eventId)).map((l) => l.state)).toEqual(['suppressed']);
    const signups = await testApp.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      );
    expect(signups.map((s) => s.status)).toEqual(['signed_up']);

    expect((await reconcile(connectionId, eventId)).result).toBe('noop');
    expect(copiesOf(eventId)).toHaveLength(0);
    expect((await getCopy(eventId)).body.state).toBe('suppressed');
  });

  it('works before the write job ran: placeholder suppressed link, job creates nothing', async () => {
    const connectionId = await seedConnection();
    const eventId = await signedUpEvent();
    expect((await undo(eventId)).status).toBe(204);
    const links = await linkOf(eventId);
    expect(links.map((l) => [l.state, l.providerEventId])).toEqual([
      ['suppressed', ''],
    ]);
    expect((await reconcile(connectionId, eventId)).result).toBe('noop');
    expect(copiesOf(eventId)).toHaveLength(0);
  });

  it('404s with a write connection but no sign-up and no link', async () => {
    await seedConnection();
    const eventId = await createFutureEvent(testApp, adminToken, {});
    expect((await undo(eventId)).status).toBe(404);
    expect(await linkOf(eventId)).toEqual([]);
  });

  it('404s with a sign-up but no write connection', async () => {
    await seedConnection(false);
    const eventId = await signedUpEvent();
    expect((await undo(eventId)).status).toBe(404);
    expect(await linkOf(eventId)).toEqual([]);
  });
});

describe('GET /events/:id/ics (D9, F7, F10)', () => {
  const ics = (id: number | string, auth?: string) => {
    const req = testApp.request.get(`/events/${id}/ics`);
    return auth ? req.set('Authorization', `Bearer ${auth}`) : req;
  };

  it('returns one text/calendar VEVENT with the stable UID and UTC DTSTART', async () => {
    const eventId = await createFutureEvent(testApp, adminToken, {
      title: 'Raid Night',
    });
    const res = await ics(eventId);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    const [row] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    const host = new URL(await settings.getClientUrl()).host;
    const lines = res.text.split('\r\n');
    expect(lines).toContain(`UID:rl-${eventId}@${host}`);
    expect(lines).toContain(`DTSTART:${formatIcsUtc(row!.duration[0])}`);
    expect(lines).toContain('SUMMARY:Raid Night');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    // Review NIT: a named download + revision fields.
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="raid-night.ics"',
    );
    expect(lines).toContain(`LAST-MODIFIED:${formatIcsUtc(row!.updatedAt)}`);
    expect(lines.some((l) => /^SEQUENCE:\d+$/.test(l))).toBe(true);
  });

  it('404s for an unknown event', async () => {
    expect((await ics(999_999)).status).toBe(404);
  });

  it('still works with the calendar kill switch off (F10)', async () => {
    await setCalendarSyncEnabled(settings, false);
    const eventId = await createFutureEvent(testApp, adminToken, {});
    expect((await ics(eventId)).status).toBe(200);
  });

  it('answers exactly like GET /events/:id for every viewer and id (F7)', async () => {
    const eventId = await createFutureEvent(testApp, adminToken, {});
    const ids: Array<number | string> = [eventId, 999_999, 'abc'];
    for (const auth of [undefined, token, 'not-a-jwt']) {
      for (const id of ids) {
        const read = testApp.request.get(`/events/${id}`);
        const base = auth ? read.set('Authorization', `Bearer ${auth}`) : read;
        const expected = (await base).status;
        expect({ id, auth, status: (await ics(id, auth)).status }).toEqual({
          id,
          auth,
          status: expected,
        });
      }
    }
  });
});
