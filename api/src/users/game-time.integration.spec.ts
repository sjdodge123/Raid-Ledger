/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * Game-Time Integration Tests (ROK-526)
 *
 * Verifies game-time template CRUD, committed-slot preservation,
 * day-convention conversion, override upsert, absence CRUD, and
 * composite view with window-function signup preview against a real
 * PostgreSQL database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

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

/** Helper to create a future event via the API. */
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
      title: 'GameTime Test Event',
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

describe('Game-Time (integration)', () => {
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
  // Template CRUD
  // ===================================================================

  describe('template save and retrieve', () => {
    it('should save template slots and return them in display convention', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'gtuser1',
        'gtuser1@test.local',
      );

      // Save template: Sunday 20:00 and Monday 21:00 (display convention 0=Sun)
      const putRes = await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slots: [
            { dayOfWeek: 0, hour: 20 }, // Sun 8pm
            { dayOfWeek: 1, hour: 21 }, // Mon 9pm
          ],
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.slots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dayOfWeek: 0, hour: 20 }),
          expect.objectContaining({ dayOfWeek: 1, hour: 21 }),
        ]),
      );
    });

    it('should persist template and return via composite view GET', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'gtuser2',
        'gtuser2@test.local',
      );

      // Save a template slot
      await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({ slots: [{ dayOfWeek: 3, hour: 14 }] }); // Wed 2pm

      // Retrieve composite view
      const getRes = await testApp.request
        .get('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      const slots = getRes.body.data.slots;
      expect(slots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dayOfWeek: 3,
            hour: 14,
            status: 'available',
            fromTemplate: true,
          }),
        ]),
      );
    });

    it('should replace all template slots on subsequent save', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'gtuser3',
        'gtuser3@test.local',
      );

      // Save initial slots
      await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slots: [
            { dayOfWeek: 1, hour: 10 },
            { dayOfWeek: 2, hour: 11 },
          ],
        });

      // Replace with different slots
      const putRes = await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({ slots: [{ dayOfWeek: 5, hour: 18 }] }); // Fri 6pm only

      expect(putRes.status).toBe(200);

      // Verify old slots are gone
      const getRes = await testApp.request
        .get('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`);

      const templateSlots = getRes.body.data.slots.filter(
        (s: any) => s.fromTemplate === true,
      );
      expect(templateSlots.length).toBe(1);
      expect(templateSlots[0]).toMatchObject({ dayOfWeek: 5, hour: 18 });
    });

    it('should apply day convention conversion (Sun=0 display -> Mon=0 DB)', async () => {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'gtuser_conv',
        'gtuser_conv@test.local',
      );

      // Save Sunday (display=0) slot via API
      await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({ slots: [{ dayOfWeek: 0, hour: 10 }] }); // Sunday display

      // Check DB directly: Sunday display=0 -> DB=6 (0=Mon convention)
      const dbRows = await testApp.db
        .select({
          dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
          startHour: schema.gameTimeTemplates.startHour,
        })
        .from(schema.gameTimeTemplates)
        .where(eq(schema.gameTimeTemplates.userId, userId));

      expect(dbRows.length).toBe(1);
      expect(dbRows[0].dayOfWeek).toBe(6); // DB convention: Sun=6
      expect(dbRows[0].startHour).toBe(10);
    });
  });

  // ===================================================================
  // Committed-Slot Preservation
  // ===================================================================

  describe('committed-slot preservation', () => {
    it('should preserve template slots that overlap with active event signups', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'committed_user',
        'committed_user@test.local',
      );

      // Create an event tomorrow at a known hour
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setUTCHours(20, 0, 0, 0);
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setUTCHours(22, 0, 0, 0);

      // Get the display day of week for tomorrow
      const tomorrowDisplayDay = tomorrow.getUTCDay(); // 0=Sun convention

      // Save template with a slot that matches the event time
      await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slots: [
            { dayOfWeek: tomorrowDisplayDay, hour: 20 },
            { dayOfWeek: tomorrowDisplayDay, hour: 21 },
            { dayOfWeek: 4, hour: 15 }, // unrelated slot
          ],
        });

      // Create the event and sign up the user
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Committed Slot Test',
        startTime: tomorrow.toISOString(),
        endTime: tomorrowEnd.toISOString(),
      });

      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Now save template WITHOUT the committed slots — they should be preserved
      const putRes = await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slots: [{ dayOfWeek: 4, hour: 15 }], // only the unrelated slot
        });

      expect(putRes.status).toBe(200);
      // The response should include both the submitted slot AND preserved committed slots
      expect(putRes.body.data.slots.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ===================================================================
  // Overrides
  // ===================================================================

  describe('overrides', () => {
    it('should save overrides and reflect them in composite view', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'override_user',
        'override_user@test.local',
      );

      // Pick a specific week
      const weekStart = new Date('2026-04-05T00:00:00.000Z'); // A Sunday
      const targetDate = '2026-04-08'; // Wednesday of that week

      // Save template with Wed 14:00
      await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({ slots: [{ dayOfWeek: 3, hour: 14 }] }); // Wed 2pm

      // Save an override to block that slot
      const overrideRes = await testApp.request
        .put('/users/me/game-time/overrides')
        .set('Authorization', `Bearer ${token}`)
        .send({
          overrides: [{ date: targetDate, hour: 14, status: 'blocked' }],
        });

      expect(overrideRes.status).toBe(200);

      // Get composite view for this week
      const getRes = await testApp.request
        .get(`/users/me/game-time?week=${weekStart.toISOString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.overrides).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            date: targetDate,
            hour: 14,
            status: 'blocked',
          }),
        ]),
      );
    });

    it('should upsert on same (userId, date, hour) rather than duplicate', async () => {
      const { token, userId } = await createMemberAndLogin(
        testApp,
        'upsert_user',
        'upsert_user@test.local',
      );

      const dateStr = '2026-03-15';

      // Save override: blocked
      await testApp.request
        .put('/users/me/game-time/overrides')
        .set('Authorization', `Bearer ${token}`)
        .send({
          overrides: [{ date: dateStr, hour: 20, status: 'blocked' }],
        });

      // Save same date/hour with different status: available
      await testApp.request
        .put('/users/me/game-time/overrides')
        .set('Authorization', `Bearer ${token}`)
        .send({
          overrides: [{ date: dateStr, hour: 20, status: 'available' }],
        });

      // Check DB directly — should only be one row
      const rows = await testApp.db
        .select()
        .from(schema.gameTimeOverrides)
        .where(
          and(
            eq(schema.gameTimeOverrides.userId, userId),
            eq(schema.gameTimeOverrides.date, dateStr),
            eq(schema.gameTimeOverrides.hour, 20),
          ),
        );

      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('available');
    });
  });

  // ===================================================================
  // Absences
  // ===================================================================

  describe('absences', () => {
    it('should create, list, and delete absences', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'absence_user',
        'absence_user@test.local',
      );

      // Create absence
      const createRes = await testApp.request
        .post('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startDate: '2026-04-01',
          endDate: '2026-04-07',
          reason: 'Vacation',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data).toMatchObject({
        id: expect.any(Number),
        startDate: '2026-04-01',
        endDate: '2026-04-07',
        reason: 'Vacation',
      });

      const absenceId = createRes.body.data.id;

      // List absences
      const listRes = await testApp.request
        .get('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].id).toBe(absenceId);

      // Delete absence
      const deleteRes = await testApp.request
        .delete(`/users/me/game-time/absences/${absenceId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(204);

      // Verify deleted
      const listRes2 = await testApp.request
        .get('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes2.body.data.length).toBe(0);
    });

    it('should block template slots during absence in composite view', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'absence_block',
        'absence_block@test.local',
      );

      // Pick a specific week
      const weekStart = new Date('2026-04-05T00:00:00.000Z'); // A Sunday

      // Save template: Tue 14:00 (dayOfWeek=2 display convention)
      await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({ slots: [{ dayOfWeek: 2, hour: 14 }] });

      // Create absence that covers the Tuesday (2026-04-07)
      await testApp.request
        .post('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startDate: '2026-04-06', // Mon
          endDate: '2026-04-08', // Wed
        });

      // Get composite view for that week
      const getRes = await testApp.request
        .get(`/users/me/game-time?week=${weekStart.toISOString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);

      // The template slot on Tue should be blocked due to absence
      const tueSlot = getRes.body.data.slots.find(
        (s: any) => s.dayOfWeek === 2 && s.hour === 14 && s.fromTemplate,
      );
      expect(tueSlot).toBeDefined();
      expect(tueSlot.status).toBe('blocked');
    });
  });

  // ===================================================================
  // Composite View — Signup Preview (Window Function)
  // ===================================================================

  describe('composite view', () => {
    it('should return events with signup preview (max 6) via window function', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'composite_user',
        'composite_user@test.local',
      );

      // Use a known future week to avoid date boundary issues
      const sunday = new Date();
      sunday.setDate(sunday.getDate() - sunday.getDay() + 7); // next Sunday
      sunday.setUTCHours(0, 0, 0, 0);

      const eventStart = new Date(sunday);
      eventStart.setDate(eventStart.getDate() + 3); // Wednesday
      eventStart.setUTCHours(20, 0, 0, 0);
      const eventEnd = new Date(eventStart);
      eventEnd.setUTCHours(22, 0, 0, 0);

      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Composite View Event',
        startTime: eventStart.toISOString(),
        endTime: eventEnd.toISOString(),
      });

      // Sign up the user
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Create 5 additional signups (admin is already auto-signed up)
      for (let i = 0; i < 5; i++) {
        const { token: memberToken } = await createMemberAndLogin(
          testApp,
          `preview_p${i}`,
          `preview_p${i}@test.local`,
        );
        await testApp.request
          .post(`/events/${eventId}/signup`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({});
      }

      // Get composite view for the week
      const getRes = await testApp.request
        .get(`/users/me/game-time?week=${sunday.toISOString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.events.length).toBeGreaterThanOrEqual(1);

      const eventBlock = getRes.body.data.events.find(
        (e: any) => e.eventId === eventId,
      );
      expect(eventBlock).toBeDefined();
      // Window function limits preview to 6 users max
      expect(eventBlock.signupsPreview.length).toBeLessThanOrEqual(6);
      // Total count should reflect all signups (admin + user + 5 others = 7)
      expect(eventBlock.signupCount).toBeGreaterThanOrEqual(7);
    });

    it('should return committed slots for events outside template', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'offhours_user',
        'offhours_user@test.local',
      );

      // Use a known future week
      const sunday = new Date();
      sunday.setDate(sunday.getDate() - sunday.getDay() + 7); // next Sunday
      sunday.setUTCHours(0, 0, 0, 0);

      const eventStart = new Date(sunday);
      eventStart.setDate(eventStart.getDate() + 4); // Thursday
      eventStart.setUTCHours(10, 0, 0, 0);
      const eventEnd = new Date(eventStart);
      eventEnd.setUTCHours(12, 0, 0, 0);

      // Save template with NO Thursday slots
      await testApp.request
        .put('/users/me/game-time')
        .set('Authorization', `Bearer ${token}`)
        .send({ slots: [{ dayOfWeek: 1, hour: 20 }] }); // Only Mon 8pm

      // Create event on Thursday and sign up
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Off-Hours Event',
        startTime: eventStart.toISOString(),
        endTime: eventEnd.toISOString(),
      });

      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Get composite view
      const getRes = await testApp.request
        .get(`/users/me/game-time?week=${sunday.toISOString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);

      // Should have committed slots NOT from template
      const committedNonTemplate = getRes.body.data.slots.filter(
        (s: any) => s.status === 'committed' && s.fromTemplate === false,
      );
      expect(committedNonTemplate.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require authentication for game-time endpoints', async () => {
      const res = await testApp.request.get('/users/me/game-time');
      expect(res.status).toBe(401);
    });

    it('should require authentication for template save', async () => {
      const res = await testApp.request
        .put('/users/me/game-time')
        .send({ slots: [] });
      expect(res.status).toBe(401);
    });
  });
});
