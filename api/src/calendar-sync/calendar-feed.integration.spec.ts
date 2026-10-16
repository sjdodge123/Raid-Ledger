/**
 * ROK-1599 (epic ROK-669 §10 Story 9): the ICS subscribe feed end to end —
 * the owner routes, the public `cal/u/:file` route and the overview's
 * `feed.url`, against Postgres. Exercises the real SQL of `upsertFeedToken`,
 * `revokeFeed`, `loadFeedToken`, `findFeedUserByToken` and `loadFeedEntries`
 * (window overlap, bench, cancelled-event filter), which unit specs only mock.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createPastEvent,
} from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import { buildCopyId, deriveInstanceId } from './providers/rl-copy-id.helpers';

const FEED = '/users/me/calendars/feed';
const URL_SHAPE = /\/api\/cal\/u\/([A-Za-z0-9_-]{43})\.ics$/;
const DAY_MS = 24 * 60 * 60 * 1000;

let testApp: TestApp;
let settings: SettingsService;
let userId: number;
let token: string;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService);
});

beforeEach(async () => {
  await setCalendarSyncEnabled(settings, true);
  seq += 1;
  ({ userId, token } = await createMemberAndLogin(
    testApp,
    `cal-feed-${seq}`,
    `cal-feed-${seq}@example.test`,
  ));
});

afterEach(async () => {
  await setCalendarSyncEnabled(settings, false);
  testApp.seed = await truncateAllTables(testApp.db);
});

const authed = (req: ReturnType<TestApp['request']['get']>) =>
  req.set('Authorization', `Bearer ${token}`);

/** POST the feed (create or reset); returns the feed token from the url. */
async function issueFeed(): Promise<string> {
  const res = await authed(testApp.request.post(FEED));
  expect(res.status).toBe(200);
  const match = URL_SHAPE.exec(String(res.body.url));
  if (!match?.[1]) throw new Error(`feed url has no token: ${res.body.url}`);
  return match[1];
}

const fetchFeed = (feedToken: string) =>
  testApp.request.get(`/cal/u/${feedToken}.ics`);

/** RFC 5545 §3.1 unfold, so assertions never trip on a 75-octet fold. */
const unfold = (body: string) => body.replace(/\r\n[ \t]/g, '');

async function copyUid(eventId: number): Promise<string> {
  const host = new URL(await settings.getClientUrl()).host;
  return buildCopyId({ instanceId: deriveInstanceId(host), eventId, userId });
}

/** The VEVENT block carrying this event's copy id, or undefined. */
async function veventOf(body: string, eventId: number) {
  const uid = await copyUid(eventId);
  return unfold(body)
    .split('BEGIN:VEVENT')
    .slice(1)
    .find((block) => block.includes(`\r\nUID:${uid}\r\n`));
}

/** An event `offsetDays` from now (1h long) the member signed up to. */
async function signUp(
  title: string,
  status = 'signed_up',
  offsetDays = 1,
): Promise<number> {
  const start = new Date(Date.now() + offsetDays * DAY_MS);
  const end = new Date(start.getTime() + 3_600_000);
  const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id, {
    title,
    duration: [start, end] as [Date, Date],
  });
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, status, confirmationStatus: 'pending' });
  return eventId;
}

describe('ICS subscribe feed — content', () => {
  it('serves a confirmed sign-up as Busy, UID = the shared copy id', async () => {
    const eventId = await signUp('Raid Night');
    const res = await fetchFeed(await issueFeed());
    expect(res.status).toBe(200);
    const block = await veventOf(res.text, eventId);
    expect(block).toContain('\r\nSUMMARY:Raid Night\r\n');
    expect(block).toContain('\r\nTRANSP:OPAQUE\r\n');
    expect(block).toContain('\r\nSTATUS:CONFIRMED\r\n');
  });

  it('serves a tentative sign-up as "(Tentative) " + Free', async () => {
    const eventId = await signUp('Maybe Raid', 'tentative');
    const res = await fetchFeed(await issueFeed());
    const block = await veventOf(res.text, eventId);
    expect(block).toContain('\r\nSUMMARY:(Tentative) Maybe Raid\r\n');
    expect(block).toContain('\r\nTRANSP:TRANSPARENT\r\n');
    expect(block).toContain('\r\nSTATUS:TENTATIVE\r\n');
  });

  it('keeps the past 7 days, drops events outside the window', async () => {
    const recent = await signUp('Last Week', 'signed_up', -6);
    const old = await signUp('Too Old', 'signed_up', -10);
    const far = await signUp('Too Far', 'signed_up', 120);
    const res = await fetchFeed(await issueFeed());
    expect(await veventOf(res.text, recent)).toBeDefined();
    expect(await veventOf(res.text, old)).toBeUndefined();
    expect(await veventOf(res.text, far)).toBeUndefined();
  });

  it('drops a cancelled sign-up and a cancelled event', async () => {
    const declined = await signUp('Left', 'signed_up');
    const cancelled = await signUp('Called Off', 'signed_up');
    const kept = await signUp('Still On', 'signed_up');
    const feedToken = await issueFeed();
    const before = await fetchFeed(feedToken);
    expect(await veventOf(before.text, declined)).toBeDefined();
    expect(await veventOf(before.text, cancelled)).toBeDefined();
    await testApp.db
      .update(schema.eventSignups)
      .set({ status: 'declined' })
      .where(eq(schema.eventSignups.eventId, declined));
    await testApp.db
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, cancelled));
    const after = await fetchFeed(feedToken);
    expect(await veventOf(after.text, declined)).toBeUndefined();
    expect(await veventOf(after.text, cancelled)).toBeUndefined();
    expect(await veventOf(after.text, kept)).toBeDefined();
  });

  it('sends the calendar headers', async () => {
    const res = await fetchFeed(await issueFeed());
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['cache-control']).toBe('private, max-age=900');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="raid-ledger.ics"',
    );
    expect(unfold(res.text)).toContain(
      '\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n',
    );
  });
});

describe('ICS subscribe feed — link lifecycle', () => {
  it('GET returns the same url the POST issued; { feed: null } before', async () => {
    const none = await authed(testApp.request.get(FEED));
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ feed: null });
    const feedToken = await issueFeed();
    const res = await authed(testApp.request.get(FEED));
    expect(res.body).toEqual({
      feed: {
        url: expect.stringMatching(
          new RegExp(`/api/cal/u/${feedToken}\\.ics$`),
        ),
      },
    });
  });

  it.each([
    ['banned', { bannedAt: new Date() }],
    ['deactivated', { deactivatedAt: new Date() }],
  ])(
    "a %s owner's link 404s; lifting it restores the same link",
    async (_, set) => {
      const feedToken = await issueFeed();
      await testApp.db
        .update(schema.users)
        .set(set)
        .where(eq(schema.users.id, userId));
      expect((await fetchFeed(feedToken)).status).toBe(404);
      await testApp.db
        .update(schema.users)
        .set({ bannedAt: null, deactivatedAt: null })
        .where(eq(schema.users.id, userId));
      expect((await fetchFeed(feedToken)).status).toBe(200);
    },
  );

  it('reset kills the old link at once; the new one serves', async () => {
    const oldToken = await issueFeed();
    const newToken = await issueFeed();
    expect(newToken).not.toBe(oldToken);
    expect((await fetchFeed(oldToken)).status).toBe(404);
    expect((await fetchFeed(newToken)).status).toBe(200);
  });

  it('DELETE answers 204 (not the :id route) and the link 404s', async () => {
    const feedToken = await issueFeed();
    const res = await authed(testApp.request.delete(FEED));
    expect(res.status).toBe(204);
    expect((await fetchFeed(feedToken)).status).toBe(404);
  });

  it('overview carries feed.url once a link exists', async () => {
    const before = await authed(testApp.request.get('/users/me/calendars'));
    expect(before.body.feed).toBeNull();
    const feedToken = await issueFeed();
    const after = await authed(testApp.request.get('/users/me/calendars'));
    expect(after.body.feed).toEqual({
      url: expect.stringMatching(new RegExp(`/api/cal/u/${feedToken}\\.ics$`)),
    });
  });

  it('kill switch off: public link and owner routes all 404', async () => {
    const feedToken = await issueFeed();
    await setCalendarSyncEnabled(settings, false);
    expect((await fetchFeed(feedToken)).status).toBe(404);
    expect((await authed(testApp.request.get(FEED))).status).toBe(404);
    expect((await authed(testApp.request.post(FEED))).status).toBe(404);
    expect((await authed(testApp.request.delete(FEED))).status).toBe(404);
    const overview = await authed(testApp.request.get('/users/me/calendars'));
    expect(overview.body.feed).toBeNull();
  });

  it.each([
    ['too short', 'abc.ics'],
    ['no extension', 'A'.repeat(43)],
    ['wrong extension', `${'A'.repeat(43)}.txt`],
    ['unknown token', `${'A'.repeat(43)}.ics`],
  ])('404s a %s file name', async (_label, file) => {
    await issueFeed();
    const res = await testApp.request.get(`/cal/u/${file}`);
    expect(res.status).toBe(404);
    // Codex r3 minor: a miss is never cached and never looks like a calendar.
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type'] ?? '').not.toContain('text/calendar');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('owner routes need a session', async () => {
    expect((await testApp.request.post(FEED)).status).toBe(401);
  });
});
