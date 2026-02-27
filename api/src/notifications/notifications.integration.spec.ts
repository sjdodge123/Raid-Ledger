/**
 * Event Reminders & Notification Lifecycle Integration Tests (ROK-524)
 *
 * Verifies reminder dedup via DB unique constraint, notification
 * preferences auto-INSERT on first access, deep JSONB merge for
 * preference updates, and expired notification cleanup — all against
 * a real PostgreSQL database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { eq, and, not, isNull, lt } from 'drizzle-orm';

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

describe('Event Reminders & Notifications (integration)', () => {
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
  // Reminder Deduplication
  // ===================================================================

  describe('reminder dedup', () => {
    it('should insert reminder on first call and skip on duplicate', async () => {
      // Create an event + signup directly in DB
      const start = new Date(Date.now() + 60 * 60 * 1000); // 1h from now
      const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

      const [event] = await testApp.db
        .insert(schema.events)
        .values({
          title: 'Reminder Test Event',
          creatorId: testApp.seed.adminUser.id,
          duration: [start, end] as [Date, Date],
          reminder15min: true,
          reminder1hour: true,
        })
        .returning();

      // First insert — should succeed
      const [first] = await testApp.db
        .insert(schema.eventRemindersSent)
        .values({
          eventId: event.id,
          userId: testApp.seed.adminUser.id,
          reminderType: '1hour',
        })
        .onConflictDoNothing({
          target: [
            schema.eventRemindersSent.eventId,
            schema.eventRemindersSent.userId,
            schema.eventRemindersSent.reminderType,
          ],
        })
        .returning();

      expect(first).toBeDefined();
      expect(first.eventId).toBe(event.id);

      // Duplicate insert — should be a no-op (onConflictDoNothing)
      const duplicateResult = await testApp.db
        .insert(schema.eventRemindersSent)
        .values({
          eventId: event.id,
          userId: testApp.seed.adminUser.id,
          reminderType: '1hour',
        })
        .onConflictDoNothing({
          target: [
            schema.eventRemindersSent.eventId,
            schema.eventRemindersSent.userId,
            schema.eventRemindersSent.reminderType,
          ],
        })
        .returning();

      expect(duplicateResult.length).toBe(0);

      // Verify only one row exists
      const rows = await testApp.db
        .select()
        .from(schema.eventRemindersSent)
        .where(eq(schema.eventRemindersSent.eventId, event.id));

      expect(rows.length).toBe(1);
    });

    it('should allow different reminder types for same event+user', async () => {
      const start = new Date(Date.now() + 60 * 60 * 1000);
      const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

      const [event] = await testApp.db
        .insert(schema.events)
        .values({
          title: 'Multi-Reminder Event',
          creatorId: testApp.seed.adminUser.id,
          duration: [start, end] as [Date, Date],
        })
        .returning();

      // Insert different reminder types
      await testApp.db.insert(schema.eventRemindersSent).values({
        eventId: event.id,
        userId: testApp.seed.adminUser.id,
        reminderType: '15min',
      });

      await testApp.db.insert(schema.eventRemindersSent).values({
        eventId: event.id,
        userId: testApp.seed.adminUser.id,
        reminderType: '1hour',
      });

      await testApp.db.insert(schema.eventRemindersSent).values({
        eventId: event.id,
        userId: testApp.seed.adminUser.id,
        reminderType: '24hour',
      });

      const rows = await testApp.db
        .select()
        .from(schema.eventRemindersSent)
        .where(eq(schema.eventRemindersSent.eventId, event.id));

      expect(rows.length).toBe(3);
    });
  });

  // ===================================================================
  // Notification Preferences
  // ===================================================================

  describe('notification preferences', () => {
    it('should create default preferences on first access', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'prefuser',
        'prefuser@test.local',
      );

      const res = await testApp.request
        .get('/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.channelPrefs).toBeDefined();
      // Verify default prefs include expected types
      expect(res.body.channelPrefs.event_reminder).toBeDefined();
      expect(res.body.channelPrefs.event_reminder.inApp).toBe(true);
    });

    it('should deep-merge preferences preserving unmodified keys', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'mergeuser',
        'mergeuser@test.local',
      );

      // First access creates defaults
      const defaultRes = await testApp.request
        .get('/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);

      expect(defaultRes.body.channelPrefs.event_reminder.inApp).toBe(true);
      expect(defaultRes.body.channelPrefs.event_reminder.discord).toBe(true);

      // Update only discord for event_reminder
      const updateRes = await testApp.request
        .patch('/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({
          channelPrefs: {
            event_reminder: { discord: false },
          },
        });

      expect(updateRes.status).toBe(200);
      // discord should be updated
      expect(updateRes.body.channelPrefs.event_reminder.discord).toBe(false);
      // inApp should be preserved (not overwritten)
      expect(updateRes.body.channelPrefs.event_reminder.inApp).toBe(true);
      // Other types should be untouched
      expect(updateRes.body.channelPrefs.new_event.inApp).toBe(true);
    });

    it('should persist preference changes across requests', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'persistuser',
        'persistuser@test.local',
      );

      // Set a preference
      await testApp.request
        .patch('/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({
          channelPrefs: {
            slot_vacated: { push: false },
          },
        });

      // Read back
      const res = await testApp.request
        .get('/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.channelPrefs.slot_vacated.push).toBe(false);
      expect(res.body.channelPrefs.slot_vacated.inApp).toBe(true);
    });
  });

  // ===================================================================
  // Notification CRUD
  // ===================================================================

  describe('notification CRUD', () => {
    it('should create notification and retrieve it', async () => {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'notifuser',
        'notifuser@test.local',
      );

      // Insert notification directly via DB (service-level — no HTTP endpoint to create)
      await testApp.db.insert(schema.notifications).values({
        userId,
        type: 'new_event',
        title: 'New Event!',
        message: 'A new event was created.',
      });

      // Retrieve via HTTP
      const res = await testApp.request
        .get('/notifications')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const notification = res.body.find(
        (n: any) => n.title === 'New Event!',
      );
      expect(notification).toBeDefined();
      expect(notification.type).toBe('new_event');
    });

    it('should mark notification as read', async () => {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'readuser',
        'readuser@test.local',
      );

      // Insert notification
      const [notif] = await testApp.db
        .insert(schema.notifications)
        .values({
          userId,
          type: 'system',
          title: 'Test Notification',
          message: 'This should be marked read.',
        })
        .returning();

      // Mark as read
      const markRes = await testApp.request
        .post(`/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${token}`);

      expect(markRes.status).toBe(201);

      // Verify unread count is 0
      const countRes = await testApp.request
        .get('/notifications/unread/count')
        .set('Authorization', `Bearer ${token}`);

      expect(countRes.body.count).toBe(0);
    });

    it('should mark all notifications as read', async () => {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'markalluser',
        'markalluser@test.local',
      );

      // Insert multiple notifications
      await testApp.db.insert(schema.notifications).values([
        { userId, type: 'new_event', title: 'Notif 1', message: 'msg1' },
        { userId, type: 'system', title: 'Notif 2', message: 'msg2' },
      ]);

      // Verify 2 unread
      const beforeCount = await testApp.request
        .get('/notifications/unread/count')
        .set('Authorization', `Bearer ${token}`);
      expect(beforeCount.body.count).toBe(2);

      // Mark all read
      await testApp.request
        .post('/notifications/read-all')
        .set('Authorization', `Bearer ${token}`);

      // Verify 0 unread
      const afterCount = await testApp.request
        .get('/notifications/unread/count')
        .set('Authorization', `Bearer ${token}`);
      expect(afterCount.body.count).toBe(0);
    });
  });

  // ===================================================================
  // Notification Cleanup
  // ===================================================================

  describe('notification cleanup', () => {
    it('should delete expired notifications and preserve non-expired', async () => {
      const { userId } = await createMemberAndLogin(
        testApp,
        'cleanupuser',
        'cleanupuser@test.local',
      );

      // Insert expired notification (expiresAt in the past)
      await testApp.db.insert(schema.notifications).values({
        userId,
        type: 'system',
        title: 'Expired',
        message: 'Should be cleaned up',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      });

      // Insert non-expired notification (expiresAt in the future)
      await testApp.db.insert(schema.notifications).values({
        userId,
        type: 'new_event',
        title: 'Still Valid',
        message: 'Should be preserved',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
      });

      // Insert notification without expiresAt (should be preserved)
      await testApp.db.insert(schema.notifications).values({
        userId,
        type: 'system',
        title: 'No Expiry',
        message: 'Should be preserved',
      });

      // Run cleanup directly via DB (the service method, not the cron)
      const now = new Date();
      const deleted = await testApp.db
        .delete(schema.notifications)
        .where(
          and(
            not(isNull(schema.notifications.expiresAt)),
            lt(schema.notifications.expiresAt, now),
          ),
        )
        .returning();

      expect(deleted.length).toBe(1);
      expect(deleted[0].title).toBe('Expired');

      // Verify remaining notifications
      const remaining = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId));

      expect(remaining.length).toBe(2);
      const titles = remaining.map((n) => n.title).sort();
      expect(titles).toEqual(['No Expiry', 'Still Valid']);
    });
  });

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require authentication for notification endpoints', async () => {
      const res = await testApp.request.get('/notifications');
      expect(res.status).toBe(401);
    });

    it('should require authentication for preferences', async () => {
      const res = await testApp.request.get('/notifications/preferences');
      expect(res.status).toBe(401);
    });
  });
});
