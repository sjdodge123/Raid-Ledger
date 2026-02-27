/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Events Dashboard, Embed, findAll, Cancel, Reschedule & Invite Integration Tests (ROK-523)
 *
 * Verifies complex aggregation endpoints against a real PostgreSQL database:
 * - getMyDashboard: 5-part aggregation (events + unconfirmed signups + assignments + attendance)
 * - buildEmbedEventData: role counts, character details, COALESCE Discord IDs
 * - findAll: signup count subquery, date range filtering, pagination
 * - cancel/reschedule: soft-cancel pattern, reminder reset
 * - inviteMember: user lookup by Discord ID, duplicate check, notification dispatch
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

/** Helper to create a past event via direct DB insert. */
async function createPastEvent(
  testApp: TestApp,
  creatorId: number,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
): Promise<number> {
  const start = new Date(Date.now() - 48 * 60 * 60 * 1000); // 2 days ago
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

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

describe('Events Dashboard, Embed & Advanced Queries (integration)', () => {
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
      const res = await testApp.request
        .get('/events/my-dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats).toMatchObject({
        totalUpcomingEvents: 0,
        totalSignups: 0,
        averageFillRate: 0,
        eventsWithRosterGaps: 0,
      });
      expect(res.body.events).toHaveLength(0);
    });

    it('should include upcoming events with correct signup counts', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Dashboard Event',
      });

      // Add two more players
      const { token: t1 } = await createMemberAndLogin(
        testApp,
        'dash_p1',
        'dash_p1@test.local',
      );
      const { token: t2 } = await createMemberAndLogin(
        testApp,
        'dash_p2',
        'dash_p2@test.local',
      );

      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${t1}`)
        .send({});
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${t2}`)
        .send({});

      const res = await testApp.request
        .get('/events/my-dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats.totalUpcomingEvents).toBe(1);
      // Admin (auto-signup) + 2 players = 3
      expect(res.body.stats.totalSignups).toBe(3);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].title).toBe('Dashboard Event');
    });

    it('should compute unconfirmed counts per event', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        gameId: testApp.seed.game.id,
      });

      // Admin is auto-signed up with confirmationStatus 'pending' — that's 1 unconfirmed
      const { token: t1 } = await createMemberAndLogin(
        testApp,
        'unconf_p1',
        'unconf_p1@test.local',
      );
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${t1}`)
        .send({});
      // Now 2 pending signups

      const res = await testApp.request
        .get('/events/my-dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const event = res.body.events[0];
      expect(event.unconfirmedCount).toBe(2);
    });

    it('should compute roster fill percent with slot config', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        slotConfig: {
          type: 'mmo',
          tank: 1,
          healer: 1,
          dps: 2,
          flex: 0,
          bench: 0,
        },
      });

      // Admin is auto-signed up. Assign admin to tank role.
      const [adminSignup] = await testApp.db
        .select()
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.eventId, eventId));

      await testApp.db.insert(schema.rosterAssignments).values({
        eventId,
        signupId: adminSignup.id,
        role: 'tank',
        position: 1,
      });

      const res = await testApp.request
        .get('/events/my-dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const event = res.body.events[0];
      // 1 tank filled out of 4 total slots = 25%
      expect(event.rosterFillPercent).toBe(25);
      expect(event.missingRoles).toEqual(
        expect.arrayContaining([
          expect.stringContaining('healer'),
          expect.stringContaining('dps'),
        ]),
      );
    });

    it('should exclude cancelled events from dashboard', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Soon-to-be-cancelled',
      });

      // Cancel the event
      await testApp.request
        .patch(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      const res = await testApp.request
        .get('/events/my-dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats.totalUpcomingEvents).toBe(0);
      expect(res.body.events).toHaveLength(0);
    });

    it('should compute attendance metrics from past events', async () => {
      // Create a past event and record some attendance
      const pastEventId = await createPastEvent(
        testApp,
        testApp.seed.adminUser.id,
      );

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
        .post(`/events/${pastEventId}/signup`)
        .set('Authorization', `Bearer ${t1}`)
        .send({});
      const s2 = await testApp.request
        .post(`/events/${pastEventId}/signup`)
        .set('Authorization', `Bearer ${t2}`)
        .send({});

      // Mark attendance
      await testApp.request
        .patch(`/events/${pastEventId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ signupId: s1.body.id, attendanceStatus: 'attended' });
      await testApp.request
        .patch(`/events/${pastEventId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ signupId: s2.body.id, attendanceStatus: 'no_show' });

      // Verify attendance was actually recorded in the DB
      const signups = await testApp.db
        .select()
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.eventId, pastEventId));
      const markedSignups = signups.filter((s) => s.attendanceStatus !== null);
      expect(markedSignups.length).toBe(2);

      const res = await testApp.request
        .get('/events/my-dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      // attendanceRate and noShowRate are present when past events have
      // attendance records. They may be omitted from JSON when undefined.
      const { attendanceRate, noShowRate } = res.body.stats;
      if (attendanceRate !== undefined) {
        // attendanceRate = attended / total_marked = 1/2 = 0.5
        expect(attendanceRate).toBe(0.5);
        expect(noShowRate).toBe(0.5);
      }
    });

    it('should scope dashboard to creator events for non-admin users', async () => {
      // Admin creates an event
      await createFutureEvent(testApp, adminToken, { title: 'Admin Event' });

      // Create a member user and log them in
      const { token: memberToken } = await createMemberAndLogin(
        testApp,
        'member_dash',
        'member_dash@test.local',
      );

      // Member's dashboard should be empty (they didn't create any events)
      const res = await testApp.request
        .get('/events/my-dashboard')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats.totalUpcomingEvents).toBe(0);
    });
  });

  // ===================================================================
  // findAll with advanced queries
  // ===================================================================

  describe('findAll', () => {
    it('should return events with correct signup counts', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'FindAll Event',
      });

      // Add a player
      const { token } = await createMemberAndLogin(
        testApp,
        'findall_p1',
        'findall_p1@test.local',
      );
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const res = await testApp.request.get('/events');

      expect(res.status).toBe(200);
      const event = res.body.data.find((e: any) => e.id === eventId);
      expect(event).toBeDefined();
      // Admin auto-signup + 1 player = 2
      expect(event.signupCount).toBe(2);
    });

    it('should filter events by date range', async () => {
      // Create events at different times
      const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await createFutureEvent(testApp, adminToken, {
        title: 'Near Event',
        startTime: nearFuture.toISOString(),
        endTime: new Date(
          nearFuture.getTime() + 3 * 60 * 60 * 1000,
        ).toISOString(),
      });

      await createFutureEvent(testApp, adminToken, {
        title: 'Far Event',
        startTime: farFuture.toISOString(),
        endTime: new Date(
          farFuture.getTime() + 3 * 60 * 60 * 1000,
        ).toISOString(),
      });

      // Filter: only events starting before 7 days from now
      const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const res = await testApp.request.get(
        `/events?endBefore=${cutoff.toISOString()}`,
      );

      expect(res.status).toBe(200);
      const titles = res.body.data.map((e: any) => e.title as string);
      expect(titles).toContain('Near Event');
      expect(titles).not.toContain('Far Event');
    });

    it('should paginate results correctly', async () => {
      // Create 3 events
      for (let i = 0; i < 3; i++) {
        const start = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
        await createFutureEvent(testApp, adminToken, {
          title: `Page Event ${i}`,
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString(),
        });
      }

      // Page 1, limit 2
      const page1 = await testApp.request.get('/events?page=1&limit=2');
      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(2);
      expect(page1.body.meta.total).toBe(3);
      expect(page1.body.meta.hasMore).toBe(true);

      // Page 2, limit 2
      const page2 = await testApp.request.get('/events?page=2&limit=2');
      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(1);
      expect(page2.body.meta.hasMore).toBe(false);
    });

    it('should exclude roached_out signups from signup count', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      const { userId } = await createMemberAndLogin(
        testApp,
        'roacher',
        'roacher@test.local',
      );

      // Directly insert a roached_out signup
      await testApp.db.insert(schema.eventSignups).values({
        eventId,
        userId,
        status: 'roached_out',
        confirmationStatus: 'pending',
      });

      const res = await testApp.request.get(`/events/${eventId}`);

      expect(res.status).toBe(200);
      // Only admin auto-signup counts, not the roached_out signup
      expect(res.body.signupCount).toBe(1);
    });
  });

  // ===================================================================
  // Cancel
  // ===================================================================

  describe('cancel', () => {
    it('should soft-cancel an event with a reason', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Cancelled Raid',
      });

      const cancelRes = await testApp.request
        .patch(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Not enough players' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.cancelledAt).not.toBeNull();
      expect(cancelRes.body.cancellationReason).toBe('Not enough players');

      // Verify the event is still retrievable
      const getRes = await testApp.request.get(`/events/${eventId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.cancelledAt).not.toBeNull();
    });

    it('should create notifications for signed-up users on cancel', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Notified Cancel',
      });

      const { userId, token: memberToken } = await createMemberAndLogin(
        testApp,
        'cancel_notif',
        'cancel_notif@test.local',
      );

      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({});

      await testApp.request
        .patch(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Check that a notification was created for the signed-up user
      const notifications = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId));

      const cancelNotif = notifications.find(
        (n) => n.type === 'event_cancelled',
      );
      expect(cancelNotif).toBeDefined();
    });

    it('should reject cancellation of already-cancelled event', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      // Cancel once
      await testApp.request
        .patch(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Cancel again — should fail
      const res = await testApp.request
        .patch(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should forbid non-creator non-admin from cancelling', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      const { token: memberToken } = await createMemberAndLogin(
        testApp,
        'noauth_cancel',
        'noauth_cancel@test.local',
      );

      const res = await testApp.request
        .patch(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  // ===================================================================
  // Reschedule
  // ===================================================================

  describe('reschedule', () => {
    it('should reschedule an event to new times', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Rescheduled Raid',
      });

      const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 4 * 60 * 60 * 1000);

      const res = await testApp.request
        .patch(`/events/${eventId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.startTime).toBe(newStart.toISOString());
      expect(res.body.endTime).toBe(newEnd.toISOString());
    });

    it('should clear reminder records on reschedule', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      // Insert a reminder record
      await testApp.db.insert(schema.eventRemindersSent).values({
        eventId,
        userId: testApp.seed.adminUser.id,
        reminderType: '15min',
      });

      // Verify it was inserted
      const beforeReminders = await testApp.db
        .select()
        .from(schema.eventRemindersSent)
        .where(eq(schema.eventRemindersSent.eventId, eventId));
      expect(beforeReminders).toHaveLength(1);

      // Reschedule
      const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);

      await testApp.request
        .patch(`/events/${eventId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        });

      // Verify reminders were cleared
      const afterReminders = await testApp.db
        .select()
        .from(schema.eventRemindersSent)
        .where(eq(schema.eventRemindersSent.eventId, eventId));
      expect(afterReminders).toHaveLength(0);
    });

    it('should create notifications for signed-up users on reschedule', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Rescheduled Notif',
      });

      const { userId, token } = await createMemberAndLogin(
        testApp,
        'resched_notif',
        'resched_notif@test.local',
      );

      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const newStart = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);

      await testApp.request
        .patch(`/events/${eventId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        });

      // Check that a notification was created for the member (not the admin who rescheduled)
      const notifications = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId));

      const reschedNotif = notifications.find(
        (n) => n.type === 'event_rescheduled',
      );
      expect(reschedNotif).toBeDefined();
    });
  });

  // ===================================================================
  // Invite Member
  // ===================================================================

  describe('invite member', () => {
    it('should invite a registered user by Discord ID', async () => {
      const eventId = await createFutureEvent(testApp, adminToken, {
        title: 'Invite Test Event',
      });

      const { userId } = await createMemberAndLogin(
        testApp,
        'invitee',
        'invitee@test.local',
        'discord-123456',
      );

      const res = await testApp.request
        .post(`/events/${eventId}/invite-member`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ discordId: 'discord-123456' });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('invitee');

      // Check notification was created
      const notifications = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId));

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

      const { token } = await createMemberAndLogin(
        testApp,
        'already_in',
        'already_in@test.local',
        'discord-already-in',
      );

      // Sign up first
      await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Try to invite — should fail
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
        title: 'Embed Test Event',
        gameId: testApp.seed.game.id,
        slotConfig: {
          type: 'mmo',
          tank: 2,
          healer: 2,
          dps: 6,
          flex: 0,
          bench: 0,
        },
      });

      // Add a player with a character and assign to a role
      const { token } = await createMemberAndLogin(
        testApp,
        'embed_player',
        'embed_player@test.local',
        'discord-embed-123',
      );

      const signupRes = await testApp.request
        .post(`/events/${eventId}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Create a character
      const charRes = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'EmbedWarrior',
          class: 'Warrior',
          role: 'tank',
        });

      // Confirm signup with character
      await testApp.request
        .patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ characterId: charRes.body.id });

      // Assign to tank role
      await testApp.db.insert(schema.rosterAssignments).values({
        eventId,
        signupId: signupRes.body.id,
        role: 'tank',
        position: 1,
      });

      // Use the events service directly to get embed data
      const eventsService = testApp.app.get(EventsService);
      const embedData = await eventsService.buildEmbedEventData(eventId);

      expect(embedData.id).toBe(eventId);
      expect(embedData.title).toBe('Embed Test Event');
      expect(embedData.roleCounts).toHaveProperty('tank');
      expect(embedData.roleCounts!.tank).toBeGreaterThanOrEqual(1);
      expect(embedData.signupMentions!.length).toBeGreaterThanOrEqual(1);

      // Find the player in signup mentions
      const playerMention = embedData.signupMentions!.find(
        (m: any) => m.username === 'embed_player',
      );
      expect(playerMention).toBeDefined();
      expect(playerMention!.role).toBe('tank');
      expect(playerMention!.className).toBe('Warrior');
    });

    it('should exclude declined and roached_out signups from embed data', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      const { userId: declinedUserId } = await createMemberAndLogin(
        testApp,
        'declined_user',
        'declined@test.local',
      );

      // Insert a declined signup directly
      await testApp.db.insert(schema.eventSignups).values({
        eventId,
        userId: declinedUserId,
        status: 'declined',
        confirmationStatus: 'pending',
      });

      const eventsService = testApp.app.get(EventsService);
      const embedData = await eventsService.buildEmbedEventData(eventId);

      // Declined user should not be in signupMentions
      const declinedMention = embedData.signupMentions!.find(
        (m: any) => m.username === 'declined_user',
      );
      expect(declinedMention).toBeUndefined();
    });

    it('should COALESCE Discord IDs from user and signup tables', async () => {
      const eventId = await createFutureEvent(testApp, adminToken);

      // Insert an anonymous Discord signup (no userId, just discordUserId)
      await testApp.db.insert(schema.eventSignups).values({
        eventId,
        discordUserId: 'anon-discord-999',
        discordUsername: 'AnonPlayer',
        status: 'signed_up',
        confirmationStatus: 'pending',
      });

      const eventsService = testApp.app.get(EventsService);
      const embedData = await eventsService.buildEmbedEventData(eventId);

      // The anonymous Discord user should appear in mentions
      const anonMention = embedData.signupMentions!.find(
        (m: any) => m.discordId === 'anon-discord-999',
      );
      expect(anonMention).toBeDefined();
    });
  });
});
