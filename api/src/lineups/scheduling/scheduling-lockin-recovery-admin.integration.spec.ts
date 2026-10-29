/**
 * ROK-2033 — the recovery cron and the admin reopen route against a real DB.
 *
 * The admin route is admin-only (member/operator 403), 409s when there is no
 * unlinked claim (an open poll, a locked-in event deleted on purpose, a
 * reschedule claim), and otherwise reopens the poll and deletes the claim's
 * orphaned events. The cron recovers a stale claim, leaves a young one, and
 * never selects a reschedule claim (unstamped, ROK-2040).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { EventsService } from '../../events/events.service';
import { claimMatchForLockIn } from './scheduling-lockin-claim.helpers';
import { SchedulingLockInRecoveryService } from './scheduling-lockin-recovery.service';

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
const MINUTE = 60_000;
const m = schema.communityLineupMatches;
const NOTHING = 'This poll has no unfinished lock-in to reopen';

function eventDto() {
  return {
    title: 'Lock-in recovery admin',
    startTime: SLOT.toISOString(),
    endTime: SLOT_END.toISOString(),
    gameId: testApp.seed.game.id,
    slotConfig: { type: 'generic' as const, player: 5 },
    maxAttendees: 5,
  };
}

async function openPoll(): Promise<number> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(res.status).toBe(201);
  const matchId: number = res.body.id;
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime: SLOT, suggestedBy: 'user' })
      .returning(),
    'slot',
  );
  await testApp.db.insert(schema.communityLineupScheduleVotes).values({
    userId: testApp.seed.adminUser.id,
    slotId: slot.id,
    stance: 'yes',
  });
  return matchId;
}

async function createEvent(matchId: number): Promise<number> {
  const ev = await testApp.app
    .get(EventsService)
    .create(testApp.seed.adminUser.id, {
      ...eventDto(),
      schedulingMatchId: matchId,
    });
  return ev.id;
}

async function matchRow(matchId: number) {
  const [row] = await testApp.db
    .select({
      status: m.status,
      linkedEventId: m.linkedEventId,
      lockInClaimedAt: m.lockInClaimedAt,
      lineupId: m.lineupId,
    })
    .from(m)
    .where(eq(m.id, matchId));
  return must(row, 'match row');
}

async function eventExists(eventId: number): Promise<boolean> {
  const rows = await testApp.db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return rows.length === 1;
}

/** Claim, then age the stamp by `ageMin` minutes (the simulated crash). */
async function crashedClaim(matchId: number, ageMin = 11): Promise<void> {
  await claimMatchForLockIn(testApp.db, matchId);
  await testApp.db
    .update(m)
    .set({ lockInClaimedAt: new Date(Date.now() - ageMin * MINUTE) })
    .where(eq(m.id, matchId));
}

function reopen(matchId: number, token: string = adminToken) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/reopen-lock-in`)
    .set('Authorization', `Bearer ${token}`)
    .send();
}

async function loginAs(role: 'member' | 'operator'): Promise<string> {
  const bcrypt = await import('bcrypt');
  const password = 'RecoveryPass1!';
  const email = `${role}-2033@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: `${role}2033`, role })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash(password, 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password });
  return must(res.body.access_token as string | undefined, 'token');
}

const sweep = (now?: Date) =>
  testApp.app.get(SchedulingLockInRecoveryService).runSweep(now);

describe('admin reopen-lock-in route (ROK-2033)', () => {
  it('refuses a member and an operator with 403 and leaves the claim', async () => {
    const matchId = await openPoll();
    await crashedClaim(matchId);
    for (const role of ['member', 'operator'] as const) {
      const res = await reopen(matchId, await loginAs(role));
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
    }
    const row = await matchRow(matchId);
    expect(row.status).toBe('scheduled');
    expect(row.lockInClaimedAt).not.toBeNull();
  });

  it('409s an open poll with no claim', async () => {
    const matchId = await openPoll();
    const res = await reopen(matchId);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(NOTHING);
  });

  it('404s a missing match', async () => {
    expect((await reopen(999_999)).status).toBe(404);
  });

  it('reopens a stalled claim, deletes its orphan and flips the page flag', async () => {
    const matchId = await openPoll();
    await crashedClaim(matchId, 1);
    const eventId = await createEvent(matchId);
    const { lineupId } = await matchRow(matchId);
    const page = () =>
      testApp.request
        .get(`/lineups/${lineupId}/schedule/${matchId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    expect((await page()).body.lockInRecoverable).toBe(true);

    const res = await reopen(matchId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      matchId,
      status: 'scheduling',
      discardedEventIds: [eventId],
    });
    expect(await matchRow(matchId)).toMatchObject({
      status: 'scheduling',
      linkedEventId: null,
      lockInClaimedAt: null,
    });
    expect(await eventExists(eventId)).toBe(false);
    expect((await page()).body).not.toHaveProperty('lockInRecoverable');
  });

  it('never reopens a locked-in event deleted on purpose', async () => {
    const matchId = await openPoll();
    const lock = await testApp.request
      .post(`/scheduling-polls/${matchId}/lock-in`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event: eventDto(), startTime: SLOT.toISOString() });
    expect(lock.status).toBe(200);
    const eventId: number = lock.body.event.id;
    await testApp.app
      .get(EventsService)
      .delete(eventId, testApp.seed.adminUser.id, true);
    const before = await matchRow(matchId);
    expect(before).toMatchObject({
      linkedEventId: null,
      lockInClaimedAt: null,
    });

    const res = await reopen(matchId);

    expect(res.status).toBe(409);
    expect(await sweep(new Date(Date.now() + 24 * 60 * MINUTE))).toBe(false);
    expect(await matchRow(matchId)).toEqual(before);
  });
});

describe('lock-in recovery cron (ROK-2033)', () => {
  it('recovers a stale claim and leaves a young one', async () => {
    const stale = await openPoll();
    await crashedClaim(stale, 11);
    const young = await openPoll();
    await crashedClaim(young, 2);

    expect(await sweep()).toBeUndefined();

    expect((await matchRow(stale)).status).toBe('scheduling');
    expect(await matchRow(young)).toMatchObject({ status: 'scheduled' });
    expect((await matchRow(young)).lockInClaimedAt).not.toBeNull();
  });

  it('never touches a reschedule claim (unstamped, poll already linked)', async () => {
    const matchId = await openPoll();
    const eventId = await createEvent(matchId);
    await testApp.db
      .update(m)
      .set({ linkedEventId: eventId })
      .where(eq(m.id, matchId));
    await claimMatchForLockIn(testApp.db, matchId, ['scheduling'], eventId);
    const before = await matchRow(matchId);
    expect(before.lockInClaimedAt).toBeNull();

    expect(await sweep(new Date(Date.now() + 24 * 60 * MINUTE))).toBe(false);
    expect((await reopen(matchId)).status).toBe(409);

    expect(await matchRow(matchId)).toEqual(before);
    expect(await eventExists(eventId)).toBe(true);
  });
});

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`missing ${label}`);
  return value;
}
