/**
 * Manual "remind voters" nudge — POST /lineups/:lineupId/schedule/:matchId/remind
 * (ROK-1395, integration).
 *
 * Pins the acceptance criteria against a real Postgres:
 *   - creator triggers → each non-voter member gets ONE notification with the
 *     cron-compatible payload; voters get none; the actor never self-nudges
 *   - 1h per-match cooldown → second call 429, zero new rows
 *   - 24h per-recipient dedup survives a cooldown reset (button-mashing and
 *     cooldown expiry cannot double-send); fresh members still get nudged
 *   - authz: plain member 403 (and the failed call must NOT arm the cooldown);
 *     admin and operator allowed
 *   - works on deadline-less polls (phase_deadline IS NULL — the case the
 *     reminder crons can never cover)
 *   - private lineups: audience limited to invitees ∪ creator
 *   - state guards: cross-lineup matchId 404 (ROK-1306), non-schedulable
 *     match 400, scheduling-disabled lineup 404, unauthenticated 401
 */
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

describe('Scheduling poll manual remind (integration, ROK-1395)', () => {
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

  /** Create a discord-linked user (+ local creds) and return id + token. */
  async function createUser(
    suffix: string,
    role: 'member' | 'operator' = 'member',
  ): Promise<{ id: number; token: string }> {
    const email = `remind-${suffix}@test.local`;
    const hash = await bcrypt.hash('RemindPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:remind-${suffix}`,
        username: `remind-${suffix}`,
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
      .send({ email, password: 'RemindPass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  /**
   * Seed a schedulable poll. Deliberately NO phase_deadline (deadline-less
   * — the audience the cron reminders can never reach) unless overridden.
   */
  async function seedPoll(opts: {
    creatorId: number;
    visibility?: 'public' | 'private';
    includeSchedulingPhase?: boolean;
  }): Promise<{ lineupId: number; matchId: number; slotId: number }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `Remind Poll ${generatePublicSlug()}`,
        createdBy: opts.creatorId,
        status: 'decided',
        visibility: opts.visibility ?? 'public',
        publicSlug: generatePublicSlug(),
        includeSchedulingPhase: opts.includeSchedulingPhase ?? true,
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
    await addMember(match.id, opts.creatorId, 'voted');
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

  async function addMember(
    matchId: number,
    userId: number,
    source: 'voted' | 'bandwagon' = 'bandwagon',
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupMatchMembers)
      .values({ matchId, userId, source });
  }

  async function castScheduleVote(
    slotId: number,
    userId: number,
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId, userId });
  }

  function postRemind(token: string, lineupId: number, matchId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/remind`)
      .set('Authorization', `Bearer ${token}`)
      .send();
  }

  /** Scheduling-reminder notifications persisted for a user. */
  async function remindNotifsFor(userId: number) {
    const rows = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    return rows.filter(
      (r) =>
        (r.payload as { subtype?: string } | null)?.subtype ===
        'lineup_scheduling_reminder',
    );
  }

  /**
   * Simulate the 1h cooldown expiring: remove the per-match cooldown key
   * from BOTH dedup layers (Redis fast-path + Postgres persistence). The
   * per-recipient 24h keys are left intact on purpose.
   */
  async function expireCooldown(matchId: number): Promise<void> {
    const key = `lineup-sched-manual-remind-cooldown:${matchId}`;
    testApp.redisMock.store.delete(key);
    await testApp.db
      .delete(schema.notificationDedup)
      .where(eq(schema.notificationDedup.dedupKey, key));
  }

  // ── audience + payload ─────────────────────────────────────────────

  it('creator nudges non-voter members once; voters and the actor get nothing (deadline-less poll)', async () => {
    const creator = await createUser('creator');
    const voter = await createUser('voter');
    const nonVoter = await createUser('nonvoter');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await addMember(matchId, voter.id);
    await addMember(matchId, nonVoter.id);
    await castScheduleVote(slotId, voter.id);

    // The poll this feature exists for: no deadline → crons never fire.
    const [lineup] = await testApp.db
      .select({ phaseDeadline: schema.communityLineups.phaseDeadline })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    expect(lineup.phaseDeadline).toBeNull();

    const res = await postRemind(creator.token, lineupId, matchId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminded: 1, skipped: 0 });

    const nonVoterNotifs = await remindNotifsFor(nonVoter.id);
    expect(nonVoterNotifs).toHaveLength(1);
    expect(nonVoterNotifs[0].payload).toEqual({
      subtype: 'lineup_scheduling_reminder',
      lineupId,
      matchId,
    });
    expect(await remindNotifsFor(voter.id)).toHaveLength(0);
    // The actor is a non-voter member too — but never self-nudges.
    expect(await remindNotifsFor(creator.id)).toHaveLength(0);
  });

  // ── cooldown + per-recipient dedup ─────────────────────────────────

  it('second trigger within the cooldown → 429 and zero new notifications', async () => {
    const creator = await createUser('cd-creator');
    const nonVoter = await createUser('cd-nonvoter');
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });
    await addMember(matchId, nonVoter.id);

    const first = await postRemind(creator.token, lineupId, matchId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ reminded: 1, skipped: 0 });

    const second = await postRemind(creator.token, lineupId, matchId);
    expect(second.status).toBe(429);
    expect(String(second.body.message)).toMatch(/reminded recently/i);

    expect(await remindNotifsFor(nonVoter.id)).toHaveLength(1);
  });

  it('per-recipient 24h dedup survives a cooldown reset; new members still get nudged', async () => {
    const creator = await createUser('dd-creator');
    const nonVoter = await createUser('dd-nonvoter');
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });
    await addMember(matchId, nonVoter.id);

    const first = await postRemind(creator.token, lineupId, matchId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ reminded: 1, skipped: 0 });

    await expireCooldown(matchId);
    const lateJoiner = await createUser('dd-latejoiner');
    await addMember(matchId, lateJoiner.id);

    const second = await postRemind(creator.token, lineupId, matchId);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ reminded: 1, skipped: 1 });

    expect(await remindNotifsFor(nonVoter.id)).toHaveLength(1);
    expect(await remindNotifsFor(lateJoiner.id)).toHaveLength(1);
  });

  it('arms the cooldown even when there are zero recipients (decided design)', async () => {
    const creator = await createUser('zero-creator');
    // Only member is the creator (the actor) → zero recipients.
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });

    const first = await postRemind(creator.token, lineupId, matchId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ reminded: 0, skipped: 0 });

    // The empty fan-out must still have armed the per-match cooldown.
    const second = await postRemind(creator.token, lineupId, matchId);
    expect(second.status).toBe(429);
  });

  // ── authorization ──────────────────────────────────────────────────

  it('plain member → 403, and the rejected call must NOT arm the cooldown', async () => {
    const creator = await createUser('authz-creator');
    const member = await createUser('authz-member');
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });
    await addMember(matchId, member.id);

    const denied = await postRemind(member.token, lineupId, matchId);
    expect(denied.status).toBe(403);
    expect(await remindNotifsFor(member.id)).toHaveLength(0);

    // Auth runs before the cooldown gate — the creator can still remind.
    const allowed = await postRemind(creator.token, lineupId, matchId);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ reminded: 1, skipped: 0 });
  });

  it('admin and operator are allowed even when not the creator', async () => {
    const creator = await createUser('role-creator');
    const nonVoter = await createUser('role-nonvoter');
    const pollA = await seedPoll({ creatorId: creator.id });
    await addMember(pollA.matchId, nonVoter.id);

    // Seed admin (role admin) — audience is creator + nonVoter (2 sends).
    const asAdmin = await postRemind(adminToken, pollA.lineupId, pollA.matchId);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toEqual({ reminded: 2, skipped: 0 });

    // Operator on a second, independent poll.
    const operator = await createUser('role-operator', 'operator');
    const pollB = await seedPoll({ creatorId: creator.id });
    const asOperator = await postRemind(
      operator.token,
      pollB.lineupId,
      pollB.matchId,
    );
    expect(asOperator.status).toBe(200);
    expect(asOperator.body).toEqual({ reminded: 1, skipped: 0 });
  });

  it('rejects an unauthenticated call', async () => {
    const creator = await createUser('anon-creator');
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });

    const res = await testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/remind`)
      .send();
    expect(res.status).toBe(401);
  });

  // ── private lineups ────────────────────────────────────────────────

  it('private lineup: only invitees ∪ creator are nudged, never other members', async () => {
    const creator = await createUser('priv-creator');
    const invitee = await createUser('priv-invitee');
    const outsider = await createUser('priv-outsider');
    const { lineupId, matchId } = await seedPoll({
      creatorId: creator.id,
      visibility: 'private',
    });
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values({ lineupId, userId: invitee.id });
    await addMember(matchId, invitee.id);
    // A member row WITHOUT an invitee row (e.g. pre-privatization bandwagon).
    await addMember(matchId, outsider.id);

    const res = await postRemind(creator.token, lineupId, matchId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminded: 1, skipped: 0 });

    expect(await remindNotifsFor(invitee.id)).toHaveLength(1);
    expect(await remindNotifsFor(outsider.id)).toHaveLength(0);
  });

  // ── state guards ───────────────────────────────────────────────────

  it('404s a matchId that belongs to a different lineup (ROK-1306)', async () => {
    const creator = await createUser('guard-creator');
    const pollA = await seedPoll({ creatorId: creator.id });
    const pollB = await seedPoll({ creatorId: creator.id });

    const res = await postRemind(creator.token, pollA.lineupId, pollB.matchId);
    expect(res.status).toBe(404);
  });

  it('400s when the match is no longer schedulable', async () => {
    const creator = await createUser('sched-creator');
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });
    await testApp.db
      .update(schema.communityLineupMatches)
      .set({ status: 'scheduled' })
      .where(eq(schema.communityLineupMatches.id, matchId));

    const res = await postRemind(creator.token, lineupId, matchId);
    expect(res.status).toBe(400);
  });

  it('404s when the lineup opted out of the scheduling phase', async () => {
    const creator = await createUser('optout-creator');
    const { lineupId, matchId } = await seedPoll({
      creatorId: creator.id,
      includeSchedulingPhase: false,
    });

    const res = await postRemind(creator.token, lineupId, matchId);
    expect(res.status).toBe(404);
  });
});
