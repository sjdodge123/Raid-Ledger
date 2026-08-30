/**
 * ROK-1440 — POST /lineups/:lineupId/schedule/:matchId/members.
 *
 * A poll's roster (`community_lineup_match_members`) was entirely derived —
 * you joined it by voting (`voted`) or via bandwagon clustering
 * (`bandwagon`) — so a creator could not enrol people they knew were playing,
 * and a poll whose `minVoteThreshold` exceeded the derived roster could never
 * reach its lock threshold.
 *
 * Covers the authorization rule (creator OR admin/operator, NOT any member),
 * idempotency, the cross-lineup match guard, and that the roster count the
 * poll header renders actually grows.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

function describeSchedulingMembers() {
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

  async function createUser(
    suffix: string,
    role: 'member' | 'operator' = 'member',
  ): Promise<{ id: number; token: string }> {
    const email = `members-${suffix}@test.local`;
    const hash = await bcrypt.hash('MembersPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:members-${suffix}`,
        username: `members-${suffix}`,
        role,
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'MembersPass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  async function seedPoll(
    creatorId: number,
    visibility: 'public' | 'private' = 'public',
  ): Promise<{ lineupId: number; matchId: number }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `Members Poll ${generatePublicSlug()}`,
        createdBy: creatorId,
        status: 'decided',
        visibility,
        publicSlug: generatePublicSlug(),
        includeSchedulingPhase: true,
      })
      .returning();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning();
    await testApp.db.insert(schema.communityLineupMatchMembers).values({
      matchId: match.id,
      userId: creatorId,
      source: 'voted',
    });
    return { lineupId: lineup.id, matchId: match.id };
  }

  function postMembers(
    token: string,
    lineupId: number,
    matchId: number,
    userIds: number[],
  ) {
    return testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userIds });
  }

  function loadRoster(matchId: number) {
    return testApp.db
      .select({
        userId: schema.communityLineupMatchMembers.userId,
        source: schema.communityLineupMatchMembers.source,
      })
      .from(schema.communityLineupMatchMembers)
      .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
  }

  // ── The reported scenario ─────────────────────────────────────

  it('lets a non-operator CREATOR enrol members and grows the denominator', async () => {
    const creator = await createUser('creator');
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const res = await postMembers(creator.token, lineupId, matchId, [
      alice.id,
      bob.id,
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ added: 2, memberCount: 3 });
    const roster = await loadRoster(matchId);
    expect(roster).toHaveLength(3);
    expect(
      roster
        .filter((r) => r.source === 'added')
        .map((r) => r.userId)
        .sort(),
    ).toEqual([alice.id, bob.id].sort());
  });

  it('stamps the new rows with source "added", leaving derived rows alone', async () => {
    const creator = await createUser('src-creator');
    const alice = await createUser('src-alice');
    const { lineupId, matchId } = await seedPoll(creator.id);

    await postMembers(creator.token, lineupId, matchId, [alice.id]);

    const roster = await loadRoster(matchId);
    const byUser = new Map(roster.map((r) => [r.userId, r.source]));
    expect(byUser.get(alice.id)).toBe('added');
    expect(byUser.get(creator.id)).toBe('voted');
  });

  // ── Authorization ─────────────────────────────────────────────

  it('allows an operator who is not the creator', async () => {
    const creator = await createUser('op-creator');
    const op = await createUser('op-actor', 'operator');
    const alice = await createUser('op-alice');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const res = await postMembers(op.token, lineupId, matchId, [alice.id]);

    expect(res.status).toBe(200);
  });

  it('403s an ordinary member who is neither creator nor operator', async () => {
    const creator = await createUser('403-creator');
    const stranger = await createUser('403-stranger');
    const alice = await createUser('403-alice');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const res = await postMembers(stranger.token, lineupId, matchId, [
      alice.id,
    ]);

    expect(res.status).toBe(403);
    expect(await loadRoster(matchId)).toHaveLength(1);
  });

  it('401s without a token', async () => {
    const creator = await createUser('401-creator');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/members`)
      .send({ userIds: [creator.id] });

    expect(res.status).toBe(401);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('is idempotent — re-adding an existing member is a no-op, not an error', async () => {
    const creator = await createUser('idem-creator');
    const alice = await createUser('idem-alice');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const first = await postMembers(creator.token, lineupId, matchId, [
      alice.id,
    ]);
    const second = await postMembers(creator.token, lineupId, matchId, [
      alice.id,
    ]);

    expect(first.body).toEqual({ added: 1, memberCount: 2 });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ added: 0, memberCount: 2 });
    expect(await loadRoster(matchId)).toHaveLength(2);
  });

  it('does not double-insert a user already in the roster via voting', async () => {
    const creator = await createUser('dup-creator');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const res = await postMembers(creator.token, lineupId, matchId, [
      creator.id,
    ]);

    expect(res.body).toEqual({ added: 0, memberCount: 1 });
  });

  it('404s when the match belongs to a different lineup', async () => {
    const creator = await createUser('xlineup-creator');
    const alice = await createUser('xlineup-alice');
    const mine = await seedPoll(creator.id);
    const other = await seedPoll(creator.id);

    const res = await postMembers(creator.token, mine.lineupId, other.matchId, [
      alice.id,
    ]);

    expect(res.status).toBe(404);
    expect(await loadRoster(other.matchId)).toHaveLength(1);
  });

  it('404s on an unknown user id instead of throwing an FK error', async () => {
    const creator = await createUser('unknown-creator');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const res = await postMembers(
      creator.token,
      lineupId,
      matchId,
      [999_999_999],
    );

    expect(res.status).toBe(404);
    expect(await loadRoster(matchId)).toHaveLength(1);
  });

  it('400s on an empty userIds array', async () => {
    const creator = await createUser('empty-creator');
    const { lineupId, matchId } = await seedPoll(creator.id);

    const res = await postMembers(creator.token, lineupId, matchId, []);

    expect(res.status).toBe(400);
  });

  // ── Codex P2: poll state guards ───────────────────────────────

  it('400s once the match is no longer accepting changes', async () => {
    const creator = await createUser('closed-creator');
    const alice = await createUser('closed-alice');
    const { lineupId, matchId } = await seedPoll(creator.id);
    await testApp.db
      .update(schema.communityLineupMatches)
      .set({ status: 'scheduled' })
      .where(eq(schema.communityLineupMatches.id, matchId));

    const res = await postMembers(creator.token, lineupId, matchId, [alice.id]);

    expect(res.status).toBe(400);
    expect(await loadRoster(matchId)).toHaveLength(1);
  });

  it('404s when the lineup opted out of the scheduling phase', async () => {
    const creator = await createUser('optout-creator');
    const alice = await createUser('optout-alice');
    const { lineupId, matchId } = await seedPoll(creator.id);
    await testApp.db
      .update(schema.communityLineups)
      .set({ includeSchedulingPhase: false })
      .where(eq(schema.communityLineups.id, lineupId));

    const res = await postMembers(creator.token, lineupId, matchId, [alice.id]);

    expect(res.status).toBe(404);
    expect(await loadRoster(matchId)).toHaveLength(1);
  });

  // ── Codex P2: private lineups need the invitee mirror ─────────

  it('mirrors added members into the invitee list on a PRIVATE lineup', async () => {
    const creator = await createUser('mirror-creator');
    const alice = await createUser('mirror-alice');
    const { lineupId, matchId } = await seedPoll(creator.id, 'private');

    const res = await postMembers(creator.token, lineupId, matchId, [alice.id]);

    expect(res.status).toBe(200);
    // Without the mirror, alice is a match member who can never vote
    // (assertCallerMayVote gates private polls on creator|invitee|admin) —
    // she would inflate the denominator and make the lock unreachable.
    const invitees = await testApp.db
      .select({ userId: schema.communityLineupInvitees.userId })
      .from(schema.communityLineupInvitees)
      .where(eq(schema.communityLineupInvitees.lineupId, lineupId));
    expect(invitees.map((i) => i.userId)).toContain(alice.id);
  });

  it('does NOT create invitee rows for a PUBLIC lineup', async () => {
    const creator = await createUser('nomirror-creator');
    const alice = await createUser('nomirror-alice');
    const { lineupId, matchId } = await seedPoll(creator.id, 'public');

    await postMembers(creator.token, lineupId, matchId, [alice.id]);

    const invitees = await testApp.db
      .select({ userId: schema.communityLineupInvitees.userId })
      .from(schema.communityLineupInvitees)
      .where(eq(schema.communityLineupInvitees.lineupId, lineupId));
    expect(invitees).toHaveLength(0);
  });

  it('works on a private lineup too (admin path)', async () => {
    const creator = await createUser('priv-creator');
    const alice = await createUser('priv-alice');
    const { lineupId, matchId } = await seedPoll(creator.id, 'private');

    const res = await postMembers(adminToken, lineupId, matchId, [alice.id]);

    expect(res.status).toBe(200);
    expect(res.body.memberCount).toBe(2);
  });
}

describe(
  'Scheduling — explicit poll members (integration)',
  describeSchedulingMembers,
);
