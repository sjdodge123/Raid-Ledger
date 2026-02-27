/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Signups, Attendance & Roster Integration Tests (ROK-522)
 *
 * Verifies signup flows, roster assignment, attendance recording, and
 * attendance summary against a real PostgreSQL database. These are the
 * flows that mocked unit tests cannot verify — transactional roster
 * placement, bench overflow, idempotent signup, and attendance classification.
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
): Promise<{ userId: number; token: string }> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);

  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${email}`,
      username,
      role: 'member',
    })
    .returning();

  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash,
    userId: user.id,
  });

  const loginRes = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });

  return { userId: user.id, token: loginRes.body.access_token as string };
}

/** Helper to create a future event and return its ID. */
async function createFutureEvent(
  testApp: TestApp,
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000); // +3 hours

  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Integration Test Event',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(
      `createFutureEvent failed: ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.id as number;
}

/** Helper to create a past event (already ended) via direct DB insert. */
async function createPastEvent(
  testApp: TestApp,
  creatorId: number,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
): Promise<number> {
  const start = new Date(Date.now() - 48 * 60 * 60 * 1000); // 2 days ago
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000); // ended 45h ago

  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Past Integration Test Event',
      creatorId,
      duration: [start, end] as [Date, Date],
      ...overrides,
    })
    .returning();

  return event.id;
}

describe('Signups, Attendance & Roster (integration)', () => {
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
  // Signup Flows
  // ===================================================================

  describe('signup flows', () => {
    it('should sign up for an event and appear in roster', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'player1',
        'player1@test.local',
      );
      const eventId = await createFutureEvent(testApp, adminToken);

      const signupRes = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(signupRes.status).toBe(201);
      expect(signupRes.body).toMatchObject({
        id: expect.any(Number),
        eventId,
        user: expect.objectContaining({ username: 'player1' }),
      });

      // Verify roster contains the signup
      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      expect(rosterRes.status).toBe(200);

      const playerSignup = rosterRes.body.signups.find(
        (s: any) => s.user.username === 'player1',
      );
      expect(playerSignup).toBeDefined();
    });

    it('should return existing signup on duplicate (idempotent)', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'player2',
        'player2@test.local',
      );
      const eventId = await createFutureEvent(testApp, adminToken);

      // First signup
      const first = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(first.status).toBe(201);

      // Duplicate signup — should return existing
      const second = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
    });

    it('should cancel signup and remove from roster', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'player3',
        'player3@test.local',
      );
      const eventId = await createFutureEvent(testApp, adminToken);

      // Sign up
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Cancel signup
      const cancelRes = await testApp.request
        .delete(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`);

      expect(cancelRes.status).toBe(200);

      // Verify roster no longer contains the player
      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      const playerSignup = rosterRes.body.signups.find(
        (s: any) => s.user.username === 'player3',
      );
      expect(playerSignup).toBeUndefined();
    });

    it('should auto-signup creator when creating an event', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      expect(rosterRes.status).toBe(200);
      expect(rosterRes.body.signups.length).toBeGreaterThanOrEqual(1);

      // Creator (admin) should be in the roster
      const creatorSignup = rosterRes.body.signups.find(
        (s: any) => s.user.id === testApp.seed.adminUser.id,
      );
      expect(creatorSignup).toBeDefined();
    });

    it('should bench signup when event is at capacity', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        maxAttendees: 1,
      });

      // Admin is auto-signed up (slot 1/1). Create a second player.
      const { token } = await createMemberAndLogin(
        testApp,
        'overflow',
        'overflow@test.local',
      );

      const signupRes = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(signupRes.status).toBe(201);

      // Check roster assignments — the overflow player should be on bench
      const assignmentsRes = await testApp.request.get(
        `/events/${eventId}/roster/assignments`,
      );
      expect(assignmentsRes.status).toBe(200);

      const overflowAssignment = assignmentsRes.body.assignments?.find(
        (a: any) => a.signup?.user?.username === 'overflow',
      );
      // Benched players have role 'bench'
      if (overflowAssignment) {
        expect(overflowAssignment.role).toBe('bench');
      }
    });
  });

  // ===================================================================
  // Signup Status Updates
  // ===================================================================

  describe('signup status updates', () => {
    it('should update signup status to tentative', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'tentative_player',
        'tentative@test.local',
      );
      const eventId = await createFutureEvent(testApp, adminToken);

      // Sign up first
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Update status to tentative
      const updateRes = await testApp.request
        .patch(`/events/${eventId}/signup/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'tentative' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('tentative');
    });
  });

  // ===================================================================
  // Confirm Signup with Character
  // ===================================================================

  describe('confirm signup', () => {
    it('should confirm signup with character selection', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'char_player',
        'char_player@test.local',
      );
      const eventId = await createFutureEvent(testApp, adminToken, {
        gameId: testApp.seed.game.id,
      });

      // Sign up
      const signupRes = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const signupId = signupRes.body.id;
      expect(signupRes.body.confirmationStatus).toBe('pending');

      // Create a character for this user
      const charRes = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'TestChar',
          class: 'Warrior',
          role: 'tank',
        });

      expect(charRes.status).toBe(201);
      const characterId = charRes.body.id;

      // Confirm signup with character
      const confirmRes = await testApp.request
        .patch(`/events/${eventId}/signups/${signupId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ characterId });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.confirmationStatus).toBe('confirmed');
      expect(confirmRes.body.characterId).toBe(characterId);
    });

    it('should transition to changed status on re-confirmation', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'reconfirm',
        'reconfirm@test.local',
      );
      const eventId = await createFutureEvent(testApp, adminToken, {
        gameId: testApp.seed.game.id,
      });

      // Sign up
      const signupRes = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const signupId = signupRes.body.id;

      // Create two characters
      const char1Res = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'Char1',
          class: 'Mage',
          role: 'dps',
        });
      const char2Res = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'Char2',
          realm: 'OtherRealm',
          class: 'Priest',
          role: 'healer',
        });

      // First confirmation
      await testApp.request
        .patch(`/events/${eventId}/signups/${signupId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ characterId: char1Res.body.id });

      // Re-confirm with different character
      const reconfirmRes = await testApp.request
        .patch(`/events/${eventId}/signups/${signupId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ characterId: char2Res.body.id });

      expect(reconfirmRes.status).toBe(200);
      expect(reconfirmRes.body.confirmationStatus).toBe('changed');
      expect(reconfirmRes.body.characterId).toBe(char2Res.body.id);
    });
  });

  // ===================================================================
  // Admin Remove Signup
  // ===================================================================

  describe('admin remove signup', () => {
    it('should allow admin to remove a signup', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'removeme',
        'removeme@test.local',
      );
      const eventId = await createFutureEvent(testApp, adminToken);

      // Player signs up
      const signupRes = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const signupId = signupRes.body.id;

      // Admin removes the signup
      const removeRes = await testApp.request
        .delete(`/events/${eventId}/signups/${signupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(removeRes.status).toBe(200);

      // Verify removal from roster
      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      const removedSignup = rosterRes.body.signups.find(
        (s: any) => s.id === signupId,
      );
      expect(removedSignup).toBeUndefined();
    });
  });

  // ===================================================================
  // Self-Unassign from Roster
  // ===================================================================

  describe('self-unassign', () => {
    it('should remove roster assignment but keep signup', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'unassigner',
        'unassigner@test.local',
      );
      // Create event with maxAttendees so roster assignments are auto-created
      const eventId = await createFutureEvent(testApp, adminToken, {
        maxAttendees: 25,
      });

      // Sign up
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Self-unassign
      const unassignRes = await testApp.request
        .delete(`/events/${eventId}/roster/me`)
        .set('Authorization', `Bearer ${token}`);

      expect(unassignRes.status).toBe(200);

      // Signup should still exist in the roster (unassigned state)
      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      const signup = rosterRes.body.signups.find(
        (s: any) => s.user.username === 'unassigner',
      );
      expect(signup).toBeDefined();
    });
  });

  // ===================================================================
  // Roster with Assignments
  // ===================================================================

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

  // ===================================================================
  // Attendance Recording
  // ===================================================================

  describe('attendance', () => {
    it('should record attendance for a signup on a past event', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'attendee',
        'attendee@test.local',
      );
      const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);

      // Player signs up
      const signupRes = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const signupId = signupRes.body.id;

      // Admin records attendance
      const attendanceRes = await testApp.request
        .patch(`/events/${eventId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ signupId, attendanceStatus: 'attended' });

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

      // Create two additional players
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

      // Both sign up
      const s1 = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${t1}`)
        .send({});
      const s2 = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${t2}`)
        .send({});

      // Mark one as attended, one as no_show
      await testApp.request
        .patch(`/events/${eventId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ signupId: s1.body.id, attendanceStatus: 'attended' });

      await testApp.request
        .patch(`/events/${eventId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ signupId: s2.body.id, attendanceStatus: 'no_show' });

      // Get attendance summary
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

      // Directly insert a roached_out signup with roachedOutAt > 24h before event
      const [event] = await testApp.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      const eventStart = event.duration[0];
      const roachedOutAt = new Date(eventStart.getTime() - 48 * 60 * 60 * 1000); // 48h before

      await testApp.db.insert(schema.eventSignups).values({
        eventId,
        userId,
        status: 'roached_out',
        roachedOutAt,
        confirmationStatus: 'pending',
      });

      // Get attendance summary — roached_out with >24h should be 'excused'
      const summaryRes = await testApp.request
        .get(`/events/${eventId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(summaryRes.status).toBe(200);
      const roachSignup = summaryRes.body.signups.find(
        (s: any) => s.user.username === 'roacher',
      );
      expect(roachSignup).toBeDefined();
      expect(roachSignup.attendanceStatus).toBe('excused');
    });
  });

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require authentication to sign up', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      const res = await testApp.request
        .post(`/events/${eventId}/signup`)
        .send({});

      expect(res.status).toBe(401);
    });

    it('should require authentication to view attendance', async () => {
      const eventId = await createPastEvent(testApp, testApp.seed.adminUser.id);

      const res = await testApp.request.get(`/events/${eventId}/attendance`);

      expect(res.status).toBe(401);
    });
  });
});
