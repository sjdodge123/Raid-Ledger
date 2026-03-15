/**
 * Events Analytics Integration Tests (ROK-834)
 *
 * Verifies that analytics aggregate queries (attendance trends, per-user
 * reliability, per-game breakdown) return correct results against a real
 * PostgreSQL database. These endpoints are operator/admin-only.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createPastEvent,
} from './signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';

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

// ── Helpers ──────────────────────────────────────────────────

/** Insert an event signup with a given attendance status. */
async function insertSignup(
  eventId: number,
  userId: number,
  attendanceStatus: string,
) {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    attendanceStatus,
    attendanceRecordedAt: new Date(),
  });
}

/** Create a second game for per-game tests. */
async function createSecondGame(name = 'Second Game') {
  const [game] = await testApp.db
    .insert(schema.games)
    .values({
      name,
      slug: 'second-game',
      coverUrl: 'https://example.com/cover.jpg',
    })
    .returning();
  return game;
}

// ── Attendance Trends ────────────────────────────────────────

async function testTrendsReturnsCorrectCounts() {
  const creatorId = testApp.seed.adminUser.id;
  const eventId = await createPastEvent(testApp, creatorId);

  await insertSignup(eventId, creatorId, 'attended');

  // Create a member and add a no_show signup
  const { userId: memberId } = await createMemberAndLogin(
    testApp,
    'member1',
    'member1@test.local',
  );
  await insertSignup(eventId, memberId, 'no_show');

  const res = await testApp.request
    .get('/analytics/attendance?period=30d')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.period).toBe('30d');
  expect(res.body.dataPoints.length).toBeGreaterThanOrEqual(1);

  const point = res.body.dataPoints[0];
  expect(point.attended).toBe(1);
  expect(point.noShow).toBe(1);
  expect(point.excused).toBe(0);
  expect(point.total).toBe(2);
}

async function testTrendsExcusedCounts() {
  const creatorId = testApp.seed.adminUser.id;
  const eventId = await createPastEvent(testApp, creatorId);

  const { userId } = await createMemberAndLogin(
    testApp,
    'excused-user',
    'excused@test.local',
  );
  await insertSignup(eventId, userId, 'excused');

  const res = await testApp.request
    .get('/analytics/attendance?period=90d')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.period).toBe('90d');
  const point = res.body.dataPoints[0];
  expect(point.excused).toBe(1);
  expect(point.total).toBe(1);
}

async function testTrendsSummaryRates() {
  const creatorId = testApp.seed.adminUser.id;
  const eventId = await createPastEvent(testApp, creatorId);

  await insertSignup(eventId, creatorId, 'attended');
  const { userId } = await createMemberAndLogin(
    testApp,
    'ns-user',
    'ns@test.local',
  );
  await insertSignup(eventId, userId, 'no_show');

  const res = await testApp.request
    .get('/analytics/attendance?period=30d')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.summary.avgAttendanceRate).toBe(0.5);
  expect(res.body.summary.avgNoShowRate).toBe(0.5);
  expect(res.body.summary.totalEvents).toBe(1);
}

// ── Empty Data ───────────────────────────────────────────────

async function testTrendsEmptyData() {
  const res = await testApp.request
    .get('/analytics/attendance?period=30d')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.dataPoints).toEqual([]);
  expect(res.body.summary).toMatchObject({
    avgAttendanceRate: 0,
    avgNoShowRate: 0,
    totalEvents: 0,
  });
}

async function testUserReliabilityEmptyData() {
  const res = await testApp.request
    .get('/analytics/attendance/users')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.users).toEqual([]);
  expect(res.body.totalUsers).toBe(0);
}

async function testGameAttendanceEmptyData() {
  const res = await testApp.request
    .get('/analytics/attendance/games')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.games).toEqual([]);
}

// ── Per-User Reliability ─────────────────────────────────────

async function testUserReliabilityBreakdown() {
  const creatorId = testApp.seed.adminUser.id;
  const eventId = await createPastEvent(testApp, creatorId);

  await insertSignup(eventId, creatorId, 'attended');
  const { userId } = await createMemberAndLogin(
    testApp,
    'flaky-user',
    'flaky@test.local',
  );
  await insertSignup(eventId, userId, 'no_show');

  const res = await testApp.request
    .get('/analytics/attendance/users')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.totalUsers).toBe(2);
  expect(res.body.users.length).toBe(2);

  const users = res.body.users as Array<{ userId: number }>;
  const adminEntry = users.find((u) => u.userId === creatorId);
  expect(adminEntry).toMatchObject({
    totalEvents: 1,
    attended: 1,
    noShow: 0,
    attendanceRate: 1,
  });

  const memberEntry = users.find((u) => u.userId === userId);
  expect(memberEntry).toMatchObject({
    totalEvents: 1,
    attended: 0,
    noShow: 1,
    attendanceRate: 0,
  });
}

async function testUserReliabilityPagination() {
  const creatorId = testApp.seed.adminUser.id;
  const eventId = await createPastEvent(testApp, creatorId);

  await insertSignup(eventId, creatorId, 'attended');
  const { userId } = await createMemberAndLogin(
    testApp,
    'pag-user',
    'pag@test.local',
  );
  await insertSignup(eventId, userId, 'attended');

  // Fetch page 1 with limit=1
  const res = await testApp.request
    .get('/analytics/attendance/users?limit=1&offset=0')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.users.length).toBe(1);
  expect(res.body.totalUsers).toBe(2);

  // Fetch page 2
  const res2 = await testApp.request
    .get('/analytics/attendance/users?limit=1&offset=1')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res2.status).toBe(200);
  expect(res2.body.users.length).toBe(1);
}

// ── Per-Game Attendance ──────────────────────────────────────

async function testGameAttendanceBreakdown() {
  const creatorId = testApp.seed.adminUser.id;
  const gameId = testApp.seed.game.id;

  const eventId = await createPastEvent(testApp, creatorId, { gameId });
  await insertSignup(eventId, creatorId, 'attended');

  const { userId } = await createMemberAndLogin(
    testApp,
    'game-user',
    'game@test.local',
  );
  await insertSignup(eventId, userId, 'no_show');

  const res = await testApp.request
    .get('/analytics/attendance/games')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.games.length).toBe(1);

  const gameEntry = res.body.games[0];
  expect(gameEntry).toMatchObject({
    gameId,
    gameName: 'Test Game',
    totalEvents: 1,
    totalSignups: 2,
    avgAttendanceRate: 0.5,
    avgNoShowRate: 0.5,
  });
}

async function testMultipleGamesBreakdown() {
  const creatorId = testApp.seed.adminUser.id;
  const game1Id = testApp.seed.game.id;
  const game2 = await createSecondGame();

  const ev1 = await createPastEvent(testApp, creatorId, { gameId: game1Id });
  await insertSignup(ev1, creatorId, 'attended');

  const ev2 = await createPastEvent(testApp, creatorId, { gameId: game2.id });
  const { userId } = await createMemberAndLogin(
    testApp,
    'g2-user',
    'g2@test.local',
  );
  await insertSignup(ev2, userId, 'no_show');

  const res = await testApp.request
    .get('/analytics/attendance/games')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.games.length).toBe(2);

  const games = res.body.games as Array<{
    gameId: number;
    avgAttendanceRate: number;
    avgNoShowRate: number;
  }>;
  const g1 = games.find((g) => g.gameId === game1Id);
  expect(g1?.avgAttendanceRate).toBe(1);

  const g2 = games.find((g) => g.gameId === game2.id);
  expect(g2?.avgNoShowRate).toBe(1);
}

// ── Date Range Filtering ─────────────────────────────────────

async function testTrendsRespectsDateRange() {
  const creatorId = testApp.seed.adminUser.id;

  // Old event: 60 days ago (within 90d, outside 30d)
  const oldStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const oldEnd = new Date(oldStart.getTime() + 3 * 60 * 60 * 1000);
  const oldEventId = await createPastEvent(testApp, creatorId, {
    title: 'Old Event',
    duration: [oldStart, oldEnd] as [Date, Date],
  });
  await insertSignup(oldEventId, creatorId, 'attended');

  // Recent event: 5 days ago (within both 30d and 90d)
  const recentStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const recentEnd = new Date(recentStart.getTime() + 3 * 60 * 60 * 1000);
  const { userId } = await createMemberAndLogin(
    testApp,
    'recent-user',
    'recent@test.local',
  );
  const recentEventId = await createPastEvent(testApp, creatorId, {
    title: 'Recent Event',
    duration: [recentStart, recentEnd] as [Date, Date],
  });
  await insertSignup(recentEventId, userId, 'no_show');

  // 30d should only see the recent event
  const res30 = await testApp.request
    .get('/analytics/attendance?period=30d')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res30.status).toBe(200);
  expect(res30.body.summary.totalEvents).toBe(1);

  // 90d should see both
  const res90 = await testApp.request
    .get('/analytics/attendance?period=90d')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res90.status).toBe(200);
  expect(res90.body.summary.totalEvents).toBe(2);
}

// ── Auth Guards ──────────────────────────────────────────────

async function testMemberCannotAccessTrends() {
  const { token } = await createMemberAndLogin(
    testApp,
    'normie',
    'normie@test.local',
  );
  const res = await testApp.request
    .get('/analytics/attendance?period=30d')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(403);
}

async function testMemberCannotAccessUserReliability() {
  const { token } = await createMemberAndLogin(
    testApp,
    'normie2',
    'normie2@test.local',
  );
  const res = await testApp.request
    .get('/analytics/attendance/users')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(403);
}

async function testMemberCannotAccessGameAttendance() {
  const { token } = await createMemberAndLogin(
    testApp,
    'normie3',
    'normie3@test.local',
  );
  const res = await testApp.request
    .get('/analytics/attendance/games')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(403);
}

async function testUnauthenticatedReturns401() {
  const res = await testApp.request.get('/analytics/attendance?period=30d');
  expect(res.status).toBe(401);
}

// ── Describe Blocks ──────────────────────────────────────────

describe('Analytics — attendance trends (integration)', () => {
  it('returns correct attended/noShow/excused counts per date', () =>
    testTrendsReturnsCorrectCounts());
  it('counts excused signups correctly', () => testTrendsExcusedCounts());
  it('computes summary rates correctly', () => testTrendsSummaryRates());
  it('returns empty arrays when no events exist', () => testTrendsEmptyData());
});

describe('Analytics — per-user reliability (integration)', () => {
  it('returns per-user breakdown with rates', () =>
    testUserReliabilityBreakdown());
  it('supports pagination via limit/offset', () =>
    testUserReliabilityPagination());
  it('returns empty when no events exist', () =>
    testUserReliabilityEmptyData());
});

describe('Analytics — per-game attendance (integration)', () => {
  it('returns per-game breakdown with rates', () =>
    testGameAttendanceBreakdown());
  it('handles multiple games independently', () =>
    testMultipleGamesBreakdown());
  it('returns empty when no events exist', () => testGameAttendanceEmptyData());
});

describe('Analytics — date range filtering (integration)', () => {
  it('30d excludes old events, 90d includes them', () =>
    testTrendsRespectsDateRange());
});

describe('Analytics — auth guards (integration)', () => {
  it('rejects member token on attendance trends', () =>
    testMemberCannotAccessTrends());
  it('rejects member token on user reliability', () =>
    testMemberCannotAccessUserReliability());
  it('rejects member token on game attendance', () =>
    testMemberCannotAccessGameAttendance());
  it('returns 401 without authentication', () =>
    testUnauthenticatedReturns401());
});
