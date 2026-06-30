/**
 * Events Cancel, Reschedule, Invite & Embed Integration Tests (ROK-523)
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { EventsService } from './events.service';

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
  await testApp.db
    .insert(schema.localCredentials)
    .values({ email, passwordHash, userId: user.id });
  const loginRes = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return { userId: user.id, token: loginRes.body.access_token as string };
}

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
  if (res.status !== 201)
    throw new Error(`createFutureEvent failed: ${res.status}`);
  return res.body.id as number;
}

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

// ─── cancel tests ───────────────────────────────────────────────────────────

async function testSoftCancel() {
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
  const getRes = await testApp.request.get(`/events/${eventId}`);
  expect(getRes.body.cancelledAt).not.toBeNull();
}

async function testCancelNotifications() {
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
  const notifications = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  expect(notifications.find((n) => n.type === 'event_cancelled')).toBeDefined();
}

async function testCancelAlreadyCancelled() {
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.request
    .patch(`/events/${eventId}/cancel`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  const res = await testApp.request
    .patch(`/events/${eventId}/cancel`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  expect(res.status).toBe(400);
}

async function testCancelForbidden() {
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
}

// ─── reschedule tests ───────────────────────────────────────────────────────

async function testReschedule() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Rescheduled Raid',
  });
  const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 4 * 60 * 60 * 1000);
  const res = await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  expect(res.status).toBe(200);
  expect(res.body.startTime).toBe(newStart.toISOString());
  expect(res.body.endTime).toBe(newEnd.toISOString());
}

async function testRescheduleClearsReminders() {
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.db.insert(schema.eventRemindersSent).values({
    eventId,
    userId: testApp.seed.adminUser.id,
    reminderType: '15min',
  });
  const before = await testApp.db
    .select()
    .from(schema.eventRemindersSent)
    .where(eq(schema.eventRemindersSent.eventId, eventId));
  expect(before).toHaveLength(1);
  const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
  await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  const after = await testApp.db
    .select()
    .from(schema.eventRemindersSent)
    .where(eq(schema.eventRemindersSent.eventId, eventId));
  expect(after).toHaveLength(0);
}

async function testRescheduleNotifications() {
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
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  const notifications = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  expect(
    notifications.find((n) => n.type === 'event_rescheduled'),
  ).toBeDefined();
}

async function testReschedulePerfBatch() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Perf Batch Raid',
  });
  const userCount = 12;
  const userRows = await testApp.db
    .insert(schema.users)
    .values(
      Array.from({ length: userCount }, (_, i) => ({
        discordId: `perf-resched-${i}`,
        username: `perf_resched_${i}`,
        role: 'member' as const,
      })),
    )
    .returning();
  await testApp.db.insert(schema.eventSignups).values(
    userRows.map((u) => ({
      eventId,
      userId: u.id,
      status: 'signed_up' as const,
    })),
  );
  const newStart = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
  const res = await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  expect(res.status).toBe(200);
  // Batching (one createMany for all signups) is asserted deterministically by
  // the ROK-1043 unit test in event-lifecycle.helpers.spec.ts. A wall-clock
  // bound here was load-dependent and flaked under CI (ROK-1290); the
  // end-to-end value is that ALL signups get a real notification row.
  const notifs = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.type, 'event_rescheduled'));
  expect(notifs).toHaveLength(userCount);
}

async function testRescheduleResetsTentativeStatus() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Tentative Reset Raid',
  });
  const { userId } = await createMemberAndLogin(
    testApp,
    'tentative_player',
    'tentative@test.local',
  );
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'tentative',
    confirmationStatus: 'confirmed',
  });
  const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
  await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  const [signup] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.userId, userId));
  expect(signup.status).toBe('signed_up');
  expect(signup.confirmationStatus).toBe('pending');
}

async function testRescheduleDoesNotResetDeclined() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Declined Keep Raid',
  });
  const { userId } = await createMemberAndLogin(
    testApp,
    'declined_player',
    'declined_resched@test.local',
  );
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'declined',
    confirmationStatus: 'pending',
  });
  const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
  await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  const [signup] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.userId, userId));
  expect(signup.status).toBe('declined');
}

// ─── ROK-1269: rescheduler stays confirmed + activity log ───────────────────

/** Ensures the admin's auto-created signup is in signed_up + confirmed. */
async function signupAdmin(eventId: number) {
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'signed_up', confirmationStatus: 'confirmed' })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, testApp.seed.adminUser.id),
      ),
    );
}

async function testRescheduleStaysConfirmedForRescheduler() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Rescheduler Confirmed Raid',
  });
  await signupAdmin(eventId);
  const others = await Promise.all(
    [0, 1, 2].map((i) =>
      createMemberAndLogin(
        testApp,
        `rok1269_other_${i}`,
        `rok1269_other_${i}@test.local`,
      ),
    ),
  );
  await testApp.db.insert(schema.eventSignups).values(
    others.map((o) => ({
      eventId,
      userId: o.userId,
      status: 'signed_up' as const,
      confirmationStatus: 'confirmed' as const,
    })),
  );
  const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
  await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  const signups = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  const adminSignup = signups.find(
    (s) => s.userId === testApp.seed.adminUser.id,
  )!;
  expect(adminSignup.confirmationStatus).toBe('confirmed');
  expect(adminSignup.status).toBe('signed_up');
  for (const o of others) {
    const otherSignup = signups.find((s) => s.userId === o.userId)!;
    expect(otherSignup.confirmationStatus).toBe('pending');
    expect(otherSignup.status).toBe('signed_up');
  }
}

async function testRescheduleSkipsNotificationForRescheduler() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'No Self-DM Raid',
  });
  await signupAdmin(eventId);
  const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
  await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  const reschedNotifs = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, testApp.seed.adminUser.id));
  expect(
    reschedNotifs.find((n) => n.type === 'event_rescheduled'),
  ).toBeUndefined();
}

async function testRescheduleTentativeReschedulerStaysTentative() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Tentative Rescheduler Raid',
  });
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'tentative', confirmationStatus: 'confirmed' })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, testApp.seed.adminUser.id),
      ),
    );
  const newStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000);
  await testApp.request
    .patch(`/events/${eventId}/reschedule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
  const [signup] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.userId, testApp.seed.adminUser.id));
  // tentative + confirmed preserved (UPDATE skipped because user excluded)
  expect(signup.status).toBe('tentative');
  expect(signup.confirmationStatus).toBe('confirmed');
}

async function testRosterUpdateLogsSignupReconfirmed() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Roster Reconfirm Activity Raid',
  });
  const { userId: memberId } = await createMemberAndLogin(
    testApp,
    'rok1269_member',
    'rok1269_member@test.local',
  );
  // Member signs up; reschedule resets them to pending; admin then assigns
  // them via roster update which flips back to confirmed.
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId: memberId,
    status: 'signed_up',
    confirmationStatus: 'pending',
  });
  const [signup] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.userId, memberId));
  const rosterRes = await testApp.request
    .patch(`/events/${eventId}/roster`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      assignments: [
        {
          userId: memberId,
          signupId: signup.id,
          slot: 'player',
          position: 1,
        },
      ],
    });
  expect(rosterRes.status).toBe(200);
  const [flipped] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.userId, memberId));
  expect(flipped.confirmationStatus).toBe('confirmed');
  const activity = await testApp.request.get(`/events/${eventId}/activity`);
  expect(activity.status).toBe(200);
  type ActivityRow = {
    action: string;
    actor: { id: number } | null;
    metadata: Record<string, unknown> | null;
  };
  const reconfirms = (activity.body.data as ActivityRow[]).filter(
    (e) => e.action === 'signup_reconfirmed',
  );
  expect(reconfirms).toHaveLength(1);
  expect(reconfirms[0].actor?.id).toBe(memberId);
  expect(reconfirms[0].metadata?.reason).toBe('roster-update');
}

// ─── invite member tests ────────────────────────────────────────────────────

async function testInviteByDiscordId() {
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
  const notifications = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  const inviteNotif = notifications.find((n) => n.type === 'new_event');
  expect(inviteNotif).toBeDefined();
  expect(inviteNotif!.title).toBe('Event Invitation');
}

async function testInviteUnregistered() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const res = await testApp.request
    .post(`/events/${eventId}/invite-member`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ discordId: 'nonexistent-discord-id' });
  expect(res.status).toBe(404);
}

async function testInviteAlreadySignedUp() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const { token } = await createMemberAndLogin(
    testApp,
    'already_in',
    'already_in@test.local',
    'discord-already-in',
  );
  await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const res = await testApp.request
    .post(`/events/${eventId}/invite-member`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ discordId: 'discord-already-in' });
  expect(res.status).toBe(400);
}

async function testInviteMissingDiscordId() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const res = await testApp.request
    .post(`/events/${eventId}/invite-member`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  expect(res.status).toBe(400);
}

// ─── buildEmbedEventData tests ──────────────────────────────────────────────

async function testEmbedDataWithRoleCounts() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Embed Test Event',
    gameId: testApp.seed.game.id,
    slotConfig: { type: 'mmo', tank: 2, healer: 2, dps: 6, flex: 0, bench: 0 },
  });
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
  const charRes = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId: testApp.seed.game.id,
      name: 'EmbedWarrior',
      class: 'Warrior',
      role: 'tank',
    });
  await testApp.request
    .patch(`/events/${eventId}/signups/${signupRes.body.id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ characterId: charRes.body.id });
  await testApp.db.insert(schema.rosterAssignments).values({
    eventId,
    signupId: signupRes.body.id,
    role: 'tank',
    position: 1,
  });
  const eventsService = testApp.app.get(EventsService);
  const embedData = await eventsService.buildEmbedEventData(eventId);
  expect(embedData.id).toBe(eventId);
  expect(embedData.title).toBe('Embed Test Event');
  expect(embedData.roleCounts).toHaveProperty('tank');
  expect(embedData.roleCounts!.tank).toBeGreaterThanOrEqual(1);
  expect(embedData.signupMentions!.length).toBeGreaterThanOrEqual(1);
  const playerMention = embedData.signupMentions!.find(
    (m: any) => m.username === 'embed_player',
  );
  expect(playerMention).toBeDefined();
  expect(playerMention!.role).toBe('tank');
  expect(playerMention!.className).toBe('Warrior');
}

async function testEmbedExcludesDeclined() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const { userId: declinedUserId } = await createMemberAndLogin(
    testApp,
    'declined_user',
    'declined@test.local',
  );
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId: declinedUserId,
    status: 'declined',
    confirmationStatus: 'pending',
  });
  const eventsService = testApp.app.get(EventsService);
  const embedData = await eventsService.buildEmbedEventData(eventId);
  expect(
    embedData.signupMentions!.find((m: any) => m.username === 'declined_user'),
  ).toBeUndefined();
}

async function testEmbedCoalescesDiscordIds() {
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    discordUserId: 'anon-discord-999',
    discordUsername: 'AnonPlayer',
    status: 'signed_up',
    confirmationStatus: 'pending',
  });
  const eventsService = testApp.app.get(EventsService);
  const embedData = await eventsService.buildEmbedEventData(eventId);
  expect(
    embedData.signupMentions!.find(
      (m: any) => m.discordId === 'anon-discord-999',
    ),
  ).toBeDefined();
}

// ─── delay tests (ROK-1379) ─────────────────────────────────────────────────

async function testDelayShiftsAndPreservesConfirmation() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Delayed Raid',
  });
  const { userId } = await createMemberAndLogin(
    testApp,
    'delay_member',
    'delay_member@test.local',
  );
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'signed_up',
    confirmationStatus: 'confirmed',
  });
  const [before] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  const oldStart = before.duration[0].getTime();

  await testApp.app
    .get(EventsService)
    .delayEvent(eventId, 15, testApp.seed.adminUser.id);

  const [after] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  expect(after.duration[0].getTime()).toBe(oldStart + 15 * 60_000);

  // Delay must NOT reset confirmations (the key difference from reschedule).
  const [signup] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.userId, userId));
  expect(signup.confirmationStatus).toBe('confirmed');

  // Non-actor signed-up user gets event_delayed (NOT event_rescheduled).
  const memberNotifs = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  expect(memberNotifs.find((n) => n.type === 'event_delayed')).toBeDefined();
  expect(
    memberNotifs.find((n) => n.type === 'event_rescheduled'),
  ).toBeUndefined();

  // The actor does not notify themselves.
  const actorNotifs = await testApp.db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, testApp.seed.adminUser.id),
        eq(schema.notifications.type, 'event_delayed'),
      ),
    );
  expect(actorNotifs).toHaveLength(0);
}

async function testDelayRejectsNonHost() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const { userId } = await createMemberAndLogin(
    testApp,
    'delay_nonhost',
    'delay_nonhost@test.local',
  );
  await expect(
    testApp.app.get(EventsService).delayEvent(eventId, 15, userId),
  ).rejects.toBeDefined();
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('Events — cancel', () => {
  it('should soft-cancel with reason', () => testSoftCancel());
  it('should create notifications on cancel', () => testCancelNotifications());
  it('should reject already-cancelled', () => testCancelAlreadyCancelled());
  it('should forbid non-creator cancel', () => testCancelForbidden());
});

describe('Events — reschedule', () => {
  it('should reschedule to new times', () => testReschedule());
  it('should clear reminders on reschedule', () =>
    testRescheduleClearsReminders());
  it('should create notifications on reschedule', () =>
    testRescheduleNotifications());
  it('should reset tentative signups to signed_up on reschedule (ROK-759)', () =>
    testRescheduleResetsTentativeStatus());
  it('should not reset declined signups on reschedule (ROK-759)', () =>
    testRescheduleDoesNotResetDeclined());
  it('reschedule with 12 signups notifies every signup in one batch (ROK-1043, ROK-1290)', () =>
    testReschedulePerfBatch());
  it("ROK-1269: rescheduler's signup stays confirmed; others flip to pending", () =>
    testRescheduleStaysConfirmedForRescheduler());
  it('ROK-1269: rescheduler does not receive their own reschedule DM', () =>
    testRescheduleSkipsNotificationForRescheduler());
  it('ROK-1269: tentative rescheduler stays tentative + confirmed', () =>
    testRescheduleTentativeReschedulerStaysTentative());
  it('ROK-1269: roster update logs signup_reconfirmed per flipped attendee', () =>
    testRosterUpdateLogsSignupReconfirmed());
});

describe('Events — delay (ROK-1379)', () => {
  it('shifts start/end, preserves confirmations, sends event_delayed to non-actor', () =>
    testDelayShiftsAndPreservesConfirmation());
  it('rejects a non-host actor', () => testDelayRejectsNonHost());
});

describe('Events — invite member', () => {
  it('should invite by Discord ID', () => testInviteByDiscordId());
  it('should reject unregistered Discord ID', () => testInviteUnregistered());
  it('should reject already signed up', () => testInviteAlreadySignedUp());
  it('should require discordId in body', () => testInviteMissingDiscordId());
});

describe('Events — buildEmbedEventData', () => {
  it('should return embed data with role counts', () =>
    testEmbedDataWithRoleCounts());
  it('should exclude declined signups', () => testEmbedExcludesDeclined());
  it('should COALESCE Discord IDs', () => testEmbedCoalescesDiscordIds());
});
