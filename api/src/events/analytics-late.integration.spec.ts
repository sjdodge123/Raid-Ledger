/**
 * Late reliability metric — integration tests (ROK-1938)
 *
 * Proves `lateCount` (GET /analytics/attendance/users) and `avgLateRate`
 * (GET /analytics/attendance/games) against a real PostgreSQL database:
 * late = attended signup + a `late` voice session, at most once per signup.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createPastEvent } from './signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { classifyEventSessions } from '../discord-bot/services/voice-attendance-classify.helpers';
import { autoPopulateAttendance } from '../discord-bot/services/voice-attendance-populate.helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ── Helpers (copied in style from analytics.integration.spec.ts) ──

type UserRow = {
  userId: number;
  totalEvents: number;
  attended: number;
  noShow: number;
  lateCount: number;
  attendanceRate: number;
};
type GameRowBody = {
  gameId: number;
  totalSignups: number;
  avgAttendanceRate: number;
  avgNoShowRate: number;
  avgLateRate: number;
};

const HOUR_MS = 60 * 60 * 1000;
const silentLogger = { log: () => {}, warn: () => {} };

/** Insert a user with a Discord id; returns the user id. */
async function insertUser(username: string, discordId: string | null) {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username, discordId })
      .returning(),
    `user ${username}`,
  );
  return u.id;
}

/** Create a 2 h past event on the seeded game; returns id + start. */
async function insertTwoHourEvent() {
  const start = new Date(Date.now() - 48 * HOUR_MS);
  const end = new Date(start.getTime() + 2 * HOUR_MS);
  const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id, {
    gameId: testApp.seed.game.id,
    duration: [start, end] as [Date, Date],
  });
  return { eventId, start };
}

/** Insert an event signup (attendance status may be null). */
async function insertSignup(
  eventId: number,
  userId: number,
  discordUserId: string | null,
  attendanceStatus: string | null,
) {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    discordUserId,
    discordUsername: discordUserId ? `du-${discordUserId}` : null,
    attendanceStatus,
    attendanceRecordedAt: attendanceStatus ? new Date() : null,
  });
}

/** Insert a voice session row. */
async function insertVoice(opts: {
  eventId: number;
  userId: number | null;
  discordUserId: string;
  joinAt: Date;
  durationSec: number;
  classification: string | null;
}) {
  const leave = new Date(opts.joinAt.getTime() + opts.durationSec * 1000);
  await testApp.db.insert(schema.eventVoiceSessions).values({
    eventId: opts.eventId,
    userId: opts.userId,
    discordUserId: opts.discordUserId,
    discordUsername: `vu-${opts.discordUserId}`,
    firstJoinAt: opts.joinAt,
    lastLeaveAt: leave,
    totalDurationSec: opts.durationSec,
    segments: [
      {
        joinAt: opts.joinAt.toISOString(),
        leaveAt: leave.toISOString(),
        durationSec: opts.durationSec,
      },
    ],
    classification: opts.classification,
  });
}

async function fetchUsers(): Promise<UserRow[]> {
  const res = await testApp.request
    .get('/analytics/attendance/users')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body.users as UserRow[];
}

async function fetchGame(): Promise<GameRowBody> {
  const res = await testApp.request
    .get('/analytics/attendance/games')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const games = res.body.games as GameRowBody[];
  const g = games.find((x) => x.gameId === testApp.seed.game.id);
  if (!g) throw new Error(`game ${testApp.seed.game.id} missing from body`);
  return g;
}

function userRow(users: UserRow[], userId: number): UserRow {
  const row = users.find((u) => u.userId === userId);
  if (!row) throw new Error(`user ${userId} missing from reliability body`);
  return row;
}

async function storedVoiceClass(eventId: number, discordUserId: string) {
  const [row] = await testApp.db
    .select({ c: schema.eventVoiceSessions.classification })
    .from(schema.eventVoiceSessions)
    .where(
      and(
        eq(schema.eventVoiceSessions.eventId, eventId),
        eq(schema.eventVoiceSessions.discordUserId, discordUserId),
      ),
    );
  return row?.c ?? null;
}

async function storedAttendance(eventId: number, userId: number) {
  const [row] = await testApp.db
    .select({ s: schema.eventSignups.attendanceStatus })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return row?.s ?? null;
}

// ── Tests ────────────────────────────────────────────────────

async function seedPipelineEvent() {
  const { eventId, start } = await insertTwoHourEvent();
  const a = await insertUser('late-a', 'd-late-a');
  const b = await insertUser('full-b', 'd-full-b');
  const c = await insertUser('noshow-c', 'd-noshow-c');
  await insertSignup(eventId, a, 'd-late-a', null);
  await insertSignup(eventId, b, 'd-full-b', null);
  await insertSignup(eventId, c, 'd-noshow-c', null);
  const joinA = new Date(start.getTime() + 30 * 60_000);
  await insertVoice({
    eventId,
    userId: a,
    discordUserId: 'd-late-a',
    joinAt: joinA,
    durationSec: 4800,
    classification: null,
  });
  await insertVoice({
    eventId,
    userId: b,
    discordUserId: 'd-full-b',
    joinAt: start,
    durationSec: 7200,
    classification: null,
  });
  await classifyEventSessions(
    testApp.db,
    eventId,
    undefined,
    5 * 60_000,
    silentLogger,
  );
  await autoPopulateAttendance(testApp.db, eventId, silentLogger);
  return { eventId, a, b, c };
}

async function testPipelineLateFullNoShow() {
  const { eventId, a, b, c } = await seedPipelineEvent();

  expect(await storedVoiceClass(eventId, 'd-late-a')).toBe('late');
  expect(await storedVoiceClass(eventId, 'd-full-b')).toBe('full');
  expect(await storedVoiceClass(eventId, 'd-noshow-c')).toBe('no_show');
  expect(await storedAttendance(eventId, a)).toBe('attended');
  expect(await storedAttendance(eventId, b)).toBe('attended');
  expect(await storedAttendance(eventId, c)).toBe('no_show');

  const users = await fetchUsers();
  expect(userRow(users, a)).toMatchObject({
    lateCount: 1,
    attended: 1,
    attendanceRate: 1,
  });
  expect(userRow(users, b)).toMatchObject({ lateCount: 0, attendanceRate: 1 });
  expect(userRow(users, c)).toMatchObject({
    lateCount: 0,
    noShow: 1,
    attendanceRate: 0,
  });

  expect(await fetchGame()).toMatchObject({
    totalSignups: 3,
    avgAttendanceRate: 0.67,
    avgLateRate: 0.33,
    avgNoShowRate: 0.33,
  });
}

async function testManualNoShowBeatsLateVoice() {
  const { eventId, start } = await insertTwoHourEvent();
  const u = await insertUser('manual-noshow', 'd-manual');
  await insertSignup(eventId, u, 'd-manual', 'no_show');
  await insertVoice({
    eventId,
    userId: u,
    discordUserId: 'd-manual',
    joinAt: new Date(start.getTime() + 30 * 60_000),
    durationSec: 4800,
    classification: 'late',
  });

  expect(userRow(await fetchUsers(), u)).toMatchObject({
    lateCount: 0,
    noShow: 1,
  });
  expect(await fetchGame()).toMatchObject({ avgLateRate: 0, avgNoShowRate: 1 });
}

async function testUserIdOnlySignupMatches() {
  const { eventId, start } = await insertTwoHourEvent();
  const u = await insertUser('uid-only', null);
  await insertSignup(eventId, u, null, 'attended');
  await insertVoice({
    eventId,
    userId: u,
    discordUserId: 'd-unlinked',
    joinAt: new Date(start.getTime() + 30 * 60_000),
    durationSec: 4800,
    classification: 'late',
  });

  expect(userRow(await fetchUsers(), u)).toMatchObject({
    lateCount: 1,
    attended: 1,
  });
}

async function testTwoLateRowsCountOnce() {
  const { eventId, start } = await insertTwoHourEvent();
  const u = await insertUser('double', 'd-one');
  await insertSignup(eventId, u, 'd-one', 'attended');
  const joinAt = new Date(start.getTime() + 30 * 60_000);
  await insertVoice({
    eventId,
    userId: u,
    discordUserId: 'd-one',
    joinAt,
    durationSec: 4800,
    classification: 'late',
  });
  await insertVoice({
    eventId,
    userId: u,
    discordUserId: 'd-two',
    joinAt,
    durationSec: 3600,
    classification: 'late',
  });

  expect(userRow(await fetchUsers(), u)).toMatchObject({
    lateCount: 1,
    totalEvents: 1,
    attended: 1,
  });
  expect(await fetchGame()).toMatchObject({ totalSignups: 1, avgLateRate: 1 });
}

async function testNoVoiceDataIsOnTime() {
  const { eventId } = await insertTwoHourEvent();
  const on = await insertUser('no-voice-attended', 'd-nv-1');
  const off = await insertUser('no-voice-noshow', 'd-nv-2');
  await insertSignup(eventId, on, 'd-nv-1', 'attended');
  await insertSignup(eventId, off, 'd-nv-2', 'no_show');

  expect(userRow(await fetchUsers(), on)).toMatchObject({
    lateCount: 0,
    attended: 1,
    attendanceRate: 1,
  });
  expect(await fetchGame()).toMatchObject({
    totalSignups: 2,
    avgLateRate: 0,
    avgAttendanceRate: 0.5,
  });
}

describe('Analytics late metric (integration, ROK-1938)', () => {
  it('pipeline: one late, one full, one no-show', () =>
    testPipelineLateFullNoShow());
  it('a manual no_show beats a late voice label', () =>
    testManualNoShowBeatsLateVoice());
  it('a user-id-only signup matches its late voice row via user_id', () =>
    testUserIdOnlySignupMatches());
  it('two late voice rows for one signup count once', () =>
    testTwoLateRowsCountOnce());
  it('an attended signup with no voice data is on time', () =>
    testNoVoiceDataIsOnTime());
});
