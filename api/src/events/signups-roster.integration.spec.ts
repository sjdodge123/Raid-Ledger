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
} from './signups.integration.spec-helpers';

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
  const { token } = await createMemberAndLogin(
    testApp,
    'attendee',
    'attendee@test.local',
  );
  const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const attendanceRes = await testApp.request
    .patch(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ signupId: signupRes.body.id, attendanceStatus: 'attended' });
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
  const { token: t1 } = await createMemberAndLogin(
    testApp,
    'att_p1',
    'att_p1@test.local',
  );
  const { token: t2 } = await createMemberAndLogin(
    testApp,
    'att_p2',
    'att_p2@test.local',
  );
  const s1 = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${t1}`)
    .send({});
  const s2 = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${t2}`)
    .send({});
  await testApp.request
    .patch(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ signupId: s1.body.id, attendanceStatus: 'attended' });
  await testApp.request
    .patch(`/events/${eventId}/attendance`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ signupId: s2.body.id, attendanceStatus: 'no_show' });
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

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

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
