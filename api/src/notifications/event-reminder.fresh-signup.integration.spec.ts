/**
 * Fresh-signup reminder skip (ROK-2293) — integration tests.
 *
 * A recipient whose signup became active less than
 * REMINDER_FRESH_SIGNUP_GRACE_MS ago gets no DM for the window being
 * dispatched, but that window's dedup row is still claimed. `activated_at` is
 * re-stamped when an inactive signup becomes active again, and kept on a
 * tentative <-> signed_up flip. Time is controlled by writing `activated_at`
 * and event start directly, and by passing an explicit `now` to the pass.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { EventReminderService } from './event-reminder.service';
import { fetchCandidateEvents } from './event-reminder.helpers';
import { REMINDER_FRESH_SIGNUP_GRACE_MS } from './event-reminder.constants';
import { SignupsService } from '../events/signups.service';
import type { SignupStatus } from '../drizzle/schema/event-signups';
import { nonEmpty } from '../common/testing/narrow';

const MINUTE = 60_000;
const GRACE = REMINDER_FRESH_SIGNUP_GRACE_MS;
/** Event start that only the 24-hour window matches. */
const ONLY_24H_WINDOW = 20 * 60 * MINUTE;

interface Ctx {
  testApp: TestApp;
  reminders: EventReminderService;
  signups: SignupsService;
}

async function createUser(testApp: TestApp, username: string) {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${username}@test.local`,
        username,
        role: 'member',
      })
      .returning(),
    'inserted user',
  );
  return user;
}

async function createEvent(
  testApp: TestApp,
  creatorId: number,
  title: string,
  startOffsetMs: number,
) {
  const start = new Date(Date.now() + startOffsetMs);
  const end = new Date(start.getTime() + 3 * 60 * MINUTE);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title,
        creatorId,
        duration: [start, end] as [Date, Date],
        reminder15min: true,
        reminder1hour: true,
        reminder24hour: true,
      })
      .returning(),
    'inserted event',
  );
  return event;
}

/** Insert a signup whose `activated_at` is `activatedAgoMs` before now. */
async function insertSignup(
  testApp: TestApp,
  eventId: number,
  userId: number,
  activatedAgoMs: number,
  status: SignupStatus = 'signed_up',
) {
  const activatedAt = new Date(Date.now() - activatedAgoMs);
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, status, activatedAt });
  return activatedAt;
}

async function readSignup(testApp: TestApp, eventId: number, userId: number) {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      ),
    'signup row',
  );
  return row;
}

async function backdateActivation(
  testApp: TestApp,
  eventId: number,
  userId: number,
  agoMs: number,
) {
  const activatedAt = new Date(Date.now() - agoMs);
  await testApp.db
    .update(schema.eventSignups)
    .set({ activatedAt })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return activatedAt;
}

/** Run one cron pass as if the clock read `now`. */
async function dispatchAt(ctx: Ctx, now: Date) {
  const candidates = await fetchCandidateEvents(ctx.testApp.db, now);
  await ctx.reminders['dispatchReminderWindows'](candidates, now, 'UTC');
}

async function reminderDms(testApp: TestApp, userId: number) {
  return testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
}

async function claimedWindows(testApp: TestApp, userId: number) {
  const rows = await testApp.db
    .select()
    .from(schema.eventRemindersSent)
    .where(eq(schema.eventRemindersSent.userId, userId));
  return rows.map((r) => r.reminderType).sort();
}

/** `activated_at` landed within a minute of the real clock. */
function expectStampedNow(activatedAt: Date) {
  expect(Math.abs(activatedAt.getTime() - Date.now())).toBeLessThan(MINUTE);
}

function describeFreshWindowSkip(get: () => Ctx) {
  it('a signup activated < 15 min ago gets no DM and the window is claimed', async () => {
    const { testApp } = get();
    const member = await createUser(testApp, 'fresh-member');
    const event = await createEvent(
      testApp,
      testApp.seed.adminUser.id,
      'Fresh',
      ONLY_24H_WINDOW,
    );
    await insertSignup(testApp, event.id, member.id, 2 * MINUTE);

    await dispatchAt(get(), new Date());

    expect(await reminderDms(testApp, member.id)).toHaveLength(0);
    expect(await claimedWindows(testApp, member.id)).toEqual(['24hour']);
  });

  it('the same member gets the next window once 15 min have passed', async () => {
    const { testApp } = get();
    const member = await createUser(testApp, 'later-window');
    const event = await createEvent(
      testApp,
      testApp.seed.adminUser.id,
      'Later',
      70 * MINUTE,
    );
    await insertSignup(testApp, event.id, member.id, 0);

    await dispatchAt(get(), new Date());
    expect(await reminderDms(testApp, member.id)).toHaveLength(0);
    expect(await claimedWindows(testApp, member.id)).toEqual(['24hour']);

    // 16 minutes later the event is 54 min out: the 1-hour window fires.
    await dispatchAt(get(), new Date(Date.now() + GRACE + MINUTE));
    const dms = await reminderDms(testApp, member.id);
    expect(dms).toHaveLength(1);
    expect(dms[0]?.type).toBe('event_reminder');
    expect(await claimedWindows(testApp, member.id)).toEqual([
      '1hour',
      '24hour',
    ]);
  });

  it('a signup activated >= 15 min ago gets the DM', async () => {
    const { testApp } = get();
    const member = await createUser(testApp, 'settled-member');
    const event = await createEvent(
      testApp,
      testApp.seed.adminUser.id,
      'Settled',
      ONLY_24H_WINDOW,
    );
    await insertSignup(testApp, event.id, member.id, GRACE + MINUTE);

    await dispatchAt(get(), new Date());

    expect(await reminderDms(testApp, member.id)).toHaveLength(1);
    expect(await claimedWindows(testApp, member.id)).toEqual(['24hour']);
  });
}

function describeResignupRestartsClock(get: () => Ctx) {
  it('cancel then re-signup via SignupsService re-stamps activated_at and skips the DM', async () => {
    const { testApp, signups } = get();
    const member = await createUser(testApp, 'cancel-resignup');
    const event = await createEvent(
      testApp,
      testApp.seed.adminUser.id,
      'Resignup',
      ONLY_24H_WINDOW,
    );
    const original = await insertSignup(
      testApp,
      event.id,
      member.id,
      60 * MINUTE,
    );

    await signups.cancel(event.id, member.id);
    const cancelled = await readSignup(testApp, event.id, member.id);
    expect(['declined', 'roached_out']).toContain(cancelled.status);

    await signups.signup(event.id, member.id);
    const reactivated = await readSignup(testApp, event.id, member.id);
    expect(reactivated.status).toBe('signed_up');
    expect(reactivated.activatedAt.getTime()).toBeGreaterThan(
      original.getTime(),
    );
    expectStampedNow(reactivated.activatedAt);

    await dispatchAt(get(), new Date());
    expect(await reminderDms(testApp, member.id)).toHaveLength(0);
    expect(await claimedWindows(testApp, member.id)).toEqual(['24hour']);
  });

  it.each<SignupStatus>(['declined', 'roached_out'])(
    'a %s signup re-signed up through SignupsService restarts the 15-minute clock',
    async (inactive) => {
      const { testApp, signups } = get();
      const member = await createUser(testApp, `resignup-${inactive}`);
      const event = await createEvent(
        testApp,
        testApp.seed.adminUser.id,
        `From ${inactive}`,
        ONLY_24H_WINDOW,
      );
      const original = await insertSignup(
        testApp,
        event.id,
        member.id,
        60 * MINUTE,
        inactive,
      );

      await signups.signup(event.id, member.id);
      const row = await readSignup(testApp, event.id, member.id);
      expect(row.status).toBe('signed_up');
      expect(row.activatedAt.getTime()).toBeGreaterThan(original.getTime());
      expectStampedNow(row.activatedAt);

      await dispatchAt(get(), new Date());
      expect(await reminderDms(testApp, member.id)).toHaveLength(0);
      expect(await claimedWindows(testApp, member.id)).toEqual(['24hour']);
    },
  );
}

function describeStatusFlips(get: () => Ctx) {
  it('a tentative <-> signed_up flip keeps activated_at and the DM is sent', async () => {
    const { testApp, signups } = get();
    const member = await createUser(testApp, 'flip-member');
    const event = await createEvent(
      testApp,
      testApp.seed.adminUser.id,
      'Flip',
      ONLY_24H_WINDOW,
    );
    const original = await insertSignup(
      testApp,
      event.id,
      member.id,
      30 * MINUTE,
    );

    await signups.updateStatus(
      event.id,
      { userId: member.id },
      { status: 'tentative' },
    );
    const tentative = await readSignup(testApp, event.id, member.id);
    expect(tentative.status).toBe('tentative');
    expect(tentative.activatedAt.getTime()).toBe(original.getTime());

    await signups.updateStatus(
      event.id,
      { userId: member.id },
      { status: 'signed_up' },
    );
    const back = await readSignup(testApp, event.id, member.id);
    expect(back.status).toBe('signed_up');
    expect(back.activatedAt.getTime()).toBe(original.getTime());

    await dispatchAt(get(), new Date());
    expect(await reminderDms(testApp, member.id)).toHaveLength(1);
  });
}

function describeStatusReactivation(get: () => Ctx) {
  it('updateStatus declined -> signed_up does re-stamp activated_at', async () => {
    const { testApp, signups } = get();
    const member = await createUser(testApp, 'declined-flip');
    const event = await createEvent(
      testApp,
      testApp.seed.adminUser.id,
      'Declined flip',
      ONLY_24H_WINDOW,
    );
    await insertSignup(testApp, event.id, member.id, 60 * MINUTE);
    await signups.updateStatus(
      event.id,
      { userId: member.id },
      { status: 'declined' },
    );
    const original = await backdateActivation(
      testApp,
      event.id,
      member.id,
      60 * MINUTE,
    );

    await signups.updateStatus(
      event.id,
      { userId: member.id },
      { status: 'signed_up' },
    );
    const row = await readSignup(testApp, event.id, member.id);
    expect(row.activatedAt.getTime()).toBeGreaterThan(original.getTime());
    expectStampedNow(row.activatedAt);
  });
}

function describeHosts(get: () => Ctx) {
  it('a host with no signup still gets the DM', async () => {
    const { testApp } = get();
    const host = await createUser(testApp, 'host-only');
    await createEvent(testApp, host.id, 'Host only', ONLY_24H_WINDOW);

    await dispatchAt(get(), new Date());

    expect(await reminderDms(testApp, host.id)).toHaveLength(1);
    expect(await claimedWindows(testApp, host.id)).toEqual(['24hour']);
  });

  it('a host whose own signup is fresh is skipped but the window is claimed', async () => {
    const { testApp } = get();
    const host = await createUser(testApp, 'host-fresh');
    const event = await createEvent(
      testApp,
      host.id,
      'Host fresh',
      ONLY_24H_WINDOW,
    );
    await insertSignup(testApp, event.id, host.id, 2 * MINUTE);

    await dispatchAt(get(), new Date());

    expect(await reminderDms(testApp, host.id)).toHaveLength(0);
    expect(await claimedWindows(testApp, host.id)).toEqual(['24hour']);
  });
}

function describeFreshSignupReminders() {
  let ctx: Ctx;
  const get = () => ctx;

  beforeAll(async () => {
    const testApp = await getTestApp();
    ctx = {
      testApp,
      reminders: testApp.app.get(EventReminderService),
      signups: testApp.app.get(SignupsService),
    };
  });

  afterEach(async () => {
    ctx.testApp.seed = await truncateAllTables(ctx.testApp.db);
  });

  describe('fresh signup window skip', () => describeFreshWindowSkip(get));
  describe('re-signup restarts the clock', () =>
    describeResignupRestartsClock(get));
  describe('status flips', () => describeStatusFlips(get));
  describe('status reactivation', () => describeStatusReactivation(get));
  describe('hosts', () => describeHosts(get));
}
describe('Event reminder fresh-signup skip (integration, ROK-2293)', () =>
  describeFreshSignupReminders());
