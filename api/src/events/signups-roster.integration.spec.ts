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

describe('Signups — roster & attendance (integration)', () => {
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

  describe('admin remove signup', () => {
    it('should allow admin to remove a signup', async () => {
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
    });
  });

  describe('self-unassign', () => {
    it('should remove roster assignment but keep signup', async () => {
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
    });
  });

  describe('roster with assignments', () => {
    it('should return roster with assignment data', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const assignmentsRes = await testApp.request.get(
        `/events/${eventId}/roster/assignments`,
      );
      expect(assignmentsRes.status).toBe(200);
      expect(assignmentsRes.body).toHaveProperty('assignments');
      expect(assignmentsRes.body).toHaveProperty('pool');
    });
  });

  describe('attendance', () => {
    it('should record attendance for a signup on a past event', async () => {
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
    });

    it('should reject attendance recording on a future event', async () => {
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
      const attendanceRes = await testApp.request
        .patch(`/events/${eventId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ signupId: signupRes.body.id, attendanceStatus: 'attended' });
      expect(attendanceRes.status).toBe(400);
    });

    it('should return attendance summary with correct counts', async () => {
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
    });

    it('should auto-classify roached_out signups by timing', async () => {
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
          signups: Array<
            Record<string, unknown> & { user: { username: string } }
          >;
        }
      ).signups;
      const roachSignup = attSignups.find((s) => s.user.username === 'roacher');
      expect(roachSignup).toBeDefined();
      expect(roachSignup!.attendanceStatus).toBe('excused');
    });
  });

  describe('auth guards', () => {
    it('should require authentication to sign up', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      expect(
        (await testApp.request.post(`/events/${eventId}/signup`).send({}))
          .status,
      ).toBe(401);
    });

    it('should require authentication to view attendance', async () => {
      const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);
      expect(
        (await testApp.request.get(`/events/${eventId}/attendance`)).status,
      ).toBe(401);
    });
  });
});
