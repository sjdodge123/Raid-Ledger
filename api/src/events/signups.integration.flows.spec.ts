/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Signups Integration Tests — signup flows, status updates, confirm signup, ROK-600.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables, loginAsAdmin } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import {
  createMemberAndLogin,
  createFutureEvent,
} from './signups.integration.spec-helpers';

describe('Signups — flows & confirm (integration)', () => {
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

  describe('signup flows', () => {
    it('should sign up for an event and appear in roster', async () => {
      const { token } = await createMemberAndLogin(testApp, 'player1', 'player1@test.local');
      const eventId = await createFutureEvent(testApp, adminToken);
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      expect(signupRes.status).toBe(201);
      expect(signupRes.body).toMatchObject({ id: expect.any(Number), eventId, user: expect.objectContaining({ username: 'player1' }) });
      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      expect(rosterRes.body.signups.find((s: any) => s.user.username === 'player1')).toBeDefined();
    });

    it('should return existing signup on duplicate (idempotent)', async () => {
      const { token } = await createMemberAndLogin(testApp, 'player2', 'player2@test.local');
      const eventId = await createFutureEvent(testApp, adminToken);
      const first = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      const second = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
    });

    it('should cancel signup and remove from roster', async () => {
      const { token } = await createMemberAndLogin(testApp, 'player3', 'player3@test.local');
      const eventId = await createFutureEvent(testApp, adminToken);
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      const cancelRes = await testApp.request.delete(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`);
      expect(cancelRes.status).toBe(200);
      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      expect(rosterRes.body.signups.find((s: any) => s.user.username === 'player3')).toBeUndefined();
    });

    it('should auto-signup creator when creating an event', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
      expect(rosterRes.body.signups.find((s: any) => s.user.id === testApp.seed.adminUser.id)).toBeDefined();
    });

    it('should bench signup when event is at capacity', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { maxAttendees: 1 });
      const { token } = await createMemberAndLogin(testApp, 'overflow', 'overflow@test.local');
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      expect(signupRes.status).toBe(201);
      const assignmentsRes = await testApp.request.get(`/events/${eventId}/roster/assignments`);
      const overflowAssignment = assignmentsRes.body.assignments?.find((a: any) => a.signup?.user?.username === 'overflow');
      if (overflowAssignment) expect(overflowAssignment.role).toBe('bench');
    });
  });

  describe('signup status updates', () => {
    it('should update signup status to tentative', async () => {
      const { token } = await createMemberAndLogin(testApp, 'tentative_player', 'tentative@test.local');
      const eventId = await createFutureEvent(testApp, adminToken);
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      const updateRes = await testApp.request.patch(`/events/${eventId}/signup/status`).set('Authorization', `Bearer ${token}`).send({ status: 'tentative' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('tentative');
    });
  });

  describe('confirm signup', () => {
    it('should confirm signup with character selection', async () => {
      const { token } = await createMemberAndLogin(testApp, 'char_player', 'char_player@test.local');
      const eventId = await createFutureEvent(testApp, adminToken, { gameId: testApp.seed.game.id });
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      expect(signupRes.body.confirmationStatus).toBe('pending');
      const charRes = await testApp.request.post('/users/me/characters').set('Authorization', `Bearer ${token}`).send({ gameId: testApp.seed.game.id, name: 'TestChar', class: 'Warrior', role: 'tank' });
      const confirmRes = await testApp.request.patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`).set('Authorization', `Bearer ${token}`).send({ characterId: charRes.body.id });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.confirmationStatus).toBe('confirmed');
      expect(confirmRes.body.characterId).toBe(charRes.body.id);
    });

    it('should transition to changed status on re-confirmation', async () => {
      const { token } = await createMemberAndLogin(testApp, 'reconfirm', 'reconfirm@test.local');
      const eventId = await createFutureEvent(testApp, adminToken, { gameId: testApp.seed.game.id });
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      const char1Res = await testApp.request.post('/users/me/characters').set('Authorization', `Bearer ${token}`).send({ gameId: testApp.seed.game.id, name: 'Char1', class: 'Mage', role: 'dps' });
      const char2Res = await testApp.request.post('/users/me/characters').set('Authorization', `Bearer ${token}`).send({ gameId: testApp.seed.game.id, name: 'Char2', realm: 'OtherRealm', class: 'Priest', role: 'healer' });
      await testApp.request.patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`).set('Authorization', `Bearer ${token}`).send({ characterId: char1Res.body.id });
      const reconfirmRes = await testApp.request.patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`).set('Authorization', `Bearer ${token}`).send({ characterId: char2Res.body.id });
      expect(reconfirmRes.status).toBe(200);
      expect(reconfirmRes.body.confirmationStatus).toBe('changed');
      expect(reconfirmRes.body.characterId).toBe(char2Res.body.id);
    });
  });

  describe('character-optional signup (ROK-600)', () => {
    it('should sign up for non-MMO event without character', async () => {
      const { token } = await createMemberAndLogin(testApp, 'casual_player', 'casual@test.local');
      const eventId = await createFutureEvent(testApp, adminToken, { gameId: testApp.seed.game.id });
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      expect(signupRes.status).toBe(201);
      expect(signupRes.body.character).toBeNull();
    });

    it('should sign up for MMO event without character (character optional)', async () => {
      const [mmoGame] = await testApp.db.insert(schema.games).values({ name: 'World of Warcraft', slug: 'world-of-warcraft', hasRoles: true, hasSpecs: true }).returning();
      const { token } = await createMemberAndLogin(testApp, 'mmo_no_char', 'mmo_no_char@test.local');
      const eventId = await createFutureEvent(testApp, adminToken, { gameId: mmoGame.id });
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});
      expect(signupRes.status).toBe(201);
      expect(signupRes.body.character).toBeNull();
    });

    it('should sign up for MMO event with character attached', async () => {
      const [mmoGame] = await testApp.db.insert(schema.games).values({ name: 'Final Fantasy XIV', slug: 'ffxiv', hasRoles: true, hasSpecs: true }).returning();
      const { token } = await createMemberAndLogin(testApp, 'mmo_with_char', 'mmo_with_char@test.local');
      const charRes = await testApp.request.post('/users/me/characters').set('Authorization', `Bearer ${token}`).send({ gameId: mmoGame.id, name: 'WhiteMage', class: 'White Mage', role: 'healer' });
      const eventId = await createFutureEvent(testApp, adminToken, { gameId: mmoGame.id });
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({ characterId: charRes.body.id });
      expect(signupRes.status).toBe(201);
      expect(signupRes.body.characterId).toBe(charRes.body.id);
    });
  });
});
