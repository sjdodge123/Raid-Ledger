/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Event Plans Integration Tests (ROK-523)
 *
 * Tests event plan persistence and lifecycle against a real PostgreSQL database.
 * Event plans depend on the Discord bot for poll posting, so we test:
 * - Direct DB persistence of plans (create, findOne, findAll, cancel)
 * - getTimeSuggestions aggregation (game time templates + game interests)
 * - Plan status transitions and BullMQ job lifecycle patterns
 * - HTTP endpoints where the Discord dependency can be bypassed
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
    .values({
      discordId: discordId ?? `local:${email}`,
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

/** Helper to create a future event via HTTP and return its ID. */
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

/** Helper to insert an event plan record directly into the DB. */
async function insertPlanDirectly(
  testApp: TestApp,
  creatorId: number,
  overrides: Partial<typeof schema.eventPlans.$inferInsert> = {},
): Promise<typeof schema.eventPlans.$inferSelect> {
  const pollOptions = [
    {
      date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      label: 'Option A',
    },
    {
      date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      label: 'Option B',
    },
    {
      date: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      label: 'Option C',
    },
  ];

  const [plan] = await testApp.db
    .insert(schema.eventPlans)
    .values({
      creatorId,
      title: 'Test Plan',
      durationMinutes: 180,
      pollOptions,
      pollDurationHours: 24,
      pollMode: 'standard',
      status: 'polling',
      pollChannelId: 'test-channel-123',
      pollMessageId: 'test-message-456',
      pollStartedAt: new Date(),
      pollEndsAt: new Date(Date.now() + 24 * 3600 * 1000),
      ...overrides,
    })
    .returning();

  return plan;
}

describe('Event Plans (integration)', () => {
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
  // Plan Persistence
  // ===================================================================

  describe('plan persistence', () => {
    it('should persist an event plan with all fields', async () => {
      const plan = await insertPlanDirectly(
        testApp,
        testApp.seed.adminUser.id,
        {
          title: 'Persistence Test',
          description: 'Testing all fields persist',
          gameId: testApp.seed.game.id,
          durationMinutes: 120,
          pollDurationHours: 12,
          pollMode: 'all_or_nothing',
          maxAttendees: 25,
          slotConfig: {
            type: 'mmo',
            tank: 2,
            healer: 4,
            dps: 14,
            flex: 0,
            bench: 5,
          },
          contentInstances: [{ name: 'Mythic Raid' }],
          reminder15min: false,
          reminder1hour: true,
          reminder24hour: true,
        },
      );

      // Retrieve and verify
      const [retrieved] = await testApp.db
        .select()
        .from(schema.eventPlans)
        .where(eq(schema.eventPlans.id, plan.id))
        .limit(1);

      expect(retrieved).toBeDefined();
      expect(retrieved.title).toBe('Persistence Test');
      expect(retrieved.description).toBe('Testing all fields persist');
      expect(retrieved.gameId).toBe(testApp.seed.game.id);
      expect(retrieved.durationMinutes).toBe(120);
      expect(retrieved.pollDurationHours).toBe(12);
      expect(retrieved.pollMode).toBe('all_or_nothing');
      expect(retrieved.maxAttendees).toBe(25);
      expect(retrieved.status).toBe('polling');
      expect(retrieved.reminder15min).toBe(false);
      expect(retrieved.reminder1hour).toBe(true);
      expect(retrieved.reminder24hour).toBe(true);

      const slotConfig = retrieved.slotConfig as Record<string, unknown>;
      expect(slotConfig.type).toBe('mmo');
      expect(slotConfig.tank).toBe(2);
      expect(slotConfig.healer).toBe(4);

      const contentInstances = retrieved.contentInstances as unknown[];
      expect(contentInstances).toHaveLength(1);
    });

    it('should auto-generate UUID primary key', async () => {
      const plan = await insertPlanDirectly(testApp, testApp.seed.adminUser.id);

      expect(plan.id).toBeDefined();
      // UUID format check (basic)
      expect(plan.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  // ===================================================================
  // Plan HTTP Endpoints (findOne, findAll, cancel)
  // ===================================================================

  describe('plan HTTP endpoints', () => {
    it('should retrieve a plan by ID via GET /event-plans/:id', async () => {
      const plan = await insertPlanDirectly(
        testApp,
        testApp.seed.adminUser.id,
        { title: 'Find Me' },
      );

      const res = await testApp.request
        .get(`/event-plans/${plan.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(plan.id);
      expect(res.body.title).toBe('Find Me');
      expect(res.body.status).toBe('polling');
    });

    it('should return 404 for non-existent plan ID', async () => {
      const res = await testApp.request
        .get('/event-plans/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should list all plans via GET /event-plans/my-plans', async () => {
      await insertPlanDirectly(testApp, testApp.seed.adminUser.id, {
        title: 'Plan Alpha',
      });
      await insertPlanDirectly(testApp, testApp.seed.adminUser.id, {
        title: 'Plan Beta',
      });

      const res = await testApp.request
        .get('/event-plans/my-plans')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      const titles = res.body.map((p: any) => p.title as string);
      expect(titles).toContain('Plan Alpha');
      expect(titles).toContain('Plan Beta');
    });

    it('should cancel a polling plan via PATCH /event-plans/:id/cancel', async () => {
      const plan = await insertPlanDirectly(
        testApp,
        testApp.seed.adminUser.id,
        { title: 'Cancel Me' },
      );

      const res = await testApp.request
        .patch(`/event-plans/${plan.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');

      // Verify persisted status
      const [retrieved] = await testApp.db
        .select()
        .from(schema.eventPlans)
        .where(eq(schema.eventPlans.id, plan.id))
        .limit(1);
      expect(retrieved.status).toBe('cancelled');
    });

    it('should reject cancel for already-cancelled plan', async () => {
      const plan = await insertPlanDirectly(
        testApp,
        testApp.seed.adminUser.id,
        { status: 'cancelled' },
      );

      const res = await testApp.request
        .patch(`/event-plans/${plan.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('should forbid non-creator from cancelling a plan', async () => {
      const plan = await insertPlanDirectly(testApp, testApp.seed.adminUser.id);

      const { token: memberToken } = await createMemberAndLogin(
        testApp,
        'noauth_plan',
        'noauth_plan@test.local',
      );

      const res = await testApp.request
        .patch(`/event-plans/${plan.id}/cancel`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });

    it('should require authentication for plan endpoints', async () => {
      const plan = await insertPlanDirectly(testApp, testApp.seed.adminUser.id);

      const getRes = await testApp.request.get(`/event-plans/${plan.id}`);
      expect(getRes.status).toBe(401);

      const listRes = await testApp.request.get('/event-plans/my-plans');
      expect(listRes.status).toBe(401);
    });
  });

  // ===================================================================
  // Plan Status Transitions
  // ===================================================================

  describe('plan status transitions', () => {
    it('should only allow cancelling plans in polling status', async () => {
      const plan = await insertPlanDirectly(
        testApp,
        testApp.seed.adminUser.id,
        { status: 'expired' },
      );

      const res = await testApp.request
        .patch(`/event-plans/${plan.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('should persist plan with created event reference', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      const plan = await insertPlanDirectly(
        testApp,
        testApp.seed.adminUser.id,
        {
          status: 'completed',
          createdEventId: eventId,
          winningOption: 0,
        },
      );

      const [retrieved] = await testApp.db
        .select()
        .from(schema.eventPlans)
        .where(eq(schema.eventPlans.id, plan.id))
        .limit(1);

      expect(retrieved.status).toBe('completed');
      expect(retrieved.createdEventId).toBe(eventId);
      expect(retrieved.winningOption).toBe(0);
    });
  });

  // ===================================================================
  // Time Suggestions (getTimeSuggestions)
  // ===================================================================

  describe('time suggestions', () => {
    it('should return fallback suggestions when no game interest data exists', async () => {
      const res = await testApp.request.get('/event-plans/time-suggestions');

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('fallback');
      expect(res.body.interestedPlayerCount).toBe(0);
      expect(res.body.suggestions.length).toBeGreaterThan(0);
      // Each suggestion should have date and label
      expect(res.body.suggestions[0]).toHaveProperty('date');
      expect(res.body.suggestions[0]).toHaveProperty('label');
    });

    it('should return game-interest-based suggestions when data exists', async () => {
      // Create users with game interests and game time templates
      const { userId: u1 } = await createMemberAndLogin(
        testApp,
        'interest_p1',
        'interest_p1@test.local',
      );
      const { userId: u2 } = await createMemberAndLogin(
        testApp,
        'interest_p2',
        'interest_p2@test.local',
      );

      // Both express interest in the test game
      await testApp.db.insert(schema.gameInterests).values([
        { userId: u1, gameId: testApp.seed.game.id },
        { userId: u2, gameId: testApp.seed.game.id },
      ]);

      // Both have game time templates for Wednesday evening (day 2 = Wed, hour 20)
      await testApp.db.insert(schema.gameTimeTemplates).values([
        { userId: u1, dayOfWeek: 2, startHour: 20 },
        { userId: u1, dayOfWeek: 2, startHour: 21 },
        { userId: u2, dayOfWeek: 2, startHour: 20 },
        { userId: u2, dayOfWeek: 2, startHour: 21 },
      ]);

      const res = await testApp.request.get(
        `/event-plans/time-suggestions?gameId=${testApp.seed.game.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('game-interest');
      expect(res.body.interestedPlayerCount).toBe(2);
      expect(res.body.suggestions.length).toBeGreaterThan(0);
    });

    it('should fall back when game has no interested users', async () => {
      // Create a second game with no interests
      const [otherGame] = await testApp.db
        .insert(schema.games)
        .values({
          name: 'Unpopular Game',
          slug: 'unpopular-game',
          coverUrl: null,
          igdbId: null,
        })
        .returning();

      const res = await testApp.request.get(
        `/event-plans/time-suggestions?gameId=${otherGame.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('fallback');
    });
  });

  // ===================================================================
  // Poll Results (getPollResults) — DB-level validation
  // ===================================================================

  describe('poll results access control', () => {
    it('should return empty results for non-polling plan', async () => {
      const plan = await insertPlanDirectly(
        testApp,
        testApp.seed.adminUser.id,
        { status: 'completed' },
      );

      const res = await testApp.request
        .get(`/event-plans/${plan.id}/poll-results`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pollOptions).toHaveLength(0);
      expect(res.body.totalRegisteredVoters).toBe(0);
    });

    it('should forbid non-creator from viewing poll results', async () => {
      const plan = await insertPlanDirectly(testApp, testApp.seed.adminUser.id);

      const { token: memberToken } = await createMemberAndLogin(
        testApp,
        'noauth_poll',
        'noauth_poll@test.local',
      );

      const res = await testApp.request
        .get(`/event-plans/${plan.id}/poll-results`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ===================================================================
  // Plan Cascade Deletes
  // ===================================================================

  describe('cascade behavior', () => {
    it('should cascade delete plans when creator user is deleted', async () => {
      const { userId } = await createMemberAndLogin(
        testApp,
        'cascade_user',
        'cascade@test.local',
      );

      const plan = await insertPlanDirectly(testApp, userId, {
        title: 'Cascaded Plan',
      });

      // Delete local credentials first (no cascade), then the user
      await testApp.db
        .delete(schema.localCredentials)
        .where(eq(schema.localCredentials.userId, userId));
      await testApp.db.delete(schema.users).where(eq(schema.users.id, userId));

      // Plan should be gone
      const [retrieved] = await testApp.db
        .select()
        .from(schema.eventPlans)
        .where(eq(schema.eventPlans.id, plan.id))
        .limit(1);

      expect(retrieved).toBeUndefined();
    });
  });
});
