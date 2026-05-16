/**
 * ROK-1258: Hybrid voter-participation policy for private lineup quorum.
 *
 * Pre-fix behavior: every invitee in a private lineup had to cast their full
 * vote allotment before voting → decided would auto-advance. When 5 invitees
 * were on the roster but only 3 actually voted, quorum was mathematically
 * impossible and the lineup stalled forever.
 *
 * Post-fix policy (operator-locked):
 *   - Time-based grace — after votingDeadline passes, drop invitees who have
 *     not voted at all.
 *   - Creator-driven removal — anytime, creator can DELETE an invitee; the
 *     same call now triggers maybeAutoAdvance so quorum re-evaluates.
 *
 * Cases:
 *   AC3 — 5 invitees, 3 vote; past-date the deadline → advance fires.
 *   AC4 — 5 invitees, 3 vote, deadline future; creator removes the 2
 *         non-voters → advance fires.
 *   Reg — Creator never dropped even past deadline (solo creator gates).
 *   Reg — Pre-deadline still blocks when an invitee hasn't voted.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { maybeAutoAdvance } from './lineups-auto-advance.helpers';
import { LineupsService } from './lineups.service';

function describeParticipationPolicy() {
  let testApp: TestApp;
  let adminToken: string;
  let settings: SettingsService;
  let lineupsService: LineupsService;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    settings = testApp.app.get(SettingsService);
    lineupsService = testApp.app.get(LineupsService);
    // graceMs=0 escape hatch so advance is observable synchronously.
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '0');
  });

  afterAll(async () => {
    await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '0');
  });

  async function createMember(
    tag: string,
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('PolicyTest1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@policy.local`,
        username: tag,
        role: 'member',
      })
      .returning();
    const email = `${tag}@policy.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'PolicyTest1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createPrivateLineup(token: string, inviteeUserIds: number[]) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Policy Lineup',
        visibility: 'private',
        inviteeUserIds,
      });
  }

  async function createGames(count: number) {
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = await testApp.db
        .insert(schema.games)
        .values({
          name: `Policy Game ${i + 1}`,
          slug: `policy-game-${i + 1}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,
        })
        .returning();
      games.push(game);
    }
    return games;
  }

  async function nominate(token: string, lineupId: number, gameId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/nominate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
  }

  async function vote(token: string, lineupId: number, gameId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
  }

  async function advanceToVoting(lineupId: number, token: string) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'voting' });
  }

  async function readStatus(lineupId: number): Promise<string> {
    const [row] = await testApp.db
      .select({ status: schema.communityLineups.status })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    return row?.status ?? 'missing';
  }

  async function backdateVotingDeadline(lineupId: number): Promise<void> {
    // The voting phase deadline is stored in phase_deadline (the transition
    // helper always writes it from the default 48h voting duration).
    // voting_deadline is only set when the DTO explicitly provides one.
    // The hybrid policy reads phase_deadline ?? voting_deadline, matching
    // lineup-reminder.service.ts.
    await testApp.db
      .update(schema.communityLineups)
      .set({ phaseDeadline: new Date(Date.now() - 60_000) })
      .where(eq(schema.communityLineups.id, lineupId));
  }

  /**
   * Set up a private 5-invitee lineup, advance to voting, and have only 3
   * voters cast their full allotment. Leaves 2 invitees with 0 votes.
   *
   * Returns the lineup id + the two non-voter invitee user ids so callers
   * can either pass the deadline or remove them depending on the case.
   */
  async function setupPartiallyVoted(): Promise<{
    lineupId: number;
    nonVoter1: number;
    nonVoter2: number;
  }> {
    const voter1 = await createMember('hp-v1');
    const voter2 = await createMember('hp-v2');
    const nonVoter1 = await createMember('hp-nv1');
    const nonVoter2 = await createMember('hp-nv2');

    const createRes = await createPrivateLineup(adminToken, [
      voter1.userId,
      voter2.userId,
      nonVoter1.userId,
      nonVoter2.userId,
    ]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    // Each voter (admin + voter1 + voter2) needs 3 distinct vote targets, so
    // floor a unique pool of 7 games (one shared favorite + 2 personal each).
    const games = await createGames(7);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(voter1.token, lineupId, games[1].id);
    await nominate(voter2.token, lineupId, games[2].id);
    await nominate(adminToken, lineupId, games[3].id);
    await nominate(voter1.token, lineupId, games[4].id);
    await nominate(voter2.token, lineupId, games[5].id);
    await nominate(adminToken, lineupId, games[6].id);

    const adv = await advanceToVoting(lineupId, adminToken);
    expect(adv.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('voting');

    // Each of the 3 voters uses their full 3-vote allotment; nonVoter1/2 stay
    // silent so quorum can't close under the pre-fix policy.
    // Distribution: g0 wins (3 votes) and each voter picks 2 distinct
    // personal games so no second-place tie can produce TIEBREAKER_REQUIRED.
    await vote(adminToken, lineupId, games[0].id);
    await vote(adminToken, lineupId, games[1].id);
    await vote(adminToken, lineupId, games[2].id);
    await vote(voter1.token, lineupId, games[0].id);
    await vote(voter1.token, lineupId, games[3].id);
    await vote(voter1.token, lineupId, games[4].id);
    await vote(voter2.token, lineupId, games[0].id);
    await vote(voter2.token, lineupId, games[5].id);
    await vote(voter2.token, lineupId, games[6].id);
    // Pre-fix would have hung here. Post-fix only fires once we either pass
    // the deadline or remove the non-voters.
    expect(await readStatus(lineupId)).toBe('voting');

    return {
      lineupId,
      nonVoter1: nonVoter1.userId,
      nonVoter2: nonVoter2.userId,
    };
  }

  // AC3 — time-based grace after deadline passes.
  it('advances voting → decided when the voting deadline has passed and non-voters are dropped', async () => {
    const { lineupId } = await setupPartiallyVoted();

    await backdateVotingDeadline(lineupId);
    await maybeAutoAdvance(lineupsService.autoAdvanceDeps(), lineupId);

    expect(await readStatus(lineupId)).toBe('decided');
  });

  // AC4 — creator-driven removal unblocks immediately, deadline still future.
  it('advances immediately when the creator removes the only outstanding non-voters', async () => {
    const { lineupId, nonVoter1, nonVoter2 } = await setupPartiallyVoted();

    // Sanity: phase_deadline is set by the building→voting transition; it
    // MUST still be in the future for this case (so we know the unblock came
    // from removeInvitee, not the time-based grace).
    const [row] = await testApp.db
      .select({ deadline: schema.communityLineups.phaseDeadline })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    expect(row?.deadline).toBeTruthy();
    expect(row.deadline!.getTime()).toBeGreaterThan(Date.now());

    const drop1 = await testApp.request
      .delete(`/lineups/${lineupId}/invitees/${nonVoter1}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(drop1.status).toBe(200);
    // After dropping the FIRST non-voter, the SECOND non-voter still blocks.
    // graceMs=0 means the in-test note in the planner about "may show
    // decided immediately or after grace in prod" defaults to immediately.
    expect(await readStatus(lineupId)).toBe('voting');

    const drop2 = await testApp.request
      .delete(`/lineups/${lineupId}/invitees/${nonVoter2}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(drop2.status).toBe(200);

    // The removeInvitee call itself triggered maybeAutoAdvance with grace=0.
    expect(await readStatus(lineupId)).toBe('decided');
  });

  // Regression — creator is never dropped, even past deadline.
  it('keeps the lineup in voting when only the creator has not voted (creator never dropped)', async () => {
    // Solo-creator-style: one invitee who casts full allotment, creator never
    // votes. Past deadline → invitee remains (they voted), creator remains
    // (always). Both must hit allotment → not ready (creator at 0).
    const invitee = await createMember('creator-gate-1');
    const createRes = await createPrivateLineup(adminToken, [invitee.userId]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const games = await createGames(3);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(invitee.token, lineupId, games[1].id);
    await nominate(adminToken, lineupId, games[2].id);

    await advanceToVoting(lineupId, adminToken);
    expect(await readStatus(lineupId)).toBe('voting');

    // Only the invitee votes; admin (creator) stays silent.
    for (const g of games) {
      await vote(invitee.token, lineupId, g.id);
    }
    expect(await readStatus(lineupId)).toBe('voting');

    await backdateVotingDeadline(lineupId);
    await maybeAutoAdvance(lineupsService.autoAdvanceDeps(), lineupId);

    // Creator never dropped → still gating → stays in voting.
    expect(await readStatus(lineupId)).toBe('voting');
  });

  // Regression — pre-deadline still blocks on missing voters.
  it('does not advance pre-deadline when an invitee still has not voted', async () => {
    const { lineupId } = await setupPartiallyVoted();

    // Do NOT backdate. The deadline is still in the future. Even after
    // forcing an explicit re-evaluation, the lineup must stay in voting.
    await maybeAutoAdvance(lineupsService.autoAdvanceDeps(), lineupId);

    expect(await readStatus(lineupId)).toBe('voting');
  });

  // ROK-1258 Codex-P2 #1 regression: stillWaitingOnVoters must mirror the
  // quorum-gating set, not just "voted < required". Otherwise the panel
  // can claim "still waiting on N" after the gating set already dropped
  // zero-voters post-deadline (which would contradict auto-advance).
  it('stillWaitingOnVoters drops zero-voters post-deadline (matches gating set)', async () => {
    const { lineupId, nonVoter1, nonVoter2 } = await setupPartiallyVoted();

    // Pre-deadline: panel lists the 2 zero-voters (they're in the gating set
    // AND under allotment).
    const preDeadlineDetail = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(preDeadlineDetail.status).toBe(200);
    const preIds = (
      preDeadlineDetail.body.stillWaitingOnVoters as { id: number }[]
    ).map((v) => v.id);
    expect(preIds).toEqual(expect.arrayContaining([nonVoter1, nonVoter2]));

    // Post-deadline: zero-voters drop out of the gating set, so the panel
    // must drop them too. The lineup itself may still be in voting until the
    // next maybeAutoAdvance fires, but the panel must NOT name the dropped
    // users (would mislead the creator into waiting on people no longer
    // gating quorum).
    await backdateVotingDeadline(lineupId);
    const postDeadlineDetail = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(postDeadlineDetail.status).toBe(200);
    const postIds = (
      postDeadlineDetail.body.stillWaitingOnVoters as { id: number }[]
    ).map((v) => v.id);
    expect(postIds).not.toContain(nonVoter1);
    expect(postIds).not.toContain(nonVoter2);
  });
}

describe(
  'Lineup hybrid voter-participation policy (ROK-1258, integration)',
  describeParticipationPolicy,
);
