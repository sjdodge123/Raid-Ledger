/**
 * Standalone Scheduling Poll Integration Tests (ROK-977)
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
 * Acceptance Criteria covered:
 *   AC1: POST with valid gameId creates lineup (decided) + match (scheduling)
 *   AC2: Match members inserted for provided memberUserIds
 *   AC3: Phase timer scheduled when durationHours provided
 *   AC4: 404 when gameId doesn't exist
 *   AC5: 404 when linkedEventId doesn't exist
 *   AC6: Any authenticated user can create (no operator role required)
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';

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

// ── AC1: POST with valid gameId creates lineup + match ───────

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

// ── AC2: Match members inserted for provided memberUserIds ───

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

// ── AC3: Phase timer scheduled when durationHours provided ───

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

// ── AC4: 404 when gameId doesn't exist ───────────────────────

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

// ── AC5: 404 when linkedEventId doesn't exist ────────────────

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

// ── AC6: Any authenticated user can create ───────────────────

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
