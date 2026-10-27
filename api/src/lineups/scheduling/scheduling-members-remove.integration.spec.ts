/**
 * ROK-2020 — DELETE /lineups/:lineupId/schedule/:matchId/members/:userId.
 *
 * The poll creator or staff can take a participant off a scheduling poll:
 * their roster row AND their votes on this poll go in one transaction, so the
 * poll page's tally and "N still to vote" (both derived on read) drop with
 * them. Covers the permission rule (same as add — creator OR admin/operator,
 * NOT any member), the creator self-remove refusal, and the poll-state guards
 * shared with add-members.
 */
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { nonEmpty } from '../../common/testing/narrow';

interface SeededPoll {
  lineupId: number;
  matchId: number;
  slotId: number;
}

function describeRemoveMember() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function createUser(
    suffix: string,
    role: 'member' | 'operator' = 'member',
  ): Promise<{ id: number; token: string }> {
    const email = `remove-${suffix}@test.local`;
    const hash = await bcrypt.hash('RemovePass1!', 4);
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `discord:remove-${suffix}`,
          username: `remove-${suffix}`,
          role,
        })
        .returning(),
      'user',
    );
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'RemovePass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  /** Lineup + scheduling match + one slot; the creator is a `voted` member. */
  async function seedPoll(creatorId: number): Promise<SeededPoll> {
    const [lineup] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: `Remove Poll ${generatePublicSlug()}`,
          createdBy: creatorId,
          status: 'decided',
          visibility: 'public',
          publicSlug: generatePublicSlug(),
          includeSchedulingPhase: true,
        })
        .returning(),
      'lineup',
    );
    const [match] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupMatches)
        .values({
          lineupId: lineup.id,
          gameId: testApp.seed.game.id,
          status: 'scheduling',
          thresholdMet: true,
          voteCount: 1,
        })
        .returning(),
      'match',
    );
    await testApp.db.insert(schema.communityLineupMatchMembers).values({
      matchId: match.id,
      userId: creatorId,
      source: 'voted',
    });
    const [slot] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupScheduleSlots)
        .values({
          matchId: match.id,
          proposedTime: new Date('2099-04-01T19:00:00.000Z'),
          suggestedBy: 'system',
        })
        .returning(),
      'slot',
    );
    return { lineupId: lineup.id, matchId: match.id, slotId: slot.id };
  }

  /** Enrol `userId` on the poll and record a yes on its slot. */
  async function enrolVoter(poll: SeededPoll, userId: number): Promise<void> {
    await testApp.db.insert(schema.communityLineupMatchMembers).values({
      matchId: poll.matchId,
      userId,
      source: 'bandwagon',
    });
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId: poll.slotId, userId, stance: 'yes' });
  }

  function removeMember(
    token: string,
    poll: Pick<SeededPoll, 'lineupId' | 'matchId'>,
    userId: number,
  ) {
    return testApp.request
      .delete(
        `/lineups/${poll.lineupId}/schedule/${poll.matchId}/members/${userId}`,
      )
      .set('Authorization', `Bearer ${token}`);
  }

  function memberRows(matchId: number, userId: number) {
    return testApp.db
      .select({ id: schema.communityLineupMatchMembers.id })
      .from(schema.communityLineupMatchMembers)
      .where(
        and(
          eq(schema.communityLineupMatchMembers.matchId, matchId),
          eq(schema.communityLineupMatchMembers.userId, userId),
        ),
      );
  }

  function voteRows(slotId: number, userId: number) {
    return testApp.db
      .select({ id: schema.communityLineupScheduleVotes.id })
      .from(schema.communityLineupScheduleVotes)
      .where(
        and(
          eq(schema.communityLineupScheduleVotes.slotId, slotId),
          eq(schema.communityLineupScheduleVotes.userId, userId),
        ),
      );
  }

  /** Seed creator + one enrolled voter; returns everything the cases need. */
  async function seedWithVoter(prefix: string) {
    const creator = await createUser(`${prefix}-creator`);
    const voter = await createUser(`${prefix}-voter`);
    const poll = await seedPoll(creator.id);
    await enrolVoter(poll, voter.id);
    return { creator, voter, poll };
  }

  /** The removal must leave the voter's row and vote exactly as seeded. */
  async function expectVoterIntact(poll: SeededPoll, voterId: number) {
    expect(await memberRows(poll.matchId, voterId)).toHaveLength(1);
    expect(await voteRows(poll.slotId, voterId)).toHaveLength(1);
  }

  // ── The reported scenario ─────────────────────────────────────

  it('lets a non-operator CREATOR remove a voter: row + votes gone, tally and roster drop', async () => {
    const { creator, voter, poll } = await seedWithVoter('happy');

    const before = await testApp.request
      .get(`/lineups/${poll.lineupId}/schedule/${poll.matchId}`)
      .set('Authorization', `Bearer ${creator.token}`);
    expect(before.status).toBe(200);
    expect(before.body.uniqueVoterCount).toBe(1);

    const res = await removeMember(creator.token, poll, voter.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removedVotes: 1, memberCount: 1 });
    expect(await memberRows(poll.matchId, voter.id)).toHaveLength(0);
    expect(await voteRows(poll.slotId, voter.id)).toHaveLength(0);

    const after = await testApp.request
      .get(`/lineups/${poll.lineupId}/schedule/${poll.matchId}`)
      .set('Authorization', `Bearer ${creator.token}`);
    expect(after.status).toBe(200);
    expect(after.body.uniqueVoterCount).toBe(0);
    const memberIds = (after.body.match.members as { userId: number }[]).map(
      (m) => m.userId,
    );
    expect(memberIds).not.toContain(voter.id);
    expect(memberIds).toContain(creator.id);

    const roster = await testApp.request
      .get(`/lineups/${poll.lineupId}/participants?matchId=${poll.matchId}`)
      .set('Authorization', `Bearer ${creator.token}`);
    expect(roster.status).toBe(200);
    const rosterIds = (roster.body.participants as { userId: number }[]).map(
      (p) => p.userId,
    );
    expect(rosterIds).not.toContain(voter.id);
  });

  it("leaves the user's votes on ANOTHER poll untouched", async () => {
    const { creator, voter, poll } = await seedWithVoter('scope');
    const otherPoll = await seedPoll(creator.id);
    await enrolVoter(otherPoll, voter.id);

    const res = await removeMember(creator.token, poll, voter.id);

    expect(res.status).toBe(200);
    await expectVoterIntact(otherPoll, voter.id);
  });

  // ── Authorization ─────────────────────────────────────────────

  it('allows an operator who is not the creator', async () => {
    const { voter, poll } = await seedWithVoter('op');
    const op = await createUser('op-actor', 'operator');

    const res = await removeMember(op.token, poll, voter.id);

    expect(res.status).toBe(200);
    expect(await memberRows(poll.matchId, voter.id)).toHaveLength(0);
  });

  it('403s an ordinary member who is neither creator nor operator, writing nothing', async () => {
    const { voter, poll } = await seedWithVoter('403');
    const stranger = await createUser('403-stranger');

    const res = await removeMember(stranger.token, poll, voter.id);

    expect(res.status).toBe(403);
    await expectVoterIntact(poll, voter.id);
  });

  it('401s without a token', async () => {
    const { voter, poll } = await seedWithVoter('401');

    const res = await testApp.request.delete(
      `/lineups/${poll.lineupId}/schedule/${poll.matchId}/members/${voter.id}`,
    );

    expect(res.status).toBe(401);
    await expectVoterIntact(poll, voter.id);
  });

  // ── Creator / target guards ───────────────────────────────────

  it('400s the creator removing themselves, keeping their row', async () => {
    const { creator, poll } = await seedWithVoter('self');

    const res = await removeMember(creator.token, poll, creator.id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "The poll creator can't be removed — cancel the poll instead",
    );
    expect(await memberRows(poll.matchId, creator.id)).toHaveLength(1);
  });

  it('400s an operator removing the creator, keeping their row', async () => {
    const { creator, poll } = await seedWithVoter('staff-creator');
    const op = await createUser('staff-creator-op', 'operator');

    const res = await removeMember(op.token, poll, creator.id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "The poll creator can't be removed — cancel the poll instead",
    );
    expect(await memberRows(poll.matchId, creator.id)).toHaveLength(1);
  });

  it('404s a user who is not a participant of this poll', async () => {
    const { creator, poll } = await seedWithVoter('nonpart');
    const outsider = await createUser('nonpart-outsider');

    const res = await removeMember(creator.token, poll, outsider.id);

    expect(res.status).toBe(404);
  });

  it("404s another user's lineup id against this poll's match (IDOR), voter intact", async () => {
    const { voter, poll } = await seedWithVoter('xlineup');
    const otherOwner = await createUser('xlineup-other-owner');
    const otherLineup = await seedPoll(otherOwner.id);

    const res = await removeMember(
      otherOwner.token,
      { lineupId: otherLineup.lineupId, matchId: poll.matchId },
      voter.id,
    );

    expect(res.status).toBe(404);
    await expectVoterIntact(poll, voter.id);
  });

  // ── Poll state guards (shared with add-members) ───────────────

  it('400s once the match is no longer accepting changes', async () => {
    const { creator, voter, poll } = await seedWithVoter('closed');
    await testApp.db
      .update(schema.communityLineupMatches)
      .set({ status: 'scheduled' })
      .where(eq(schema.communityLineupMatches.id, poll.matchId));

    const res = await removeMember(creator.token, poll, voter.id);

    expect(res.status).toBe(400);
    await expectVoterIntact(poll, voter.id);
  });

  it.each([
    ['archived parent lineup', { status: 'archived' as const }],
    ['passed phase deadline', { phaseDeadline: new Date('2000-01-01') }],
  ])(
    '400s an expired poll (%s) while the match is still scheduling, voter intact',
    async (_label, lifecycle) => {
      const { creator, voter, poll } = await seedWithVoter(
        `expired-${_label.split(' ')[0]}`,
      );
      await testApp.db
        .update(schema.communityLineups)
        .set(lifecycle)
        .where(eq(schema.communityLineups.id, poll.lineupId));

      const res = await removeMember(creator.token, poll, voter.id);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This poll no longer accepts changes');
      await expectVoterIntact(poll, voter.id);
    },
  );

  it('404s when the lineup opted out of the scheduling phase', async () => {
    const { creator, voter, poll } = await seedWithVoter('optout');
    await testApp.db
      .update(schema.communityLineups)
      .set({ includeSchedulingPhase: false })
      .where(eq(schema.communityLineups.id, poll.lineupId));

    const res = await removeMember(creator.token, poll, voter.id);

    expect(res.status).toBe(404);
    await expectVoterIntact(poll, voter.id);
  });
}

describe('Scheduling poll remove member (ROK-2020)', () =>
  describeRemoveMember());
