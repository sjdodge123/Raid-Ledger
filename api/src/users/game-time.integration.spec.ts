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

/** YYYY-MM-DD for `days` from the current UTC date (negative = past). */
function utcDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** YYYY-MM-DD for `days` from "today" as seen at a given tz offset (minutes). */
function localDateOffset(tzOffset: number, days: number): string {
  const d = new Date(Date.now() - tzOffset * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
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

function describeGameTime() {
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

  function describeTemplateSaveAndRetrieve() {
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

      const slots = (
        getRes.body as { data: { slots: Array<Record<string, unknown>> } }
      ).data.slots;
      const templateSlots = slots.filter((s) => s.fromTemplate === true);
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
  }
  describe('template save and retrieve', () =>
    describeTemplateSaveAndRetrieve());

  // ===================================================================
  // Committed-Slot Preservation
  // ===================================================================

  function describeCommittedSlotPreservation() {
    async function testPreserveTemplateSlotsThatOverlapWithActiveEventSignu() {
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
    }
    it('should preserve template slots that overlap with active event signups', () =>
      testPreserveTemplateSlotsThatOverlapWithActiveEventSignu());
  }
  describe('committed-slot preservation', () =>
    describeCommittedSlotPreservation());

  // ===================================================================
  // Overrides
  // ===================================================================

  function describeOverrides() {
    async function testSaveOverridesAndReflectThemInCompositeView() {
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
    }
    it('should save overrides and reflect them in composite view', () =>
      testSaveOverridesAndReflectThemInCompositeView());

    async function testUpsertOnSameRatherThanDuplicate() {
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
    }
    it('should upsert on same (userId, date, hour) rather than duplicate', () =>
      testUpsertOnSameRatherThanDuplicate());
  }
  describe('overrides', () => describeOverrides());

  // ===================================================================
  // Absences
  // ===================================================================

  function describeAbsences() {
    async function testCreateListAndDeleteAbsences() {
      const { token } = await createMemberAndLogin(
        testApp,
        'absence_user',
        'absence_user@test.local',
      );

      // Create absence (dated forward — the list only surfaces
      // current + future absences since ROK-1427)
      const startDate = utcDateOffset(3);
      const endDate = utcDateOffset(9);
      const createRes = await testApp.request
        .post('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`)
        .send({ startDate, endDate, reason: 'Vacation' });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data).toMatchObject({
        id: expect.any(Number),
        startDate,
        endDate,
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
    }
    it('should create, list, and delete absences', () =>
      testCreateListAndDeleteAbsences());

    async function testBlockTemplateSlotsDuringAbsenceInCompositeView() {
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
      const absSlots = (
        getRes.body as { data: { slots: Array<Record<string, unknown>> } }
      ).data.slots;
      const tueSlot = absSlots.find(
        (s) => s.dayOfWeek === 2 && s.hour === 14 && s.fromTemplate,
      );
      expect(tueSlot).toBeDefined();
      expect(tueSlot!.status).toBe('blocked');
    }
    it('should block template slots during absence in composite view', () =>
      testBlockTemplateSlotsDuringAbsenceInCompositeView());
  }
  describe('absences', () => describeAbsences());

  // ===================================================================
  // Regression: ROK-1427 — expired absences must leave the list
  // ===================================================================

  function describeRok1427() {
    /** Seed an absence row directly so past-dated rows can be created. */
    async function seedAbsence(
      userId: number,
      startDate: string,
      endDate: string,
      reason: string,
    ): Promise<number> {
      const [row] = await testApp.db
        .insert(schema.gameTimeAbsences)
        .values({ userId, startDate, endDate, reason })
        .returning();
      return row.id;
    }

    async function testExpiredAbsencesLeaveTheList() {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'rok1427_list',
        'rok1427_list@test.local',
      );

      const seed = (s: number, e: number, reason: string) =>
        seedAbsence(userId, utcDateOffset(s), utcDateOffset(e), reason);
      const longPast = await seed(-10, -5, 'Tennis Travel');
      const endedYesterday = await seed(-3, -1, 'Ended yesterday');
      const endsToday = await seed(-2, 0, 'Ends today');
      const active = await seed(-1, 3, 'Currently away');
      const future = await seed(10, 12, 'Upcoming trip');

      const res = await testApp.request
        .get('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: number }>).map((a) => a.id);

      // Expired absences are gone — including the inclusive-boundary case
      // that ended yesterday, which must NOT survive into today.
      expect(ids).not.toContain(longPast);
      expect(ids).not.toContain(endedYesterday);

      // end_date is inclusive: an absence ending TODAY is still active today.
      expect(ids).toContain(endsToday);
      expect(ids).toContain(active);
      expect(ids).toContain(future);
      expect(ids).toHaveLength(3);
    }
    it('hides expired absences and keeps today/active/future ones', () =>
      testExpiredAbsencesLeaveTheList());

    async function testPastAbsencesStayInTheDatabase() {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'rok1427_keep',
        'rok1427_keep@test.local',
      );
      await seedAbsence(
        userId,
        utcDateOffset(-10),
        utcDateOffset(-5),
        'Tennis Travel',
      );

      const res = await testApp.request
        .get('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.data).toHaveLength(0);

      // Filtered at query time, never deleted — the history row is intact.
      const rows = await testApp.db
        .select()
        .from(schema.gameTimeAbsences)
        .where(eq(schema.gameTimeAbsences.userId, userId));
      expect(rows).toHaveLength(1);
      expect(rows[0].reason).toBe('Tennis Travel');
    }
    it('keeps expired absences in the database as history', () =>
      testPastAbsencesStayInTheDatabase());

    async function testFiltersInTheCallersTimezone() {
      // Pick the offset from the current UTC hour so the caller's local date is
      // ALWAYS a different calendar day from the UTC date. With a fixed offset
      // this assertion is vacuous for part of every day: a raw-UTC (unfixed)
      // server returns the identical rows whenever local-date === utc-date, so
      // the test would pass against the very bug it exists to catch.
      //   UTC hour < 12 -> +720 (UTC-12) puts the caller on YESTERDAY.
      //   UTC hour >= 12 -> -720 (UTC+12) puts the caller on TOMORROW.
      const tzOffset = new Date().getUTCHours() < 12 ? 720 : -720;
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'rok1427_tz',
        'rok1427_tz@test.local',
      );
      const goneId = await seedAbsence(
        userId,
        localDateOffset(tzOffset, -4),
        localDateOffset(tzOffset, -1),
        'Ended yesterday there',
      );
      const keptId = await seedAbsence(
        userId,
        localDateOffset(tzOffset, -2),
        localDateOffset(tzOffset, 0),
        'Ends today there',
      );

      const res = await testApp.request
        .get(`/users/me/game-time/absences?tzOffset=${tzOffset}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: number }>).map((a) => a.id);
      expect(ids).not.toContain(goneId);
      expect(ids).toEqual([keptId]);
    }
    it('resolves "today" in the caller timezone, not raw UTC', () =>
      testFiltersInTheCallersTimezone());

    async function testPastWeekCompositeViewStillSeesAbsences() {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'rok1427_week',
        'rok1427_week@test.local',
      );
      // The Sunday four weeks back — a fully elapsed week.
      const weekStart = new Date();
      weekStart.setUTCHours(0, 0, 0, 0);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() - 28);
      const dayIn = (n: number) => {
        const d = new Date(weekStart);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().split('T')[0];
      };
      const pastId = await seedAbsence(
        userId,
        dayIn(1),
        dayIn(3),
        'Past week trip',
      );

      const viewRes = await testApp.request
        .get(`/users/me/game-time?week=${weekStart.toISOString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(viewRes.status).toBe(200);
      const viewAbsences = viewRes.body.data.absences as Array<{ id: number }>;
      expect(viewAbsences.map((a) => a.id)).toContain(pastId);

      // ...while the same absence is correctly absent from the list endpoint.
      const listRes = await testApp.request
        .get('/users/me/game-time/absences')
        .set('Authorization', `Bearer ${token}`);
      const listIds = (listRes.body.data as Array<{ id: number }>).map(
        (a) => a.id,
      );
      expect(listIds).not.toContain(pastId);
    }
    it('still renders past absences in a past-week composite view', () =>
      testPastWeekCompositeViewStillSeesAbsences());
  }
  describe('Regression: ROK-1427', () => describeRok1427());

  // ===================================================================
  // Composite View — Signup Preview (Window Function)
  // ===================================================================

  function describeCompositeView() {
    async function testReturnEventsWithSignupPreviewViaWindowFunction() {
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
      const evtData = (
        getRes.body as { data: { events: Array<Record<string, unknown>> } }
      ).data;
      expect(evtData.events.length).toBeGreaterThanOrEqual(1);

      const eventBlock = evtData.events.find((e) => e.eventId === eventId);
      expect(eventBlock).toBeDefined();
      // Window function limits preview to 6 users max
      expect(
        (eventBlock! as Record<string, unknown> & { signupsPreview: unknown[] })
          .signupsPreview.length,
      ).toBeLessThanOrEqual(6);
      // Total count should reflect all signups (admin + user + 5 others = 7)
      expect(eventBlock!.signupCount).toBeGreaterThanOrEqual(7);
    }
    it('should return events with signup preview (max 6) via window function', () =>
      testReturnEventsWithSignupPreviewViaWindowFunction());

    async function testReturnCommittedSlotsForEventsOutsideTemplate() {
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
      const cmtSlots = (
        getRes.body as { data: { slots: Array<Record<string, unknown>> } }
      ).data.slots;
      const committedNonTemplate = cmtSlots.filter(
        (s) => s.status === 'committed' && s.fromTemplate === false,
      );
      expect(committedNonTemplate.length).toBeGreaterThanOrEqual(1);
    }
    it('should return committed slots for events outside template', () =>
      testReturnCommittedSlotsForEventsOutsideTemplate());
  }
  describe('composite view', () => describeCompositeView());

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
}
describe('Game-Time (integration)', () => describeGameTime());
