/**
 * Signups Integration Tests — signup flows, status updates, confirm signup, ROK-600, ROK-970.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
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

// ─── signup flow tests ──────────────────────────────────────────────────────

async function testSignupAndAppearInRoster() {
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
  const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
  expect(
    (
      rosterRes.body as { signups: Array<{ user: { username: string } }> }
    ).signups.find((s) => s.user.username === 'player1'),
  ).toBeDefined();
}

async function testIdempotentSignup() {
  const { token } = await createMemberAndLogin(
    testApp,
    'player2',
    'player2@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  const first = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const second = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(second.status).toBe(201);
  expect(second.body.id).toBe(first.body.id);
}

async function testCancelRemovesFromRoster() {
  const { token } = await createMemberAndLogin(
    testApp,
    'player3',
    'player3@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const cancelRes = await testApp.request
    .delete(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`);
  expect(cancelRes.status).toBe(200);
  const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
  expect(
    (
      rosterRes.body as { signups: Array<{ user: { username: string } }> }
    ).signups.find((s) => s.user.username === 'player3'),
  ).toBeUndefined();
}

async function testAutoSignupCreator() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
  expect(
    (
      rosterRes.body as { signups: Array<{ user: { id: number } }> }
    ).signups.find((s) => s.user.id === testApp.seed.adminUser.id),
  ).toBeDefined();
}

async function testBenchWhenAtCapacity() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    maxAttendees: 1,
  });
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
  const assignmentsRes = await testApp.request.get(
    `/events/${eventId}/roster/assignments`,
  );
  const assignments = (
    assignmentsRes.body as {
      assignments?: Array<{
        signup?: { user?: { username: string } };
        role: string;
      }>;
    }
  ).assignments;
  const overflowAssignment = assignments?.find(
    (a) => a.signup?.user?.username === 'overflow',
  );
  if (overflowAssignment) expect(overflowAssignment.role).toBe('bench');
}

// ─── status update test ─────────────────────────────────────────────────────

async function testStatusUpdateTentative() {
  const { token } = await createMemberAndLogin(
    testApp,
    'tentative_player',
    'tentative@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const updateRes = await testApp.request
    .patch(`/events/${eventId}/signup/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'tentative' });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.status).toBe('tentative');
}

// ─── confirm signup tests ───────────────────────────────────────────────────

async function testConfirmWithCharacter() {
  const { token } = await createMemberAndLogin(
    testApp,
    'char_player',
    'char_player@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken, {
    gameId: testApp.seed.game.id,
  });
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(signupRes.body.confirmationStatus).toBe('pending');
  const charRes = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId: testApp.seed.game.id,
      name: 'TestChar',
      class: 'Warrior',
      role: 'tank',
    });
  const confirmRes = await testApp.request
    .patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ characterId: charRes.body.id });
  expect(confirmRes.status).toBe(200);
  expect(confirmRes.body.confirmationStatus).toBe('confirmed');
  expect(confirmRes.body.characterId).toBe(charRes.body.id);
}

async function testReconfirmation() {
  const { token } = await createMemberAndLogin(
    testApp,
    'reconfirm',
    'reconfirm@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken, {
    gameId: testApp.seed.game.id,
  });
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
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
  await testApp.request
    .patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ characterId: char1Res.body.id });
  const reconfirmRes = await testApp.request
    .patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ characterId: char2Res.body.id });
  expect(reconfirmRes.status).toBe(200);
  expect(reconfirmRes.body.confirmationStatus).toBe('changed');
  expect(reconfirmRes.body.characterId).toBe(char2Res.body.id);
}

// ─── character-optional signup tests (ROK-600) ─────────────────────────────

async function testNonMmoWithoutChar() {
  const { token } = await createMemberAndLogin(
    testApp,
    'casual_player',
    'casual@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken, {
    gameId: testApp.seed.game.id,
  });
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(signupRes.status).toBe(201);
  expect(signupRes.body.character).toBeNull();
}

async function testMmoWithoutChar() {
  const [mmoGame] = await testApp.db
    .insert(schema.games)
    .values({
      name: 'World of Warcraft',
      slug: 'world-of-warcraft',
      hasRoles: true,
      hasSpecs: true,
    })
    .returning();
  const { token } = await createMemberAndLogin(
    testApp,
    'mmo_no_char',
    'mmo_no_char@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken, {
    gameId: mmoGame.id,
  });
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(signupRes.status).toBe(201);
  expect(signupRes.body.character).toBeNull();
}

async function testMmoWithChar() {
  const [mmoGame] = await testApp.db
    .insert(schema.games)
    .values({
      name: 'Final Fantasy XIV',
      slug: 'ffxiv',
      hasRoles: true,
      hasSpecs: true,
    })
    .returning();
  const { token } = await createMemberAndLogin(
    testApp,
    'mmo_with_char',
    'mmo_with_char@test.local',
  );
  const charRes = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId: mmoGame.id,
      name: 'WhiteMage',
      class: 'White Mage',
      role: 'healer',
    });
  const eventId = await createFutureEvent(testApp, adminToken, {
    gameId: mmoGame.id,
  });
  const signupRes = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({ characterId: charRes.body.id });
  expect(signupRes.status).toBe(201);
  expect(signupRes.body.characterId).toBe(charRes.body.id);
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('Signups — signup flows', () => {
  it('should sign up and appear in roster', () =>
    testSignupAndAppearInRoster());
  it('should return existing on duplicate', () => testIdempotentSignup());
  it('should cancel and remove from roster', () =>
    testCancelRemovesFromRoster());
  it('should auto-signup creator', () => testAutoSignupCreator());
  it('should bench when at capacity', () => testBenchWhenAtCapacity());
});

describe('Signups — status updates', () => {
  it('should update to tentative', () => testStatusUpdateTentative());
});

describe('Signups — confirm signup', () => {
  it('should confirm with character', () => testConfirmWithCharacter());
  it('should transition to changed on re-confirm', () => testReconfirmation());
});

describe('Signups — character-optional (ROK-600)', () => {
  it('should sign up for non-MMO without char', () => testNonMmoWithoutChar());
  it('should sign up for MMO without char', () => testMmoWithoutChar());
  it('should sign up for MMO with char', () => testMmoWithChar());
});

// ─── signup on closed events (ROK-970) ──────────────────────────────────────

async function testSignupOnEndedQuickPlay() {
  const { token } = await createMemberAndLogin(
    testApp,
    'ended_qp',
    'ended_qp@test.local',
  );
  const eventId = await createPastEvent(
    testApp,
    testApp.seed.adminUser.id,
    { isAdHoc: true },
  );
  await testApp.db
    .update(schema.events)
    .set({ adHocStatus: 'ended' })
    .where(eq(schema.events.id, eventId));
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(409);
  expect(res.body.message).toMatch(/ended/i);
}

async function testSignupOnElapsedEvent() {
  const { token } = await createMemberAndLogin(
    testApp,
    'elapsed_player',
    'elapsed@test.local',
  );
  const eventId = await createPastEvent(
    testApp,
    testApp.seed.adminUser.id,
  );
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(409);
  expect(res.body.message).toMatch(/ended/i);
}

async function testSignupOnCancelledEvent() {
  const { token } = await createMemberAndLogin(
    testApp,
    'cancelled_player',
    'cancelled@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.db
    .update(schema.events)
    .set({ cancelledAt: new Date() })
    .where(eq(schema.events.id, eventId));
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(409);
  expect(res.body.message).toMatch(/cancelled/i);
}

async function testSignupOnActiveEventStillWorks() {
  const { token } = await createMemberAndLogin(
    testApp,
    'active_player',
    'active@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(201);
}

describe('Signups — signup on closed events (ROK-970)', () => {
  it('should reject signup on ended Quick Play event', () =>
    testSignupOnEndedQuickPlay());
  it('should reject signup on elapsed event', () =>
    testSignupOnElapsedEvent());
  it('should reject signup on cancelled event', () =>
    testSignupOnCancelledEvent());
  it('should still allow signup on active event', () =>
    testSignupOnActiveEventStillWorks());
});
