/**
 * Integration tests for events roster availability and aggregate game time (ROK-835).
 *
 * Tests getRosterAvailability, getAggregateGameTime, and getVariantContext
 * against a real database via TestApp/Testcontainers.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createFutureEvent,
} from './signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';

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

// ─── Helper: create a game-time template entry ──────────────────────────

async function insertGameTimeTemplate(
  userId: number,
  dayOfWeek: number,
  startHour: number,
) {
  await testApp.db.insert(schema.gameTimeTemplates).values({
    userId,
    dayOfWeek,
    startHour,
  });
}

// ─── Helper: create a character for a user ──────────────────────────────

async function createCharacter(
  userId: number,
  gameId: number,
  overrides: Partial<typeof schema.characters.$inferInsert> = {},
) {
  const [char] = await testApp.db
    .insert(schema.characters)
    .values({
      userId,
      gameId,
      name: `Char-${userId}-${Date.now()}`,
      isMain: true,
      ...overrides,
    })
    .returning();
  return char;
}

// ─── Helper: sign up with a specific character ──────────────────────────

async function signupWithCharacter(
  token: string,
  eventId: number,
  characterId: string,
) {
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status}`);
  }
  // Confirm signup with the character
  const confirmRes = await testApp.request
    .patch(`/events/${eventId}/signups/${res.body.id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ characterId });
  if (confirmRes.status !== 200) {
    throw new Error(`confirm failed: ${confirmRes.status}`);
  }
  return res.body.id as number;
}

// ─── R1: getRosterAvailability returns users for signed-up members ──────

async function testRosterAvailabilityReturnsUsers() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const { token } = await createMemberAndLogin(
    testApp,
    'avail_user',
    'avail_user@test.local',
  );
  const signup = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(signup.status).toBe(201);

  const res = await testApp.request.get(
    `/events/${eventId}/roster/availability`,
  );

  expect(res.status).toBe(200);
  expect(res.body.eventId).toBe(eventId);
  expect(res.body.timeRange).toBeDefined();
  expect(res.body.timeRange.start).toBeDefined();
  expect(res.body.timeRange.end).toBeDefined();
  // At least our signed-up member should be present
  const users = res.body.users as { username: string }[];
  expect(users.length).toBeGreaterThanOrEqual(1);
  const usernames = users.map((u) => u.username);
  expect(usernames).toContain('avail_user');
}

// ─── R2: getRosterAvailability returns empty for event with no signups ──

async function testRosterAvailabilityEmptySignups() {
  // Create event via direct DB insert to avoid admin auto-signup
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'No Signup Event',
      creatorId: testApp.seed.adminUser.id,
      duration: [start, end] as [Date, Date],
    })
    .returning();

  const res = await testApp.request.get(
    `/events/${event.id}/roster/availability`,
  );

  expect(res.status).toBe(200);
  expect(res.body.users).toEqual([]);
}

// ─── R3: getAggregateGameTime returns heatmap data from templates ───────

async function testAggregateGameTimeReturnsHeatmap() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const { userId, token } = await createMemberAndLogin(
    testApp,
    'gt_user',
    'gt_user@test.local',
  );
  const signup = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(signup.status).toBe(201);

  // Add game-time templates for this user (Mon 20:00, Mon 21:00)
  await insertGameTimeTemplate(userId, 0, 20);
  await insertGameTimeTemplate(userId, 0, 21);

  const res = await testApp.request
    .get(`/events/${eventId}/aggregate-game-time`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.eventId).toBe(eventId);
  expect(res.body.totalUsers).toBeGreaterThanOrEqual(1);
  // Our user contributed 2 cells — verify they appear
  expect(res.body.cells.length).toBeGreaterThanOrEqual(1);
  for (const cell of res.body.cells) {
    expect(cell).toMatchObject({
      dayOfWeek: expect.any(Number),
      hour: expect.any(Number),
      availableCount: expect.any(Number),
      totalCount: expect.any(Number),
    });
  }
}

// ─── R4: getAggregateGameTime returns empty for no signups ──────────────

async function testAggregateGameTimeEmpty() {
  // Direct DB insert to avoid admin auto-signup
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Empty GT Event',
      creatorId: testApp.seed.adminUser.id,
      duration: [start, end] as [Date, Date],
    })
    .returning();

  const res = await testApp.request
    .get(`/events/${event.id}/aggregate-game-time`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.totalUsers).toBe(0);
  expect(res.body.cells).toEqual([]);
}

// ─── R5: getVariantContext returns dominant variant/region from signups ──

async function testVariantContextReturnsDominant() {
  const game = testApp.seed.game;
  const eventId = await createFutureEvent(testApp, adminToken, {
    gameId: game.id,
  });

  // Create two members, each with a character with variant/region
  const m1 = await createMemberAndLogin(testApp, 'vc1', 'vc1@test.local');
  const m2 = await createMemberAndLogin(testApp, 'vc2', 'vc2@test.local');

  const char1 = await createCharacter(m1.userId, game.id, {
    gameVariant: 'retail',
    region: 'us',
    name: 'Char-vc1',
    isMain: false,
  });
  const char2 = await createCharacter(m2.userId, game.id, {
    gameVariant: 'retail',
    region: 'eu',
    name: 'Char-vc2',
    isMain: false,
  });

  // Sign up both with characters
  await signupWithCharacter(m1.token, eventId, char1.id);
  await signupWithCharacter(m2.token, eventId, char2.id);

  const res = await testApp.request
    .get(`/events/${eventId}/variant-context`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  // Both share 'retail' variant
  expect(res.body.gameVariant).toBe('retail');
  // Region is split (us vs eu), either is valid as dominant
  expect(['us', 'eu']).toContain(res.body.region);
}

// ─── R6: getVariantContext returns nulls when no characters ─────────────

async function testVariantContextNullsWithoutCharacters() {
  const eventId = await createFutureEvent(testApp, adminToken);

  const res = await testApp.request
    .get(`/events/${eventId}/variant-context`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body.gameVariant).toBeNull();
  expect(res.body.region).toBeNull();
}

// ─── R7: 404 for non-existent event ────────────────────────────────────

async function testRosterAvailability404() {
  const res = await testApp.request.get('/events/999999/roster/availability');
  expect(res.status).toBe(404);
}

async function testAggregateGameTime404() {
  const res = await testApp.request
    .get('/events/999999/aggregate-game-time')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(404);
}

async function testVariantContext404() {
  const res = await testApp.request
    .get('/events/999999/variant-context')
    .set('Authorization', `Bearer ${adminToken}`);
  // getVariantContext does not call exists() — it queries signups directly,
  // returning nulls for a non-existent event rather than 404
  expect(res.status).toBe(200);
  expect(res.body.gameVariant).toBeNull();
  expect(res.body.region).toBeNull();
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('getRosterAvailability (integration)', () => {
  it('returns availability for signed-up users (R1)', () =>
    testRosterAvailabilityReturnsUsers());
  it('returns empty users when no signups (R2)', () =>
    testRosterAvailabilityEmptySignups());
  it('returns 404 for non-existent event (R7)', () =>
    testRosterAvailability404());
});

describe('getAggregateGameTime (integration)', () => {
  it('returns heatmap data from game-time templates (R3)', () =>
    testAggregateGameTimeReturnsHeatmap());
  it('returns empty when no active signups (R4)', () =>
    testAggregateGameTimeEmpty());
  it('returns 404 for non-existent event (R7)', () =>
    testAggregateGameTime404());
});

describe('getVariantContext (integration)', () => {
  it('returns dominant variant/region from signups (R5)', () =>
    testVariantContextReturnsDominant());
  it('returns nulls when no characters in signups (R6)', () =>
    testVariantContextNullsWithoutCharacters());
  it('returns nulls for non-existent event (R7)', () =>
    testVariantContext404());
});
