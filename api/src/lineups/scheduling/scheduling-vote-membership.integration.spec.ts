/**
 * Open-roster scheduling polls — voting enrolls the voter as a match member.
 *
 * Prod incident (2026-07-13, lineup 16 / match 40): slot voting is open to
 * any authenticated user, but community_lineup_match_members rows were only
 * written at poll creation (creator + explicit invitees) or at from-match
 * formation. Voters who weren't explicitly invited could vote (200) yet:
 *   - the participants list and the "N of M have voted" denominator excluded
 *     them ("Participants · 1", "3 of 1 have voted", "Just you so far"),
 *   - POST /lineups/:id/matches/:matchId/submit-scheduling 403'd them with
 *     "Not a member of this match" (lineup-submit.service.ts),
 *   - both scheduling reminder crons (member-derived audiences) skipped them.
 *
 * These tests pin the fix: POST .../vote and POST .../suggest enroll the
 * caller in community_lineup_match_members (source='bandwagon', idempotent,
 * sticky across un-vote), the poll response reflects the enrollment, and a
 * voter can then submit-scheduling. A user with no votes still cannot.
 */
import { eq, and } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

describe('Scheduling poll voting — open-roster member enrollment (integration)', () => {
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

  // ── helpers ────────────────────────────────────────────────────────

  /** Create a member user (+ local creds) and return id + login token. */
  async function createVoter(
    suffix: string,
  ): Promise<{ id: number; token: string }> {
    const email = `voter-${suffix}@test.local`;
    const hash = await bcrypt.hash('VoterPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `voter-${suffix}`,
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'VoterPass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  /**
   * Seed a schedulable match whose ONLY member is the creator (admin) —
   * the standalone-poll shape from the prod incident — plus one slot.
   */
  async function seedPoll(
    visibility: 'public' | 'private' = 'public',
  ): Promise<{
    lineupId: number;
    matchId: number;
    slotId: number;
  }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Open Roster Poll',
        createdBy: testApp.seed.adminUser.id,
        status: 'decided',
        visibility,
        publicSlug: generatePublicSlug(),
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
      userId: testApp.seed.adminUser.id,
      source: 'voted',
    });
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId: match.id,
        proposedTime: new Date('2099-04-01T19:00:00.000Z'),
        suggestedBy: 'system',
      })
      .returning();
    return { lineupId: lineup.id, matchId: match.id, slotId: slot.id };
  }

  function postVote(
    token: string,
    lineupId: number,
    matchId: number,
    slotId: number,
  ) {
    return testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });
  }

  async function memberRows(matchId: number, userId: number) {
    return testApp.db
      .select()
      .from(schema.communityLineupMatchMembers)
      .where(
        and(
          eq(schema.communityLineupMatchMembers.matchId, matchId),
          eq(schema.communityLineupMatchMembers.userId, userId),
        ),
      );
  }

  // ── vote → membership ──────────────────────────────────────────────

  it('voting enrolls a non-member voter as a match member (source=voted)', async () => {
    const voter = await createVoter('enroll');
    const { lineupId, matchId, slotId } = await seedPoll();

    const res = await postVote(voter.token, lineupId, matchId, slotId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ voted: true });

    const rows = await memberRows(matchId, voter.id);
    expect(rows).toHaveLength(1);
    // 'bandwagon' — joined after the decide-time snapshot; 'voted' is
    // reserved for game-phase voters (DecidedView matched-voter math).
    expect(rows[0].source).toBe('bandwagon');

    // Bug A regression: the poll page now counts the voter as a member,
    // so the "N of M have voted" denominator can never undercount voters.
    const poll = await testApp.request
      .get(`/lineups/${lineupId}/schedule/${matchId}`)
      .set('Authorization', `Bearer ${voter.token}`);
    expect(poll.status).toBe(200);
    const memberIds = (poll.body.match.members as { userId: number }[]).map(
      (m) => m.userId,
    );
    expect(memberIds).toContain(voter.id);
    expect(poll.body.uniqueVoterCount).toBe(1);
    expect(memberIds.length).toBeGreaterThanOrEqual(
      poll.body.uniqueVoterCount as number,
    );
  });

  it('re-voting and multi-slot voting keep a single member row', async () => {
    const voter = await createVoter('idempotent');
    const { lineupId, matchId, slotId } = await seedPoll();
    const [slot2] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date('2099-04-02T19:00:00.000Z'),
        suggestedBy: 'system',
      })
      .returning();

    await postVote(voter.token, lineupId, matchId, slotId);
    await postVote(voter.token, lineupId, matchId, slot2.id);

    expect(await memberRows(matchId, voter.id)).toHaveLength(1);
  });

  it('un-voting deletes the vote but keeps membership sticky', async () => {
    const voter = await createVoter('sticky');
    const { lineupId, matchId, slotId } = await seedPoll();

    await postVote(voter.token, lineupId, matchId, slotId);
    const off = await postVote(voter.token, lineupId, matchId, slotId);
    expect(off.body).toEqual({ voted: false });

    const votes = await testApp.db
      .select()
      .from(schema.communityLineupScheduleVotes)
      .where(eq(schema.communityLineupScheduleVotes.userId, voter.id));
    expect(votes).toHaveLength(0);
    expect(await memberRows(matchId, voter.id)).toHaveLength(1);
  });

  it('rejects a vote for a nonexistent slot without enrolling the caller', async () => {
    const voter = await createVoter('ghost-slot');
    const { lineupId, matchId } = await seedPoll();

    const res = await postVote(voter.token, lineupId, matchId, 999999);
    expect(res.status).toBe(404);
    expect(await memberRows(matchId, voter.id)).toHaveLength(0);
  });

  it('suggesting a time enrolls the suggester as a member', async () => {
    const voter = await createVoter('suggester');
    const { lineupId, matchId } = await seedPoll();

    const res = await testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/suggest`)
      .set('Authorization', `Bearer ${voter.token}`)
      .send({ proposedTime: '2099-05-01T19:00:00.000Z' });
    expect(res.status).toBe(201);

    const rows = await memberRows(matchId, voter.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('bandwagon');
  });

  // ── Bug B regression: voter can submit-scheduling ──────────────────

  it('a voter can submit-scheduling (regression: 403 "Not a member of this match")', async () => {
    const voter = await createVoter('submitter');
    const { lineupId, matchId, slotId } = await seedPoll();

    await postVote(voter.token, lineupId, matchId, slotId);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${matchId}/submit-scheduling`)
      .set('Authorization', `Bearer ${voter.token}`)
      .send();
    expect(res.status).toBe(200);

    const rows = await memberRows(matchId, voter.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].schedulingSubmittedAt).not.toBeNull();
  });

  it('a user with no votes still cannot submit-scheduling (guard intact)', async () => {
    const outsider = await createVoter('outsider');
    const { lineupId, matchId } = await seedPoll();

    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${matchId}/submit-scheduling`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send();
    expect(res.status).toBe(403);
    expect(await memberRows(matchId, outsider.id)).toHaveLength(0);
  });

  // ── slot↔match validation ──────────────────────────────────────────

  it('rejects a vote whose slotId belongs to a different match', async () => {
    const voter = await createVoter('crossmatch');
    const pollA = await seedPoll();
    // Second match under the same lineup with its own slot. Needs a second
    // game — (lineup_id, game_id) is unique on matches.
    const [gameB] = await testApp.db
      .insert(schema.games)
      .values({ name: 'Cross Match Game B', slug: 'cross-match-game-b' })
      .returning();
    const [matchB] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: pollA.lineupId,
        gameId: gameB.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning();
    const [slotB] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId: matchB.id,
        proposedTime: new Date('2099-06-01T19:00:00.000Z'),
        suggestedBy: 'system',
      })
      .returning();

    // Vote against match A's URL with match B's slot — must be rejected.
    const res = await postVote(
      voter.token,
      pollA.lineupId,
      pollA.matchId,
      slotB.id,
    );
    expect(res.status).toBe(404);

    const votes = await testApp.db
      .select()
      .from(schema.communityLineupScheduleVotes)
      .where(eq(schema.communityLineupScheduleVotes.userId, voter.id));
    expect(votes).toHaveLength(0);
    expect(await memberRows(pollA.matchId, voter.id)).toHaveLength(0);
    expect(await memberRows(matchB.id, voter.id)).toHaveLength(0);
  });

  // ── private lineups: participation gate on the vote surface ────────

  it('rejects a non-invitee vote on a private lineup without any writes', async () => {
    const outsider = await createVoter('private-outsider');
    const { lineupId, matchId, slotId } = await seedPoll('private');

    const res = await postVote(outsider.token, lineupId, matchId, slotId);
    expect(res.status).toBe(403);

    const votes = await testApp.db
      .select()
      .from(schema.communityLineupScheduleVotes)
      .where(eq(schema.communityLineupScheduleVotes.userId, outsider.id));
    expect(votes).toHaveLength(0);
    expect(await memberRows(matchId, outsider.id)).toHaveLength(0);
  });

  it('allows an invitee to vote on a private lineup and enrolls them', async () => {
    const invitee = await createVoter('private-invitee');
    const { lineupId, matchId, slotId } = await seedPoll('private');
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values({ lineupId, userId: invitee.id });

    const res = await postVote(invitee.token, lineupId, matchId, slotId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ voted: true });
    expect(await memberRows(matchId, invitee.id)).toHaveLength(1);
  });

  it('rejects a non-invitee suggest on a private lineup without creating a slot', async () => {
    const outsider = await createVoter('private-suggester');
    const { lineupId, matchId } = await seedPoll('private');

    const res = await testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/suggest`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ proposedTime: '2099-07-01T19:00:00.000Z' });
    expect(res.status).toBe(403);

    const slots = await testApp.db
      .select()
      .from(schema.communityLineupScheduleSlots)
      .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
    expect(slots).toHaveLength(1); // only the seeded slot
  });

  // ── admin sanity: creator path unaffected ──────────────────────────

  it('the creator voting on their own poll does not duplicate their member row', async () => {
    const { lineupId, matchId, slotId } = await seedPoll();

    const res = await postVote(adminToken, lineupId, matchId, slotId);
    expect(res.status).toBe(200);

    expect(await memberRows(matchId, testApp.seed.adminUser.id)).toHaveLength(
      1,
    );
  });
});
