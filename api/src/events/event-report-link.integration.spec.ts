/**
 * ROK-1725 — PATCH /events/:id/report-link against a real DB: the organiser
 * (creator) or an operator/admin sets, reads back and clears one allow-listed
 * log report URL per occurrence; anyone else is refused; a bad URL is a 400;
 * a cancelled event is a 409; and the write emits NO `event.updated`, so no
 * embed redraw, Discord Scheduled Event or calendar sync is triggered.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { defined } from '../common/testing/narrow';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';

let testApp: TestApp;
let emitSpy: jest.SpyInstance | undefined;
const HOUR = 3600_000;
const WCL = 'https://classic.warcraftlogs.com/reports/AbC123';

interface EventOpts {
  ended?: boolean;
  cancelled?: boolean;
  groupId?: string;
}

async function createEvent(creatorId: number, opts: EventOpts = {}) {
  const start = Date.now() + (opts.ended ? -3 * HOUR : HOUR);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Report link raid',
      creatorId,
      duration: [new Date(start), new Date(start + HOUR)],
      cancelledAt: opts.cancelled ? new Date() : null,
      recurrenceGroupId: opts.groupId ?? null,
    })
    .returning();
  return defined(event, 'event').id;
}

interface MemberOpts {
  role?: 'member' | 'operator';
  deactivatedAt?: Date;
}

async function createMember(username: string, opts: MemberOpts = {}) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${username}@test.local`,
      username,
      role: opts.role ?? 'member',
      deactivatedAt: opts.deactivatedAt ?? null,
    })
    .returning();
  const member = defined(user, username);
  const token = await signTestAccessToken(testApp, {
    sub: member.id,
    username: member.username,
  });
  return { id: member.id, token };
}

const patchLink = (eventId: number, token: string, body: object) =>
  testApp.request
    .patch(`/events/${eventId}/report-link`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

async function storedUrl(eventId: number): Promise<string | null> {
  const [row] = await testApp.db
    .select({ reportUrl: schema.events.reportUrl })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return defined(row, 'event row').reportUrl;
}

describe('PATCH /events/:id/report-link (ROK-1725)', () => {
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  afterEach(async () => {
    emitSpy?.mockRestore();
    emitSpy = undefined;
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('creator sets a link (normalised), reads it back, then clears it', async () => {
    const m = await createMember('rl-creator');
    const eventId = await createEvent(m.id);
    const set = await patchLink(eventId, m.token, {
      reportUrl: 'https://CLASSIC.WarcraftLogs.com/reports/AbC123',
    });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ id: eventId, reportUrl: WCL });
    const read = await testApp.request
      .get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${m.token}`);
    expect(read.body.reportUrl).toBe(WCL);
    const cleared = await patchLink(eventId, m.token, { reportUrl: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.reportUrl).toBeNull();
    expect(await storedUrl(eventId)).toBeNull();
  });

  it('an admin may set the link on someone else’s event', async () => {
    const m = await createMember('rl-owner');
    const eventId = await createEvent(m.id);
    const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    const res = await patchLink(eventId, adminToken, { reportUrl: WCL });
    expect(res.status).toBe(200);
    expect(await storedUrl(eventId)).toBe(WCL);
  });

  it('an operator may set the link on someone else’s event', async () => {
    const owner = await createMember('rl-owner-op');
    const operator = await createMember('rl-operator', { role: 'operator' });
    const eventId = await createEvent(owner.id);
    const res = await patchLink(eventId, operator.token, { reportUrl: WCL });
    expect(res.status).toBe(200);
    expect(await storedUrl(eventId)).toBe(WCL);
  });

  // The JWT strategy's lockout (ROK-1753) answers 401 before the route's
  // NotDeactivatedGuard (403) is reached; the guard stays as defence in depth.
  it('a deactivated organiser is refused (401 USER_DEACTIVATED) and nothing is written', async () => {
    const m = await createMember('rl-deactivated', {
      deactivatedAt: new Date(),
    });
    const eventId = await createEvent(m.id);
    const res = await patchLink(eventId, m.token, { reportUrl: WCL });
    expect({ status: res.status, code: res.body.code }).toEqual({
      status: 401,
      code: 'USER_DEACTIVATED',
    });
    expect(await storedUrl(eventId)).toBeNull();
  });

  it('another member is refused with 403 and nothing is written', async () => {
    const m = await createMember('rl-owner2');
    const other = await createMember('rl-other');
    const eventId = await createEvent(m.id);
    const res = await patchLink(eventId, other.token, { reportUrl: WCL });
    expect({ status: res.status, message: res.body.message }).toEqual({
      status: 403,
      message: 'You can only update your own events',
    });
    expect(await storedUrl(eventId)).toBeNull();
  });

  it('rejects a non-allow-listed URL with 400 and its message', async () => {
    const m = await createMember('rl-bad');
    const eventId = await createEvent(m.id);
    const res = await patchLink(eventId, m.token, {
      reportUrl: 'https://evil.com/reports/x',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      'reportUrl: Only Warcraft Logs and foreverlogs.gg report links are accepted',
    ]);
    expect(await storedUrl(eventId)).toBeNull();
  });

  it('404s for a missing event and 401s without a token', async () => {
    const m = await createMember('rl-404');
    const missing = await patchLink(999999, m.token, { reportUrl: WCL });
    expect(missing.status).toBe(404);
    const anon = await testApp.request
      .patch('/events/1/report-link')
      .send({ reportUrl: WCL });
    expect(anon.status).toBe(401);
  });

  it('a finished event is editable; a cancelled one is a 409', async () => {
    const m = await createMember('rl-when');
    const ended = await createEvent(m.id, { ended: true });
    expect((await patchLink(ended, m.token, { reportUrl: WCL })).status).toBe(
      200,
    );
    const cancelled = await createEvent(m.id, { cancelled: true });
    const res = await patchLink(cancelled, m.token, { reportUrl: WCL });
    expect(res.status).toBe(409);
    expect(await storedUrl(cancelled)).toBeNull();
  });

  it('sets only the targeted occurrence of a series', async () => {
    const m = await createMember('rl-series');
    const groupId = '0b2f5a8e-1725-4c1e-9d3a-000000001725';
    const ids = [
      await createEvent(m.id, { groupId }),
      await createEvent(m.id, { groupId }),
      await createEvent(m.id, { groupId }),
    ];
    const target = defined(ids[1], 'occurrence 2');
    expect((await patchLink(target, m.token, { reportUrl: WCL })).status).toBe(
      200,
    );
    const stored = await Promise.all(ids.map((id) => storedUrl(id)));
    expect(stored).toEqual([null, WCL, null]);
  });

  it('emits no event.updated (no embed / scheduled-event / calendar sync)', async () => {
    const m = await createMember('rl-quiet');
    const eventId = await createEvent(m.id);
    emitSpy = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');
    expect((await patchLink(eventId, m.token, { reportUrl: WCL })).status).toBe(
      200,
    );
    const updated = emitSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === APP_EVENT_EVENTS.UPDATED,
    );
    expect(updated).toEqual([]);
  });
});
