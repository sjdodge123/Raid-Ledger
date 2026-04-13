/**
 * Standalone Scheduling Poll Integration Tests (ROK-977 + ROK-1034)
 *
 * Verifies the POST /scheduling-polls endpoint against a real PostgreSQL
 * database. This endpoint creates a "standalone" scheduling poll that skips
 * the full lineup flow (building/voting) and jumps directly to scheduling.
 *
 * Under the hood it creates:
 *   - A community_lineup in "decided" status
 *   - A community_lineup_match in "scheduling" status
 *   - community_lineup_match_members for provided userIds
 *
 * ROK-977 Acceptance Criteria:
 *   AC1: POST with valid gameId creates lineup (decided) + match (scheduling)
 *   AC2: Match members inserted for provided memberUserIds
 *   AC3: Phase timer scheduled when durationHours provided
 *   AC4: 404 when gameId doesn't exist
 *   AC5: 404 when linkedEventId doesn't exist
 *   AC6: Any authenticated user can create (no operator role required)
 *
 * ROK-1034 Acceptance Criteria (rescheduling poll linkage):
 *   AC1: POST with linkedEventId sets rescheduling_poll_id on the event
 *   AC2: GET /events excludes events with rescheduling_poll_id IS NOT NULL
 *   AC3: POST /events/:id/signup on rescheduling event returns 409
 *   AC4: POST /scheduling-polls on event already being rescheduled returns 409
 *   AC5: Poll completion cancels linked event, clears rescheduling_poll_id
 *   AC6: Poll expiry clears rescheduling_poll_id, event reappears
 *   AC7: Roster members receive reschedule-specific DM
 *   AC8: Game-interest-only users receive generic poll DM
 *   AC9: Roster member who also hearted game receives ONLY reschedule DM (dedup)
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

// ── Shared state ──────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────

async function loginAsMember(
  tag = 'member',
): Promise<{ token: string; userId: number }> {
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('MemberPass1!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${tag}@test.local`,
      username: tag,
      role: 'member',
    })
    .returning();
  await testApp.db.insert(schema.localCredentials).values({
    email: `${tag}@test.local`,
    passwordHash: hash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: `${tag}@test.local`, password: 'MemberPass1!' });
  return { token: res.body.access_token as string, userId: user.id };
}

async function createEvent(title: string, gameId: number) {
  const now = new Date();
  const start = new Date(now.getTime() + 86_400_000);
  const end = new Date(now.getTime() + 90_000_000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      gameId,
      duration: [start, end],
      maxAttendees: 10,
      creatorId: testApp.seed.adminUser.id,
    })
    .returning();
  return event;
}

function postSchedulingPoll(token: string, body: Record<string, unknown>) {
  return testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function addSignup(eventId: number, userId: number) {
  const [signup] = await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, status: 'signed_up' })
    .returning();
  return signup;
}

async function addGameInterest(userId: number, gameId: number) {
  await testApp.db.insert(schema.gameInterests).values({
    userId,
    gameId,
    source: 'manual',
  });
}

// ── ROK-977 AC1: POST with valid gameId creates lineup + match ───────

function describeCreatePoll() {
  it('should create a lineup in decided status and match in scheduling status', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      lineupId: expect.any(Number),
      gameId: testApp.seed.game.id,
      gameName: expect.any(String),
      status: 'scheduling',
      memberCount: expect.any(Number),
      createdAt: expect.any(String),
    });
  });

  it('should persist lineup with decided status in DB', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
    });

    const lineupId = res.body.lineupId as number;
    const [lineup] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .limit(1);

    expect(lineup).toBeDefined();
    expect(lineup.id).toBe(lineupId);
    expect(lineup.status).toBe('decided');
  });

  it('should persist match with scheduling status in DB', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
    });

    const matchId = res.body.id as number;
    const [match] = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .limit(1);

    expect(match).toBeDefined();
    expect(match.id).toBe(matchId);
    expect(match.status).toBe('scheduling');
    expect(match.gameId).toBe(testApp.seed.game.id);
    expect(match.thresholdMet).toBe(true);
  });

  it('should return gameCoverUrl in response when game has cover', async () => {
    const [gameWithCover] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Cover Game',
        slug: 'cover-game',
        coverUrl: 'https://example.com/cover.jpg',
      })
      .returning();

    const res = await postSchedulingPoll(adminToken, {
      gameId: gameWithCover.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('gameCoverUrl');
  });
}
describe('POST /scheduling-polls — create poll', describeCreatePoll);

// ── ROK-977 AC2: Match members inserted for provided memberUserIds ───

function describeMembers() {
  it('should insert match members for provided memberUserIds', async () => {
    const member1 = await loginAsMember('poll-member-1');
    const member2 = await loginAsMember('poll-member-2');

    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      memberUserIds: [member1.userId, member2.userId],
    });

    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBeGreaterThanOrEqual(2);

    // Verify members in DB
    const matchId = res.body.id as number;
    const members = await testApp.db
      .select()
      .from(schema.communityLineupMatchMembers);
    const matchMembers = members.filter((m) => m.matchId === matchId);

    const memberUserIds = matchMembers.map((m) => m.userId);
    expect(memberUserIds).toContain(member1.userId);
    expect(memberUserIds).toContain(member2.userId);
  });

  it('should include the creator as a match member', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
    });

    expect(res.status).toBe(201);

    const matchId = res.body.id as number;
    const members = await testApp.db
      .select()
      .from(schema.communityLineupMatchMembers);
    const matchMembers = members.filter((m) => m.matchId === matchId);

    const memberUserIds = matchMembers.map((m) => m.userId);
    expect(memberUserIds).toContain(testApp.seed.adminUser.id);
  });

  it('should handle empty memberUserIds array', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      memberUserIds: [],
    });

    expect(res.status).toBe(201);
    // At minimum the creator should be a member
    expect(res.body.memberCount).toBeGreaterThanOrEqual(1);
  });
}
describe('POST /scheduling-polls — match members', describeMembers);

// ── ROK-977 AC3: Phase timer scheduled when durationHours provided ───

function describePhaseDuration() {
  it('should set phase deadline when durationHours is provided', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      durationHours: 48,
    });

    expect(res.status).toBe(201);

    // Verify the lineup has a phaseDeadline in DB
    const lineupId = res.body.lineupId as number;
    const [lineup] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .limit(1);

    expect(lineup.id).toBe(lineupId);
    expect(lineup.phaseDeadline).not.toBeNull();

    // Deadline should be roughly 48h from now
    const deadline = new Date(lineup.phaseDeadline!);
    const hoursUntil = (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
    expect(hoursUntil).toBeGreaterThan(46);
    expect(hoursUntil).toBeLessThan(50);
  });

  it('should not set phase deadline when durationHours is omitted', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
    });

    expect(res.status).toBe(201);

    // Without durationHours, phaseDeadline should be null (or absent)
    const lineupId = res.body.lineupId as number;
    const [lineup] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .limit(1);

    expect(lineup.id).toBe(lineupId);
    // Standalone polls without explicit duration should not auto-expire
    expect(lineup.phaseDeadline).toBeNull();
  });
}
describe('POST /scheduling-polls — phase duration', describePhaseDuration);

// ── ROK-977 AC4: 404 when gameId doesn't exist ───────────────────────

function describeInvalidGame() {
  it('should return 404 when gameId does not exist', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: 999999,
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/game|not found/i);
  });
}
describe('POST /scheduling-polls — invalid gameId', describeInvalidGame);

// ── ROK-977 AC5: 404 when linkedEventId doesn't exist ────────────────

function describeLinkedEvent() {
  it('should return 404 when linkedEventId does not exist', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: 999999,
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/event|not found/i);
  });

  it('should accept valid linkedEventId and store it on the match', async () => {
    const event = await createEvent('Linked Event', testApp.seed.game.id);

    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });

    expect(res.status).toBe(201);

    // Verify linkedEventId stored on the match
    const matchId = res.body.id as number;
    const [match] = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .limit(1);

    expect(match.id).toBe(matchId);
    expect(match.linkedEventId).toBe(event.id);
  });
}
describe('POST /scheduling-polls — linkedEventId', describeLinkedEvent);

// ── ROK-977 AC6: Any authenticated user can create ───────────────────

function describeAuth() {
  it('should return 401 without authentication', async () => {
    const res = await testApp.request
      .post('/scheduling-polls')
      .send({ gameId: testApp.seed.game.id });

    expect(res.status).toBe(401);
  });

  it('should allow member role to create a poll', async () => {
    const member = await loginAsMember('poll-creator');

    const res = await postSchedulingPoll(member.token, {
      gameId: testApp.seed.game.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      status: 'scheduling',
    });
  });

  it('should allow admin role to create a poll', async () => {
    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
    });

    expect(res.status).toBe(201);
  });
}
describe('POST /scheduling-polls — authentication', describeAuth);

// =====================================================================
// ROK-1034: Rescheduling poll event linkage
// =====================================================================
//
// All tests below MUST FAIL because the implementation does not exist yet:
// - rescheduling_poll_id column does not exist on the events table
// - StandalonePollService.create() does not set reschedulingPollId on events
// - completeStandalonePoll() does not cancel the linked event
// - Signup guard does not check reschedulingPollId
// - Notification splitting does not exist
// =====================================================================

// ── ROK-1034 AC1: POST with linkedEventId sets rescheduling_poll_id ──

function describeReschedulingPollId() {
  it('should set rescheduling_poll_id on the event when creating poll with linkedEventId', async () => {
    const event = await createEvent('Reschedule Me', testApp.seed.game.id);

    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });

    expect(res.status).toBe(201);

    // Read the event back from DB and verify reschedulingPollId is set
    const matchId = res.body.id as number;
    const [updatedEvent] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));

    // This will fail because the column does not exist yet
    expect((updatedEvent as Record<string, unknown>).reschedulingPollId).toBe(
      matchId,
    );
  });

  it('should NOT set rescheduling_poll_id when linkedEventId is omitted', async () => {
    const event = await createEvent('Not Linked', testApp.seed.game.id);

    const res = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
    });

    expect(res.status).toBe(201);

    // The event should have reschedulingPollId as null (column exists but unset)
    const [updatedEvent] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));

    // Will fail until the column is added — then should be null
    expect(updatedEvent).toHaveProperty('reschedulingPollId');
    expect(
      (updatedEvent as Record<string, unknown>).reschedulingPollId,
    ).toBeNull();
  });
}
describe(
  'ROK-1034 AC1 — rescheduling_poll_id linkage',
  describeReschedulingPollId,
);

// ── ROK-1034 AC2: GET /events excludes events being rescheduled ──────

function describeEventsExclusion() {
  it('should exclude events with rescheduling_poll_id from GET /events', async () => {
    const event = await createEvent('Hidden Event', testApp.seed.game.id);
    const visibleEvent = await createEvent(
      'Visible Event',
      testApp.seed.game.id,
    );

    // Create poll linked to the first event (sets rescheduling_poll_id)
    await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });

    // GET /events should only return the visible event
    const res = await testApp.request
      .get('/events')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    // Response shape is { data: [...], meta: {...} }
    const eventIds = (res.body.data as Array<{ id: number }>).map((e) => e.id);

    // The event being rescheduled should be hidden
    expect(eventIds).not.toContain(event.id);
    // The normal event should still appear
    expect(eventIds).toContain(visibleEvent.id);
  });
}
describe(
  'ROK-1034 AC2 — events query excludes rescheduling events',
  describeEventsExclusion,
);

// ── ROK-1034 AC3: POST /events/:id/signup on rescheduling event → 409

function describeSignupBlock() {
  it('should return 409 when signing up for an event being rescheduled', async () => {
    const event = await createEvent('Blocked Signup', testApp.seed.game.id);

    // Create a poll linked to this event
    await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });

    // Attempt to sign up — should be blocked with 409 Conflict
    const member = await loginAsMember('blocked-signup-user');
    const signupRes = await testApp.request
      .post(`/events/${event.id}/signup`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({});

    expect(signupRes.status).toBe(409);
  });
}
describe(
  'ROK-1034 AC3 — signup blocked during rescheduling',
  describeSignupBlock,
);

// ── ROK-1034 AC4: POST /scheduling-polls on already-rescheduling event → 409

function describeDuplicateReschedulingPoll() {
  it('should return 409 when creating a second poll for an event already being rescheduled', async () => {
    const event = await createEvent('Already Polling', testApp.seed.game.id);

    // First poll succeeds
    const firstRes = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });
    expect(firstRes.status).toBe(201);

    // Second poll for the same event should be rejected
    const secondRes = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });
    expect(secondRes.status).toBe(409);
  });
}
describe(
  'ROK-1034 AC4 — duplicate rescheduling poll rejected',
  describeDuplicateReschedulingPoll,
);

// ── ROK-1034 AC5: Poll completion cancels linked event ───────────────

function describePollCompletion() {
  it('should cancel linked event and clear rescheduling_poll_id when poll is completed', async () => {
    const event = await createEvent('Complete Me', testApp.seed.game.id);

    const pollRes = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });
    expect(pollRes.status).toBe(201);

    const matchId = pollRes.body.id as number;

    // Complete the poll
    const completeRes = await testApp.request
      .post(`/scheduling-polls/${matchId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(completeRes.status).toBe(200);

    // Verify: original event should now have cancelledAt set
    const [updatedEvent] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));

    expect(updatedEvent.cancelledAt).not.toBeNull();

    // Verify: rescheduling_poll_id should be cleared
    expect(
      (updatedEvent as Record<string, unknown>).reschedulingPollId,
    ).toBeNull();
  });
}
describe(
  'ROK-1034 AC5 — poll completion cancels linked event',
  describePollCompletion,
);

// ── ROK-1034 AC6: Poll expiry restores event ────────────────────────

function describePollExpiry() {
  it('should clear rescheduling_poll_id when poll auto-archives (expires)', async () => {
    const event = await createEvent('Expire Poll', testApp.seed.game.id);

    const pollRes = await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
      durationHours: 1, // short duration for test
    });
    expect(pollRes.status).toBe(201);

    const lineupId = pollRes.body.lineupId as number;

    // Force-archive the lineup via the admin status endpoint
    // (mimics what LineupPhaseProcessor does when the phase timer fires).
    // The auto-archive handler should detect the linked event and clear
    // its rescheduling_poll_id without cancelling it.
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'archived' });

    // After archival, the event's rescheduling_poll_id should be cleared
    const [updatedEvent] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));

    // Event should NOT be cancelled (poll expired, not completed)
    expect(updatedEvent.cancelledAt).toBeNull();

    // rescheduling_poll_id should be cleared so event reappears
    expect(updatedEvent).toHaveProperty('reschedulingPollId');
    expect(
      (updatedEvent as Record<string, unknown>).reschedulingPollId,
    ).toBeNull();
  });
}
describe(
  'ROK-1034 AC6 — poll expiry restores event visibility',
  describePollExpiry,
);

// ── ROK-1034 AC7: Roster members receive reschedule-specific DM ─────

function describeRosterNotifications() {
  it('should send reschedule-specific notification to roster members', async () => {
    const rosterMember = await loginAsMember('roster-notif');
    const event = await createEvent('Roster DM', testApp.seed.game.id);

    // Add roster member as signup on the event
    await addSignup(event.id, rosterMember.userId);

    // Create poll linked to the event
    await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });

    // Allow fire-and-forget notifications to complete
    await new Promise((r) => setTimeout(r, 500));

    // Check notification for roster member — should have reschedule subtype
    const notifications = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, rosterMember.userId));

    const rescheduleNotif = notifications.find((n) => {
      const payload = n.payload as Record<string, unknown> | null;
      return payload?.subtype === 'event_rescheduling';
    });

    expect(rescheduleNotif).toBeDefined();
    expect(rescheduleNotif!.title).toMatch(/reschedul/i);
  });
}
describe(
  'ROK-1034 AC7 — roster members get reschedule DM',
  describeRosterNotifications,
);

// ── ROK-1034 AC8: Game-interest-only users get generic DM ───────────

function describeInterestOnlyNotifications() {
  it('should send generic poll notification (not reschedule) to game-interest-only users', async () => {
    const interestUser = await loginAsMember('interest-notif');
    const event = await createEvent('Interest DM', testApp.seed.game.id);

    // User has game interest but is NOT signed up for the event
    await addGameInterest(interestUser.userId, testApp.seed.game.id);

    // Create poll linked to the event
    await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });

    // Allow fire-and-forget notifications to complete
    await new Promise((r) => setTimeout(r, 500));

    // Check notification for interest-only user — should have generic subtype
    const userNotifs = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, interestUser.userId));

    expect(userNotifs.length).toBeGreaterThanOrEqual(1);

    // Should receive ONLY generic notifications (not reschedule)
    for (const n of userNotifs) {
      const payload = n.payload as Record<string, unknown> | null;
      expect(payload?.subtype).not.toBe('event_rescheduling');
    }

    // At least one should be the standard scheduling poll notification
    const genericNotif = userNotifs.find((n) => {
      const payload = n.payload as Record<string, unknown> | null;
      return payload?.subtype === 'standalone_scheduling_poll';
    });
    expect(genericNotif).toBeDefined();
  });
}
describe(
  'ROK-1034 AC8 — interest-only users get generic DM',
  describeInterestOnlyNotifications,
);

// ── ROK-1034 AC9: Roster + interest user gets ONLY reschedule DM ────

function describeNotificationDedup() {
  it('should send ONLY reschedule DM to user who is both roster member and game-interested', async () => {
    const dualUser = await loginAsMember('dual-notif');
    const event = await createEvent('Dedup DM', testApp.seed.game.id);

    // User is both signed up for the event AND has game interest
    await addSignup(event.id, dualUser.userId);
    await addGameInterest(dualUser.userId, testApp.seed.game.id);

    // Create poll linked to the event
    await postSchedulingPoll(adminToken, {
      gameId: testApp.seed.game.id,
      linkedEventId: event.id,
    });

    // Allow fire-and-forget notifications to complete
    await new Promise((r) => setTimeout(r, 500));

    // Check notifications for dual user — should have exactly 1
    const notifications = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, dualUser.userId));

    // Dedup: should receive exactly ONE notification, not two
    expect(notifications).toHaveLength(1);

    // And it should be the reschedule-specific one (higher priority)
    const payload = notifications[0].payload as Record<string, unknown> | null;
    expect(payload?.subtype).toBe('event_rescheduling');
  });
}
describe(
  'ROK-1034 AC9 — notification dedup for dual roster+interest users',
  describeNotificationDedup,
);
