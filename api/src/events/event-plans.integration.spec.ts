/**
 * Event Plans Integration Tests (ROK-523, ROK-833)
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import {
  createEventFromPlan,
  insertConvertedPlan,
} from './event-plans-crud.helpers';
import { handleNoWinner } from './event-plans-lifecycle.helpers';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';

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

async function createMemberAndLogin(
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

async function createFutureEvent(
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
    throw new Error(`createFutureEvent failed: ${res.status}`);
  }
  return res.body.id as number;
}

function basePlanValues(
  creatorId: number,
  overrides: Partial<typeof schema.eventPlans.$inferInsert> = {},
) {
  return {
    creatorId,
    title: 'Test Plan',
    durationMinutes: 180,
    pollOptions: [
      {
        date: new Date(Date.now() + 24 * 3600000).toISOString(),
        label: 'Option A',
      },
      {
        date: new Date(Date.now() + 48 * 3600000).toISOString(),
        label: 'Option B',
      },
      {
        date: new Date(Date.now() + 72 * 3600000).toISOString(),
        label: 'Option C',
      },
    ],
    pollDurationHours: 24,
    pollMode: 'standard' as const,
    status: 'polling' as const,
    pollChannelId: 'test-channel-123',
    pollMessageId: 'test-message-456',
    pollStartedAt: new Date(),
    pollEndsAt: new Date(Date.now() + 24 * 3600 * 1000),
    ...overrides,
  };
}

async function insertPlanDirectly(
  creatorId: number,
  overrides: Partial<typeof schema.eventPlans.$inferInsert> = {},
) {
  const [plan] = await testApp.db
    .insert(schema.eventPlans)
    .values(basePlanValues(creatorId, overrides))
    .returning();
  return plan;
}

// ─── plan persistence tests ─────────────────────────────────────────────────

async function testPersistAllFields() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'Persistence Test',
    description: 'Testing all fields persist',
    gameId: testApp.seed.game.id,
    durationMinutes: 120,
    pollDurationHours: 12,
    pollMode: 'all_or_nothing',
    maxAttendees: 25,
    slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 0, bench: 5 },
    contentInstances: [{ name: 'Mythic Raid' }],
    reminder15min: false,
    reminder1hour: true,
    reminder24hour: true,
  });

  const [retrieved] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);

  expect(retrieved).toBeDefined();
  expect(retrieved.title).toBe('Persistence Test');
  expect(retrieved.pollMode).toBe('all_or_nothing');
  expect(retrieved.maxAttendees).toBe(25);
  const sc = retrieved.slotConfig as Record<string, unknown>;
  expect(sc.type).toBe('mmo');
  expect(sc.tank).toBe(2);
}

async function testAutoUuid() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id);
  expect(plan.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
}

// ─── HTTP endpoint tests ────────────────────────────────────────────────────

async function testGetById() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'Find Me',
  });
  const res = await testApp.request
    .get(`/event-plans/${plan.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.title).toBe('Find Me');
}

async function testGet404() {
  const res = await testApp.request
    .get('/event-plans/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(404);
}

async function testListPlans() {
  await insertPlanDirectly(testApp.seed.adminUser.id, { title: 'Plan Alpha' });
  await insertPlanDirectly(testApp.seed.adminUser.id, { title: 'Plan Beta' });
  const res = await testApp.request
    .get('/event-plans/my-plans')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.length).toBe(2);
}

async function testCancelPlan() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'Cancel Me',
  });
  const res = await testApp.request
    .patch(`/event-plans/${plan.id}/cancel`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('cancelled');
  const [retrieved] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  expect(retrieved.status).toBe('cancelled');
}

async function testCancelAlreadyCancelled() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    status: 'cancelled',
  });
  const res = await testApp.request
    .patch(`/event-plans/${plan.id}/cancel`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(400);
}

async function testCancelForbiddenNonCreator() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id);
  const { token: memberToken } = await createMemberAndLogin(
    'noauth_plan',
    'noauth_plan@test.local',
  );
  const res = await testApp.request
    .patch(`/event-plans/${plan.id}/cancel`)
    .set('Authorization', `Bearer ${memberToken}`);
  expect(res.status).toBe(403);
}

async function testAuthRequired() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id);
  const getRes = await testApp.request.get(`/event-plans/${plan.id}`);
  expect(getRes.status).toBe(401);
  const listRes = await testApp.request.get('/event-plans/my-plans');
  expect(listRes.status).toBe(401);
}

// ─── status transition tests ────────────────────────────────────────────────

async function testOnlyCancelPolling() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    status: 'expired',
  });
  const res = await testApp.request
    .patch(`/event-plans/${plan.id}/cancel`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(400);
}

async function testPersistCompletedWithEvent() {
  const eventId = await createFutureEvent();
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    status: 'completed',
    createdEventId: eventId,
    winningOption: 0,
  });
  const [retrieved] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  expect(retrieved.status).toBe('completed');
  expect(retrieved.createdEventId).toBe(eventId);
}

// ─── time suggestions tests ─────────────────────────────────────────────────

async function testFallbackSuggestions() {
  const res = await testApp.request.get('/event-plans/time-suggestions');
  expect(res.status).toBe(200);
  expect(res.body.source).toBe('fallback');
  expect(res.body.suggestions.length).toBeGreaterThan(0);
}

async function testGameInterestSuggestions() {
  const { userId: u1 } = await createMemberAndLogin(
    'interest_p1',
    'interest_p1@test.local',
  );
  const { userId: u2 } = await createMemberAndLogin(
    'interest_p2',
    'interest_p2@test.local',
  );
  await testApp.db.insert(schema.gameInterests).values([
    { userId: u1, gameId: testApp.seed.game.id },
    { userId: u2, gameId: testApp.seed.game.id },
  ]);
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
}

async function testFallbackNoInterests() {
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
}

// ─── poll results tests ─────────────────────────────────────────────────────

async function testPollResultsNonPolling() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    status: 'completed',
  });
  const res = await testApp.request
    .get(`/event-plans/${plan.id}/poll-results`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.pollOptions).toHaveLength(0);
}

async function testPollResultsForbidden() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id);
  const { token: memberToken } = await createMemberAndLogin(
    'noauth_poll',
    'noauth_poll@test.local',
  );
  const res = await testApp.request
    .get(`/event-plans/${plan.id}/poll-results`)
    .set('Authorization', `Bearer ${memberToken}`);
  expect(res.status).toBe(403);
}

// ─── cascade tests ──────────────────────────────────────────────────────────

async function testCascadeDeleteUser() {
  const { userId } = await createMemberAndLogin(
    'cascade_user',
    'cascade@test.local',
  );
  const plan = await insertPlanDirectly(userId, { title: 'Cascaded Plan' });
  await testApp.db
    .delete(schema.localCredentials)
    .where(eq(schema.localCredentials.userId, userId));
  await testApp.db.delete(schema.users).where(eq(schema.users.id, userId));
  const [retrieved] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  expect(retrieved).toBeUndefined();
}

// ─── processPollClose helpers ────────────────────────────────────────────────

/** No-op Discord client mock for helpers that accept it as a parameter. */
function mockDiscordClient(): DiscordBotClientService {
  return {
    sendDirectMessage: jest.fn().mockResolvedValue(undefined),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(false),
    getClient: jest.fn().mockReturnValue(null),
  } as unknown as DiscordBotClientService;
}

async function testCreateEventFromPlan() {
  const eventsService = testApp.app.get(EventsService);
  const signupsService = testApp.app.get(SignupsService);
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'Poll Winner Plan',
    gameId: testApp.seed.game.id,
    durationMinutes: 120,
  });
  await createEventFromPlan(
    testApp.db,
    mockDiscordClient(),
    eventsService,
    signupsService,
    plan,
    0,
  );
  const [updated] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  expect(updated.status).toBe('completed');
  expect(updated.winningOption).toBe(0);
  expect(updated.createdEventId).toEqual(expect.any(Number));
  const [event] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, updated.createdEventId!))
    .limit(1);
  expect(event).toBeDefined();
  expect(event.title).toBe('Poll Winner Plan');
}

async function testTieBreakPicksEarliest() {
  const eventsService = testApp.app.get(EventsService);
  const signupsService = testApp.app.get(SignupsService);
  const earlyDate = new Date(Date.now() + 24 * 3600000);
  const lateDate = new Date(Date.now() + 48 * 3600000);
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'Tie Plan',
    durationMinutes: 60,
    pollOptions: [
      { date: lateDate.toISOString(), label: 'Late Option' },
      { date: earlyDate.toISOString(), label: 'Early Option' },
    ],
  });
  // Winner index 1 = the earlier date option
  await createEventFromPlan(
    testApp.db,
    mockDiscordClient(),
    eventsService,
    signupsService,
    plan,
    1,
  );
  const [updated] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  expect(updated.status).toBe('completed');
  expect(updated.winningOption).toBe(1);
  const [event] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, updated.createdEventId!))
    .limit(1);
  expect(event).toBeDefined();
}

async function testNoVotesExpires() {
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'No Votes Plan',
  });
  await handleNoWinner(testApp.db, mockDiscordClient(), plan);
  const [updated] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  expect(updated.status).toBe('expired');
}

async function testCreatorAutoSignup() {
  const eventsService = testApp.app.get(EventsService);
  const signupsService = testApp.app.get(SignupsService);
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'Signup Plan',
    durationMinutes: 90,
  });
  await createEventFromPlan(
    testApp.db,
    mockDiscordClient(),
    eventsService,
    signupsService,
    plan,
    0,
  );
  const [updated] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  const signups = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, updated.createdEventId!));
  expect(signups.length).toBe(1);
  expect(signups[0].userId).toBe(testApp.seed.adminUser.id);
}

async function testSlotConfigPreserved() {
  const eventsService = testApp.app.get(EventsService);
  const signupsService = testApp.app.get(SignupsService);
  const slotConfig = {
    type: 'mmo',
    tank: 2,
    healer: 3,
    dps: 10,
    flex: 0,
    bench: 5,
  };
  const plan = await insertPlanDirectly(testApp.seed.adminUser.id, {
    title: 'Slots Plan',
    durationMinutes: 120,
    slotConfig,
    gameId: testApp.seed.game.id,
  });
  await createEventFromPlan(
    testApp.db,
    mockDiscordClient(),
    eventsService,
    signupsService,
    plan,
    0,
  );
  const [updated] = await testApp.db
    .select()
    .from(schema.eventPlans)
    .where(eq(schema.eventPlans.id, plan.id))
    .limit(1);
  const [event] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, updated.createdEventId!))
    .limit(1);
  const sc = event.slotConfig as Record<string, unknown>;
  expect(sc.type).toBe('mmo');
  expect(sc.tank).toBe(2);
  expect(sc.healer).toBe(3);
}

// ─── convertFromEvent helpers ────────────────────────────────────────────────

async function testConvertPreservesFields() {
  const eventId = await createFutureEvent({
    title: 'Convert Me',
    gameId: testApp.seed.game.id,
  });
  const [event] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const start = new Date(event.duration[0]);
  const end = new Date(event.duration[1]);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const pollOptions = [
    { date: new Date(Date.now() + 24 * 3600000).toISOString(), label: 'A' },
    { date: new Date(Date.now() + 48 * 3600000).toISOString(), label: 'B' },
  ];
  const eventsService = testApp.app.get(EventsService);
  const eventDto = await eventsService.findOne(eventId);
  const plan = await insertConvertedPlan(
    testApp.db,
    testApp.seed.adminUser.id,
    eventDto,
    durationMinutes,
    pollOptions,
    24,
    'test-channel-789',
  );
  expect(plan.title).toBe('Convert Me');
  expect(plan.gameId).toBe(testApp.seed.game.id);
  expect(plan.durationMinutes).toBe(durationMinutes);
  expect(plan.status).toBe('polling');
  expect(plan.pollChannelId).toBe('test-channel-789');
  const opts = plan.pollOptions as Array<{ date: string; label: string }>;
  expect(opts).toHaveLength(2);
}

async function testConvertPreservesSlotConfig() {
  const slotConfig = {
    type: 'mmo',
    tank: 1,
    healer: 2,
    dps: 5,
    flex: 1,
    bench: 2,
  };
  const eventId = await createFutureEvent({
    title: 'Slots Event',
    slotConfig,
    gameId: testApp.seed.game.id,
  });
  const eventsService = testApp.app.get(EventsService);
  const eventDto = await eventsService.findOne(eventId);
  const pollOptions = [
    { date: new Date(Date.now() + 24 * 3600000).toISOString(), label: 'A' },
    { date: new Date(Date.now() + 48 * 3600000).toISOString(), label: 'B' },
  ];
  const plan = await insertConvertedPlan(
    testApp.db,
    testApp.seed.adminUser.id,
    eventDto,
    180,
    pollOptions,
    24,
    'test-channel-slots',
  );
  const sc = plan.slotConfig as Record<string, unknown>;
  expect(sc.type).toBe('mmo');
  expect(sc.tank).toBe(1);
  expect(sc.healer).toBe(2);
  expect(sc.dps).toBe(5);
}

async function testConvertPreservesGame() {
  const eventId = await createFutureEvent({
    title: 'Game Event',
    gameId: testApp.seed.game.id,
  });
  const eventsService = testApp.app.get(EventsService);
  const eventDto = await eventsService.findOne(eventId);
  const pollOptions = [
    { date: new Date(Date.now() + 24 * 3600000).toISOString(), label: 'A' },
    { date: new Date(Date.now() + 48 * 3600000).toISOString(), label: 'B' },
  ];
  const plan = await insertConvertedPlan(
    testApp.db,
    testApp.seed.adminUser.id,
    eventDto,
    120,
    pollOptions,
    12,
    'test-channel-game',
  );
  expect(plan.gameId).toBe(testApp.seed.game.id);
  expect(plan.pollDurationHours).toBe(12);
  expect(plan.pollMode).toBe('standard');
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('Event Plans — persistence', () => {
  it('should persist all fields', () => testPersistAllFields());
  it('should auto-generate UUID', () => testAutoUuid());
});

describe('Event Plans — HTTP endpoints', () => {
  it('should retrieve by ID', () => testGetById());
  it('should return 404 for non-existent', () => testGet404());
  it('should list all plans', () => testListPlans());
  it('should cancel a polling plan', () => testCancelPlan());
  it('should reject cancel for already cancelled', () =>
    testCancelAlreadyCancelled());
  it('should forbid non-creator cancel', () => testCancelForbiddenNonCreator());
  it('should require authentication', () => testAuthRequired());
});

describe('Event Plans — status transitions', () => {
  it('should only cancel polling plans', () => testOnlyCancelPolling());
  it('should persist completed with event ref', () =>
    testPersistCompletedWithEvent());
});

describe('Event Plans — time suggestions', () => {
  it('should return fallback suggestions', () => testFallbackSuggestions());
  it('should return game-interest suggestions', () =>
    testGameInterestSuggestions());
  it('should fallback when no interests', () => testFallbackNoInterests());
});

describe('Event Plans — poll results access', () => {
  it('should return empty for non-polling', () => testPollResultsNonPolling());
  it('should forbid non-creator', () => testPollResultsForbidden());
});

describe('Event Plans — cascade behavior', () => {
  it('should cascade delete when creator deleted', () =>
    testCascadeDeleteUser());
});

describe('Event Plans — processPollClose', () => {
  it('should create event from plan with winning time slot', () =>
    testCreateEventFromPlan());
  it('should pick earlier option on tie', () => testTieBreakPicksEarliest());
  it('should expire plan when no votes', () => testNoVotesExpires());
  it('should auto-signup creator on event creation', () =>
    testCreatorAutoSignup());
  it('should preserve slot config on created event', () =>
    testSlotConfigPreserved());
});

describe('Event Plans — convertFromEvent', () => {
  it('should create plan preserving event fields', () =>
    testConvertPreservesFields());
  it('should preserve slot config from event', () =>
    testConvertPreservesSlotConfig());
  it('should preserve game association', () => testConvertPreservesGame());
});
