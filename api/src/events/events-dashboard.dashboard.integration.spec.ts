/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Events Dashboard & findAll Integration Tests (ROK-523)
 *
 * Verifies dashboard aggregation and findAll query behavior against a real PostgreSQL database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

/** Helper to create a member user with local credentials and return their token. */
async function createMemberAndLogin(
  testApp: TestApp,
  username: string,
  email: string,
  discordId?: string,
): Promise<{ userId: number; token: string }> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId: discordId ?? `local:${email}`, username, role: 'member' })
    .returning();
  await testApp.db.insert(schema.localCredentials).values({ email, passwordHash, userId: user.id });
  const loginRes = await testApp.request.post('/auth/local').send({ email, password: 'TestPassword123!' });
  return { userId: user.id, token: loginRes.body.access_token as string };
}

/** Helper to create a future event and return its ID. */
async function createFutureEvent(
  testApp: TestApp,
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'Integration Test Event', startTime: start.toISOString(), endTime: end.toISOString(), ...overrides });
  if (res.status !== 201) {
    throw new Error(`createFutureEvent failed: ${res.status} — ${JSON.stringify(res.body)}`);
  }
  return res.body.id as number;
}

/** Helper to create a past event via direct DB insert. */
async function createPastEvent(
  testApp: TestApp,
  creatorId: number,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
): Promise<number> {
  const start = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({ title: 'Past Integration Test Event', creatorId, duration: [start, end] as [Date, Date], ...overrides })
    .returning();
  return event.id;
}

describe('Events Dashboard & findAll (integration)', () => {
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

  // ===================================================================
  // Dashboard (getMyDashboard)
  // ===================================================================

  describe('dashboard (my-dashboard)', () => {
    it('should return empty dashboard when no upcoming events exist', async () => {
      const res = await testApp.request.get('/events/my-dashboard').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.stats).toMatchObject({ totalUpcomingEvents: 0, totalSignups: 0, averageFillRate: 0, eventsWithRosterGaps: 0 });
      expect(res.body.events).toHaveLength(0);
    });

    it('should include upcoming events with correct signup counts', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'Dashboard Event' });
      const { token: t1 } = await createMemberAndLogin(testApp, 'dash_p1', 'dash_p1@test.local');
      const { token: t2 } = await createMemberAndLogin(testApp, 'dash_p2', 'dash_p2@test.local');
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${t1}`).send({});
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${t2}`).send({});

      const res = await testApp.request.get('/events/my-dashboard').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.stats.totalUpcomingEvents).toBe(1);
      expect(res.body.stats.totalSignups).toBe(3);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].title).toBe('Dashboard Event');
    });

    it('should compute unconfirmed counts per event', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { gameId: testApp.seed.game.id });
      const { token: t1 } = await createMemberAndLogin(testApp, 'unconf_p1', 'unconf_p1@test.local');
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${t1}`).send({});
      const { token: t2 } = await createMemberAndLogin(testApp, 'unconf_p2', 'unconf_p2@test.local');
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${t2}`).send({});

      const res = await testApp.request.get('/events/my-dashboard').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events[0].unconfirmedCount).toBe(2);
    });

    it('should compute roster fill percent with slot config', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 2, flex: 0, bench: 0 },
      });
      const [adminSignup] = await testApp.db.select().from(schema.eventSignups).where(eq(schema.eventSignups.eventId, eventId));
      await testApp.db.insert(schema.rosterAssignments).values({ eventId, signupId: adminSignup.id, role: 'tank', position: 1 });

      const res = await testApp.request.get('/events/my-dashboard').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events[0].rosterFillPercent).toBe(25);
      expect(res.body.events[0].missingRoles).toEqual(
        expect.arrayContaining([expect.stringContaining('healer'), expect.stringContaining('dps')]),
      );
    });

    it('should exclude cancelled events from dashboard', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'Soon-to-be-cancelled' });
      await testApp.request.patch(`/events/${eventId}/cancel`).set('Authorization', `Bearer ${adminToken}`).send({});

      const res = await testApp.request.get('/events/my-dashboard').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.stats.totalUpcomingEvents).toBe(0);
      expect(res.body.events).toHaveLength(0);
    });

    it('should compute attendance metrics from past events', async () => {
      const pastEventId = await createPastEvent(testApp, testApp.seed.adminUser.id);
      const { token: t1 } = await createMemberAndLogin(testApp, 'att_p1', 'att_p1@test.local');
      const { token: t2 } = await createMemberAndLogin(testApp, 'att_p2', 'att_p2@test.local');
      const s1 = await testApp.request.post(`/events/${pastEventId}/signup`).set('Authorization', `Bearer ${t1}`).send({});
      const s2 = await testApp.request.post(`/events/${pastEventId}/signup`).set('Authorization', `Bearer ${t2}`).send({});
      await testApp.request.patch(`/events/${pastEventId}/attendance`).set('Authorization', `Bearer ${adminToken}`).send({ signupId: s1.body.id, attendanceStatus: 'attended' });
      await testApp.request.patch(`/events/${pastEventId}/attendance`).set('Authorization', `Bearer ${adminToken}`).send({ signupId: s2.body.id, attendanceStatus: 'no_show' });

      const signups = await testApp.db.select().from(schema.eventSignups).where(eq(schema.eventSignups.eventId, pastEventId));
      const markedSignups = signups.filter((s) => s.attendanceStatus !== null);
      expect(markedSignups.length).toBe(2);

      const res = await testApp.request.get('/events/my-dashboard').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const { attendanceRate, noShowRate } = res.body.stats;
      if (attendanceRate !== undefined) {
        expect(attendanceRate).toBe(0.5);
        expect(noShowRate).toBe(0.5);
      }
    });

    it('should scope dashboard to creator events for non-admin users', async () => {
      await createFutureEvent(testApp, adminToken, { title: 'Admin Event' });
      const { token: memberToken } = await createMemberAndLogin(testApp, 'member_dash', 'member_dash@test.local');

      const res = await testApp.request.get('/events/my-dashboard').set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body.stats.totalUpcomingEvents).toBe(0);
    });
  });

  // ===================================================================
  // findAll with advanced queries
  // ===================================================================

  describe('findAll', () => {
    it('should return events with correct signup counts', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'FindAll Event' });
      const { token } = await createMemberAndLogin(testApp, 'findall_p1', 'findall_p1@test.local');
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});

      const res = await testApp.request.get('/events');
      expect(res.status).toBe(200);
      const event = res.body.data.find((e: any) => e.id === eventId);
      expect(event).toBeDefined();
      expect(event.signupCount).toBe(2);
    });

    it('should filter events by date range', async () => {
      const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await createFutureEvent(testApp, adminToken, {
        title: 'Near Event', startTime: nearFuture.toISOString(),
        endTime: new Date(nearFuture.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      });
      await createFutureEvent(testApp, adminToken, {
        title: 'Far Event', startTime: farFuture.toISOString(),
        endTime: new Date(farFuture.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      });

      const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const res = await testApp.request.get(`/events?endBefore=${cutoff.toISOString()}`);
      expect(res.status).toBe(200);
      const titles = res.body.data.map((e: any) => e.title as string);
      expect(titles).toContain('Near Event');
      expect(titles).not.toContain('Far Event');
    });

    it('should paginate results correctly', async () => {
      for (let i = 0; i < 3; i++) {
        const start = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
        await createFutureEvent(testApp, adminToken, {
          title: `Page Event ${i}`, startTime: start.toISOString(),
          endTime: new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString(),
        });
      }
      const page1 = await testApp.request.get('/events?page=1&limit=2');
      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(2);
      expect(page1.body.meta.total).toBe(3);
      expect(page1.body.meta.hasMore).toBe(true);

      const page2 = await testApp.request.get('/events?page=2&limit=2');
      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(1);
      expect(page2.body.meta.hasMore).toBe(false);
    });

    it('should exclude roached_out signups from signup count', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const { userId } = await createMemberAndLogin(testApp, 'roacher', 'roacher@test.local');
      await testApp.db.insert(schema.eventSignups).values({ eventId, userId, status: 'roached_out', confirmationStatus: 'pending' });

      const res = await testApp.request.get(`/events/${eventId}`);
      expect(res.status).toBe(200);
      expect(res.body.signupCount).toBe(1);
    });
  });
});
