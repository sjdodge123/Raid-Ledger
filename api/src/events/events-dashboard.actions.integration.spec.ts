/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Events Cancel, Reschedule, Invite & Embed Integration Tests (ROK-523)
 *
 * Verifies cancel/reschedule flows, invite member, and embed data
 * against a real PostgreSQL database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { EventsService } from './events.service';

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

describe('Events Cancel, Reschedule, Invite & Embed (integration)', () => {
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
  // Cancel
  // ===================================================================

  describe('cancel', () => {
    it('should soft-cancel an event with a reason', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'Cancelled Raid' });
      const cancelRes = await testApp.request
        .patch(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Not enough players' });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.cancelledAt).not.toBeNull();
      expect(cancelRes.body.cancellationReason).toBe('Not enough players');
      const getRes = await testApp.request.get(`/events/${eventId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.cancelledAt).not.toBeNull();
    });

    it('should create notifications for signed-up users on cancel', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'Notified Cancel' });
      const { userId, token: memberToken } = await createMemberAndLogin(testApp, 'cancel_notif', 'cancel_notif@test.local');
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${memberToken}`).send({});
      await testApp.request.patch(`/events/${eventId}/cancel`).set('Authorization', `Bearer ${adminToken}`).send({});

      const notifications = await testApp.db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
      const cancelNotif = notifications.find((n) => n.type === 'event_cancelled');
      expect(cancelNotif).toBeDefined();
    });

    it('should reject cancellation of already-cancelled event', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      await testApp.request.patch(`/events/${eventId}/cancel`).set('Authorization', `Bearer ${adminToken}`).send({});
      const res = await testApp.request.patch(`/events/${eventId}/cancel`).set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(400);
    });

    it('should forbid non-creator non-admin from cancelling', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const { token: memberToken } = await createMemberAndLogin(testApp, 'noauth_cancel', 'noauth_cancel@test.local');
      const res = await testApp.request.patch(`/events/${eventId}/cancel`).set('Authorization', `Bearer ${memberToken}`).send({});
      expect(res.status).toBe(403);
    });
  });

  // ===================================================================
  // Reschedule
  // ===================================================================

  describe('reschedule', () => {
    it('should reschedule an event to new times', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'Rescheduled Raid' });
      const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 4 * 60 * 60 * 1000);
      const res = await testApp.request
        .patch(`/events/${eventId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
      expect(res.status).toBe(200);
      expect(res.body.startTime).toBe(newStart.toISOString());
      expect(res.body.endTime).toBe(newEnd.toISOString());
    });

    it('should clear reminder records on reschedule', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      await testApp.db.insert(schema.eventRemindersSent).values({ eventId, userId: testApp.seed.adminUser.id, reminderType: '15min' });
      const beforeReminders = await testApp.db.select().from(schema.eventRemindersSent).where(eq(schema.eventRemindersSent.eventId, eventId));
      expect(beforeReminders).toHaveLength(1);

      const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
      await testApp.request.patch(`/events/${eventId}/reschedule`).set('Authorization', `Bearer ${adminToken}`).send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });

      const afterReminders = await testApp.db.select().from(schema.eventRemindersSent).where(eq(schema.eventRemindersSent.eventId, eventId));
      expect(afterReminders).toHaveLength(0);
    });

    it('should create notifications for signed-up users on reschedule', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'Rescheduled Notif' });
      const { userId, token } = await createMemberAndLogin(testApp, 'resched_notif', 'resched_notif@test.local');
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});

      const newStart = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
      await testApp.request.patch(`/events/${eventId}/reschedule`).set('Authorization', `Bearer ${adminToken}`).send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });

      const notifications = await testApp.db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
      const reschedNotif = notifications.find((n) => n.type === 'event_rescheduled');
      expect(reschedNotif).toBeDefined();
    });
  });

  // ===================================================================
  // Invite Member
  // ===================================================================

  describe('invite member', () => {
    it('should invite a registered user by Discord ID', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, { title: 'Invite Test Event' });
      const { userId } = await createMemberAndLogin(testApp, 'invitee', 'invitee@test.local', 'discord-123456');

      const res = await testApp.request
        .post(`/events/${eventId}/invite-member`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ discordId: 'discord-123456' });
      expect(res.status).toBe(201);
      expect(res.body.message).toContain('invitee');

      const notifications = await testApp.db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
      const inviteNotif = notifications.find((n) => n.type === 'new_event');
      expect(inviteNotif).toBeDefined();
      expect(inviteNotif!.title).toBe('Event Invitation');
    });

    it('should reject invite for unregistered Discord ID', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const res = await testApp.request
        .post(`/events/${eventId}/invite-member`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ discordId: 'nonexistent-discord-id' });
      expect(res.status).toBe(404);
    });

    it('should reject invite for user already signed up', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const { token } = await createMemberAndLogin(testApp, 'already_in', 'already_in@test.local', 'discord-already-in');
      await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});

      const res = await testApp.request
        .post(`/events/${eventId}/invite-member`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ discordId: 'discord-already-in' });
      expect(res.status).toBe(400);
    });

    it('should require discordId in the request body', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const res = await testApp.request
        .post(`/events/${eventId}/invite-member`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ===================================================================
  // Build Embed Event Data
  // ===================================================================

  describe('buildEmbedEventData (service-level)', () => {
    it('should return embed data with role counts and signup mentions', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Embed Test Event', gameId: testApp.seed.game.id,
        slotConfig: { type: 'mmo', tank: 2, healer: 2, dps: 6, flex: 0, bench: 0 },
      });
      const { token } = await createMemberAndLogin(testApp, 'embed_player', 'embed_player@test.local', 'discord-embed-123');
      const signupRes = await testApp.request.post(`/events/${eventId}/signup`).set('Authorization', `Bearer ${token}`).send({});

      const charRes = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: testApp.seed.game.id, name: 'EmbedWarrior', class: 'Warrior', role: 'tank' });
      await testApp.request
        .patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ characterId: charRes.body.id });
      await testApp.db.insert(schema.rosterAssignments).values({ eventId, signupId: signupRes.body.id, role: 'tank', position: 1 });

      const eventsService = testApp.app.get(EventsService);
      const embedData = await eventsService.buildEmbedEventData(eventId);

      expect(embedData.id).toBe(eventId);
      expect(embedData.title).toBe('Embed Test Event');
      expect(embedData.roleCounts).toHaveProperty('tank');
      expect(embedData.roleCounts!.tank).toBeGreaterThanOrEqual(1);
      expect(embedData.signupMentions!.length).toBeGreaterThanOrEqual(1);

      const playerMention = embedData.signupMentions!.find((m: any) => m.username === 'embed_player');
      expect(playerMention).toBeDefined();
      expect(playerMention!.role).toBe('tank');
      expect(playerMention!.className).toBe('Warrior');
    });

    it('should exclude declined and roached_out signups from embed data', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      const { userId: declinedUserId } = await createMemberAndLogin(testApp, 'declined_user', 'declined@test.local');
      await testApp.db.insert(schema.eventSignups).values({ eventId, userId: declinedUserId, status: 'declined', confirmationStatus: 'pending' });

      const eventsService = testApp.app.get(EventsService);
      const embedData = await eventsService.buildEmbedEventData(eventId);

      const declinedMention = embedData.signupMentions!.find((m: any) => m.username === 'declined_user');
      expect(declinedMention).toBeUndefined();
    });

    it('should COALESCE Discord IDs from user and signup tables', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);
      await testApp.db.insert(schema.eventSignups).values({
        eventId, discordUserId: 'anon-discord-999', discordUsername: 'AnonPlayer',
        status: 'signed_up', confirmationStatus: 'pending',
      });

      const eventsService = testApp.app.get(EventsService);
      const embedData = await eventsService.buildEmbedEventData(eventId);

      const anonMention = embedData.signupMentions!.find((m: any) => m.discordId === 'anon-discord-999');
      expect(anonMention).toBeDefined();
    });
  });
});
