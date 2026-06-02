/**
 * Signups Integration Tests — admin remove, self-unassign, roster, attendance, auth guards.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import {
  createMemberAndLogin,
  createFutureEvent,
  createPastEvent,
  signupViaDb,
  getAllRosterAssignments,
} from './signups.integration.spec-helpers';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { insertRosterSlotWithRetry } from './signups-roster-slot.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

let testApp: TestApp;
let adminToken: string;

async function setupAll() {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

async function resetAfterEach() {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

// ─── admin remove tests ─────────────────────────────────────────────────────

async function testAdminRemove() {
  const { token } = await createMemberAndLogin(
    testApp,
    'removeme',
    'removeme@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const removeRes = await testApp.request
    .delete(`/events/${eventId}/signups/${signupRes.body.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(removeRes.status).toBe(200);
  const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
  expect(
    (rosterRes.body as { signups: Array<{ id: number }> }).signups.find(
      (s) => s.id === (signupRes.body as { id: number }).id,
    ),
  ).toBeUndefined();
}

// ─── self-unassign test ─────────────────────────────────────────────────────

async function testSelfUnassign() {
  const { token } = await createMemberAndLogin(
    testApp,
    'unassigner',
    'unassigner@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken, {
    maxAttendees: 25,
  });
  await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const unassignRes = await testApp.request
    .delete(`/events/${eventId}/roster/me`)
    .set('Authorization', `Bearer ${token}`);
  expect(unassignRes.status).toBe(200);
  const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
  expect(
    (
      rosterRes.body as { signups: Array<{ user: { username: string } }> }
    ).signups.find((s) => s.user.username === 'unassigner'),
  ).toBeDefined();
}

// ─── roster with assignments test ───────────────────────────────────────────

async function testRosterAssignments() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const res = await testApp.request.get(
    `/events/${eventId}/roster/assignments`,
  );
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('assignments');
  expect(res.body).toHaveProperty('pool');
}

// ─── attendance tests ───────────────────────────────────────────────────────

async function testRecordAttendance() {
  const { userId } = await createMemberAndLogin(
    testApp,
    'attendee',
    'attendee@test.local',
  );
  const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);
  const signup = await signupViaDb(testApp, eventId, userId);
  const attendanceRes = await testApp.request
    .patch(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ signupId: signup.id, attendanceStatus: 'attended' });
  expect(attendanceRes.status).toBe(200);
  expect(attendanceRes.body.attendanceStatus).toBe('attended');
}

async function testRejectFutureAttendance() {
  const { token } = await createMemberAndLogin(
    testApp,
    'future_att',
    'future_att@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const res = await testApp.request
    .patch(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ signupId: signupRes.body.id, attendanceStatus: 'attended' });
  expect(res.status).toBe(400);
}

async function testAttendanceSummary() {
  const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);
  const { userId: u1 } = await createMemberAndLogin(
    testApp,
    'att_p1',
    'att_p1@test.local',
  );
  const { userId: u2 } = await createMemberAndLogin(
    testApp,
    'att_p2',
    'att_p2@test.local',
  );
  const s1 = await signupViaDb(testApp, eventId, u1);
  const s2 = await signupViaDb(testApp, eventId, u2);
  await testApp.request
    .patch(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ signupId: s1.id, attendanceStatus: 'attended' });
  await testApp.request
    .patch(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ signupId: s2.id, attendanceStatus: 'no_show' });
  const summaryRes = await testApp.request
    .get(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(summaryRes.status).toBe(200);
  expect(summaryRes.body.attended).toBeGreaterThanOrEqual(1);
  expect(summaryRes.body.noShow).toBeGreaterThanOrEqual(1);
  expect(summaryRes.body.totalSignups).toBeGreaterThanOrEqual(2);
}

async function testAutoClassifyRoachedOut() {
  const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);
  const { userId } = await createMemberAndLogin(
    testApp,
    'roacher',
    'roacher@test.local',
  );
  const [event] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const eventStart = event.duration[0];
  const roachedOutAt = new Date(eventStart.getTime() - 48 * 60 * 60 * 1000);
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'roached_out',
    roachedOutAt,
    confirmationStatus: 'pending',
  });
  const summaryRes = await testApp.request
    .get(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(summaryRes.status).toBe(200);
  const attSignups = (
    summaryRes.body as {
      signups: Array<Record<string, unknown> & { user: { username: string } }>;
    }
  ).signups;
  const roachSignup = attSignups.find((s) => s.user.username === 'roacher');
  expect(roachSignup).toBeDefined();
  expect(roachSignup!.attendanceStatus).toBe('excused');
}

// ─── auth guard tests ───────────────────────────────────────────────────────

async function testAuthRequired() {
  const eventId = await createFutureEvent(testApp, adminToken);
  expect(
    (await testApp.request.post(`/events/${eventId}/signup`).send({})).status,
  ).toBe(401);
}

async function testAttendanceAuthRequired() {
  const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);
  expect(
    (await testApp.request.get(`/events/${eventId}/attendance`)).status,
  ).toBe(401);
}

// ─── Regression: ROK-1345 — concurrent slot race ────────────────────────────

/**
 * Two signups racing for the same player slot used to both compute the same
 * `findNextPosition`, collide on `unique_slot_per_event` (PG 23505), and the
 * loser returned a 500. The bounded-retry insert must now place the loser in
 * the next free slot. Drives the real service signup path concurrently.
 */
async function testConcurrentSignupsNoDuplicateKey() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    maxAttendees: 5,
  });
  const { userId: u1 } = await createMemberAndLogin(
    testApp,
    'race1',
    'race1@test.local',
  );
  const { userId: u2 } = await createMemberAndLogin(
    testApp,
    'race2',
    'race2@test.local',
  );
  const service = testApp.app.get(SignupsService, { strict: false });
  // Fire both signups concurrently — neither should reject with a 23505.
  const [r1, r2] = await Promise.all([
    service.signup(eventId, u1, {}),
    service.signup(eventId, u2, {}),
  ]);
  // Both racers must hold a distinct player slot (the event creator is
  // auto-signed-up too, so there are 3 player rows in total).
  const assignments = await getAllRosterAssignments(testApp, eventId);
  const players = assignments.filter((a) => a.role === 'player');
  const racerRows = players.filter((p) => [r1.id, r2.id].includes(p.signupId));
  expect(racerRows).toHaveLength(2);
  // No two player rows share a position (no duplicate slot survived).
  const positions = players.map((p) => p.position);
  expect(new Set(positions).size).toBe(positions.length);
}

/**
 * Deterministic retry proof: drive insertRosterSlotWithRetry directly with an
 * explicit position that is already taken. The first attempt hits the
 * unique_slot_per_event 23505, the helper recomputes the next free position
 * and retries — returning a distinct slot instead of throwing.
 */
async function testRetryHelperRecoversFromTakenSlot() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    maxAttendees: 5,
  });
  const { userId: occupantId } = await createMemberAndLogin(
    testApp,
    'occupant2',
    'occupant2@test.local',
  );
  const { userId: latecomerId } = await createMemberAndLogin(
    testApp,
    'latecomer2',
    'latecomer2@test.local',
  );
  const occupant = await signupViaDb(testApp, eventId, occupantId);
  const latecomer = await signupViaDb(testApp, eventId, latecomerId);
  // Occupy tank position 1 outright (distinct role keeps the auto-signed-up
  // creator's player rows from interfering with the assertion).
  await testApp.db.insert(schema.rosterAssignments).values({
    eventId,
    signupId: occupant.id,
    role: 'tank',
    position: 1,
    isOverride: 0,
  });
  const db = testApp.app.get<PostgresJsDatabase<typeof schema>>(
    DrizzleAsyncProvider,
    { strict: false },
  );
  // explicitPosition: 1 is taken → must retry into the next free slot.
  const placed = await db.transaction((tx) =>
    insertRosterSlotWithRetry(tx, {
      eventId,
      signupId: latecomer.id,
      slotRole: 'tank',
      explicitPosition: 1,
      autoBench: false,
    }),
  );
  expect(placed).not.toBe(1);
  const tanks = (await getAllRosterAssignments(testApp, eventId)).filter(
    (a) => a.role === 'tank',
  );
  expect(tanks).toHaveLength(2);
  expect(new Set(tanks.map((t) => t.position)).size).toBe(2);
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('Signups — Regression: ROK-1345 concurrent slot race', () => {
  it('places both concurrent signups in distinct slots without 500', () =>
    testConcurrentSignupsNoDuplicateKey());
  it('retries into the next free slot when the target is taken', () =>
    testRetryHelperRecoversFromTakenSlot());
});

describe('Signups — admin remove', () => {
  it('should allow admin to remove a signup', () => testAdminRemove());
});

describe('Signups — self-unassign', () => {
  it('should remove assignment but keep signup', () => testSelfUnassign());
});

describe('Signups — roster with assignments', () => {
  it('should return roster with assignment data', () =>
    testRosterAssignments());
});

describe('Signups — attendance', () => {
  it('should record attendance on past event', () => testRecordAttendance());
  it('should reject attendance on future event', () =>
    testRejectFutureAttendance());
  it('should return attendance summary', () => testAttendanceSummary());
  it('should auto-classify roached_out', () => testAutoClassifyRoachedOut());
});

describe('Signups — auth guards', () => {
  it('should require auth to sign up', () => testAuthRequired());
  it('should require auth to view attendance', () =>
    testAttendanceAuthRequired());
});
