/**
 * Calendar Sync overview + tables — integration (ROK-1591).
 *
 * `GET /users/me/calendars` against Postgres: the kill-switch off shape,
 * provider availability, the row → CalendarConnection mapping, and that the
 * stored credentials never reach the response. Then the DB contract of
 * migration 0201: CHECK constraints, the (user, provider, subject) unique key,
 * the users-delete path, the connection → links cascade, and the deliberate
 * absence of an FK on `calendar_event_links.event_id` (spec L272).
 */
import { eq, sql } from 'drizzle-orm';
import { CalendarsOverviewSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createFutureEvent,
} from '../events/signups.integration.spec-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';

const ROUTE = '/users/me/calendars';
/** Distinctive so a substring search over the response cannot false-match. */
const CREDS = 'enc:rok1591-credentials-must-never-leak-b81d2e';

type ConnectionInsert = typeof schema.calendarConnections.$inferInsert;
type LinkInsert = typeof schema.calendarEventLinks.$inferInsert;

let testApp: TestApp;
let adminToken: string;
let subjectSeq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function insertConnection(
  userId: number,
  overrides: Partial<ConnectionInsert> = {},
) {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.calendarConnections)
      .values({
        userId,
        provider: 'google',
        accountSubject: `sub-${userId}-${++subjectSeq}`,
        credentialsEncrypted: CREDS,
        ...overrides,
      })
      .returning(),
    'calendar connection',
  );
  return row;
}

async function insertLink(
  connectionId: number,
  userId: number,
  eventId: number,
  overrides: Partial<LinkInsert> = {},
) {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.calendarEventLinks)
      .values({
        connectionId,
        userId,
        eventId,
        calendarId: 'rl-dedicated-calendar',
        providerEventId: `prov-${connectionId}-${eventId}`,
        ...overrides,
      })
      .returning(),
    'calendar event link',
  );
  return row;
}

function connectionsOf(userId: number) {
  return testApp.db
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.userId, userId));
}

function linksOf(userId: number) {
  return testApp.db
    .select()
    .from(schema.calendarEventLinks)
    .where(eq(schema.calendarEventLinks.userId, userId));
}

async function putCalendarSettings(body: object): Promise<void> {
  const res = await testApp.request
    .put('/admin/settings/calendar-sync')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  expect(res.status).toBe(200);
}

function getOverview(token: string) {
  return testApp.request.get(ROUTE).set('Authorization', `Bearer ${token}`);
}

function member(tag: string) {
  return createMemberAndLogin(testApp, `cal${tag}`, `cal${tag}@test.local`);
}

/** The PG error drizzle wraps (SQLSTATE + constraint live on `.cause`). */
function pgError(code: string, constraint: string) {
  return {
    cause: expect.objectContaining({ code, constraint_name: constraint }),
  };
}

// ─── overview: the kill switch ───────────────────────────────────────────────

describe('GET /users/me/calendars — kill switch', () => {
  it('rejects an unauthenticated request with 401', async () => {
    expect((await testApp.request.get(ROUTE)).status).toBe(401);
  });

  it('returns the exact off shape, hiding existing rows', async () => {
    const { userId, token } = await member('off');
    await insertConnection(userId);
    const res = await getOverview(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      providers: {
        google: { available: false },
        microsoft: { available: false },
        apple: { available: false },
      },
      connections: [],
      readSettings: { mode: 'both', lookAheadWeeks: 4 },
      feed: null,
    });
    expect(() => CalendarsOverviewSchema.parse(res.body)).not.toThrow();
  });

  it('keeps every provider unavailable while off, even when configured', async () => {
    const { token } = await member('offcfg');
    await putCalendarSettings({
      enabled: false,
      google: { clientId: 'gid', clientSecret: 'gsecret' },
    });
    const res = await getOverview(token);
    expect(res.body.enabled).toBe(false);
    expect(res.body.providers.google).toEqual({ available: false });
    expect(res.body.providers.apple).toEqual({ available: false });
  });

  it('on with nothing configured: only apple is available', async () => {
    const { token } = await member('onbare');
    await putCalendarSettings({ enabled: true });
    const res = await getOverview(token);
    expect(res.body.enabled).toBe(true);
    expect(res.body.providers).toEqual({
      google: { available: false },
      microsoft: { available: false },
      apple: { available: true },
    });
  });

  it('google turns available only once client id AND secret are set', async () => {
    const { token } = await member('ongoogle');
    await putCalendarSettings({ enabled: true, google: { clientId: 'gid' } });
    const idOnly = await getOverview(token);
    expect(idOnly.body.providers.google).toEqual({ available: false });

    await putCalendarSettings({ google: { clientSecret: 'gsecret' } });
    const both = await getOverview(token);
    expect(both.body.providers.google).toEqual({ available: true });
    expect(both.body.providers.microsoft).toEqual({ available: false });

    await putCalendarSettings({ google: { clientId: '' } });
    const secretOnly = await getOverview(token);
    expect(secretOnly.body.providers.google).toEqual({ available: false });
  });
});

// ─── overview: rows ──────────────────────────────────────────────────────────

describe('GET /users/me/calendars — row mapping', () => {
  it('maps the caller’s rows field by field, oldest first', async () => {
    const { userId, token } = await member('rows');
    const synced = new Date('2026-10-01T12:30:00.000Z');
    const first = await insertConnection(userId, {
      accountLabel: 'raider@example.test',
      lastSyncedAt: synced,
      readEnabled: true,
      readCalendarIds: ['primary', 'team@group.calendar.google.com'],
      writeEnabled: true,
      writeTarget: 'primary',
    });
    const second = await insertConnection(userId, {
      provider: 'apple',
      status: 'needs_reconnect',
      lastErrorCode: 'auth_revoked',
    });
    await putCalendarSettings({ enabled: true });

    const res = await getOverview(token);
    expect(res.status).toBe(200);
    expect(res.body.connections).toEqual([
      {
        id: first.id,
        provider: 'google',
        accountLabel: 'raider@example.test',
        status: 'active',
        lastSyncedAt: synced.toISOString(),
        errorCode: null,
        read: {
          enabled: true,
          calendarIds: ['primary', 'team@group.calendar.google.com'],
        },
        write: { enabled: true, target: 'primary' },
      },
      {
        id: second.id,
        provider: 'apple',
        accountLabel: null,
        status: 'needs_reconnect',
        lastSyncedAt: null,
        errorCode: 'auth_revoked',
        read: { enabled: false, calendarIds: [] },
        write: { enabled: false, target: 'dedicated' },
      },
    ]);
    expect(() => CalendarsOverviewSchema.parse(res.body)).not.toThrow();
  });
});

describe('GET /users/me/calendars — isolation + secrecy', () => {
  it('never lists another user’s connections', async () => {
    const me = await member('mine');
    const other = await member('theirs');
    const mine = await insertConnection(me.userId);
    await insertConnection(other.userId, { accountLabel: 'not-mine@x.test' });
    await putCalendarSettings({ enabled: true });

    const res = await getOverview(me.token);
    const ids = (res.body.connections as Array<{ id: number }>).map(
      (c) => c.id,
    );
    expect(ids).toEqual([mine.id]);
    expect(res.text).not.toContain('not-mine@x.test');
  });

  it('never returns the stored credentials or their column', async () => {
    const { userId, token } = await member('creds');
    await insertConnection(userId, { accountLabel: 'creds@example.test' });
    await putCalendarSettings({ enabled: true });

    const res = await getOverview(token);
    expect(res.body.connections).toHaveLength(1);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(CREDS);
    expect(res.text).not.toContain(CREDS);
    expect(json).not.toMatch(/credentials/i);
  });
});

// ─── DB contract: CHECKs + unique key ────────────────────────────────────────

describe('calendar tables — CHECK constraints', () => {
  it('rejects an unknown provider', async () => {
    const { userId } = await member('chkprov');
    await expect(
      insertConnection(userId, { provider: 'outlook' }),
    ).rejects.toMatchObject(
      pgError('23514', 'calendar_connections_provider_chk'),
    );
  });

  it('rejects an unknown status', async () => {
    const { userId } = await member('chkstatus');
    await expect(
      insertConnection(userId, { status: 'paused' }),
    ).rejects.toMatchObject(
      pgError('23514', 'calendar_connections_status_chk'),
    );
  });

  it('rejects an unknown write_target', async () => {
    const { userId } = await member('chktarget');
    await expect(
      insertConnection(userId, { writeTarget: 'secondary' }),
    ).rejects.toMatchObject(
      pgError('23514', 'calendar_connections_write_target_chk'),
    );
  });

  it('rejects an unknown link state', async () => {
    const { userId } = await member('chkstate');
    const conn = await insertConnection(userId);
    const eventId = await createFutureEvent(testApp, adminToken);
    await expect(
      insertLink(conn.id, userId, eventId, { state: 'pending' }),
    ).rejects.toMatchObject(pgError('23514', 'calendar_event_links_state_chk'));
  });
});

describe('calendar_connections — (user, provider, account_subject) unique', () => {
  it('rejects a duplicate triple but allows the subject under another provider or user', async () => {
    const a = await member('dupa');
    const b = await member('dupb');
    await insertConnection(a.userId, { accountSubject: 'same-sub' });
    await expect(
      insertConnection(a.userId, { accountSubject: 'same-sub' }),
    ).rejects.toMatchObject(
      pgError('23505', 'calendar_connections_user_provider_subject_uq'),
    );

    await insertConnection(a.userId, {
      accountSubject: 'same-sub',
      provider: 'microsoft',
    });
    await insertConnection(b.userId, { accountSubject: 'same-sub' });
    expect(await connectionsOf(a.userId)).toHaveLength(2);
    expect(await connectionsOf(b.userId)).toHaveLength(1);
  });
});

// ─── DB contract: deletes ────────────────────────────────────────────────────

describe('calendar tables — user + connection deletes', () => {
  it('the users-delete path removes the user’s connections and links only', async () => {
    const gone = await member('delgone');
    const kept = await member('delkept');
    const eventId = await createFutureEvent(testApp, adminToken);
    const goneConn = await insertConnection(gone.userId);
    await insertLink(goneConn.id, gone.userId, eventId);
    const keptConn = await insertConnection(kept.userId);
    await insertLink(keptConn.id, kept.userId, eventId);

    await testApp.request
      .delete(`/users/${gone.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(await connectionsOf(gone.userId)).toHaveLength(0);
    expect(await linksOf(gone.userId)).toHaveLength(0);
    expect(await connectionsOf(kept.userId)).toHaveLength(1);
    expect(await linksOf(kept.userId)).toHaveLength(1);
  });

  it('deleting a connection cascades to its links only', async () => {
    const { userId } = await member('delconn');
    const eventId = await createFutureEvent(testApp, adminToken);
    const doomed = await insertConnection(userId);
    const survivor = await insertConnection(userId, { provider: 'apple' });
    await insertLink(doomed.id, userId, eventId);
    await insertLink(survivor.id, userId, eventId);

    await testApp.db
      .delete(schema.calendarConnections)
      .where(eq(schema.calendarConnections.id, doomed.id));

    const links = await linksOf(userId);
    expect(links.map((l) => l.connectionId)).toEqual([survivor.id]);
  });
});

describe('calendar_event_links.event_id — no FK (spec L272)', () => {
  it('deleting an event leaves its link row (no FK on event_id)', async () => {
    const { userId } = await member('delevent');
    const eventId = await createFutureEvent(testApp, adminToken);
    const conn = await insertConnection(userId);
    const link = await insertLink(conn.id, userId, eventId);

    const del = await testApp.request
      .delete(`/events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    const [event] = await testApp.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    expect(event).toBeUndefined();

    const links = await linksOf(userId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: link.id, eventId });
  });

  it('declares FKs on connection_id and user_id only', async () => {
    const rows = await testApp.db.execute<{ attname: string }>(sql`
      SELECT a.attname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'calendar_event_links'::regclass
        AND c.contype = 'f'
      ORDER BY a.attname
    `);
    expect(rows.map((r) => r.attname)).toEqual(['connection_id', 'user_id']);
  });
});
