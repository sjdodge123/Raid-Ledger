/**
 * Organiser "Rally the non-responders" —
 * POST /lineups/:lineupId/schedule/:matchId/rally (ROK-1618, integration).
 *
 * Pins the acceptance criteria against a real Postgres. The audience was
 * re-scoped by the operator on 2026-09-19: rallying asks "does the LEADING
 * time work for you?", so it targets the members with no stance on that ONE
 * slot rather than everyone who owes a vote somewhere.
 *
 *   - AC1 audience: poll members with NO vote row (`yes` OR `no`) on the
 *     LEADING slot — the future slot with at least one `yes` that sorts first
 *     under the shared `sortSchedulingSlots` order, the same slot lock-in
 *     would offer. A vote on a NON-leading (or passed) slot does not excuse a
 *     member; the actor never self-nudges; deactivated members are excluded;
 *     there is NO member-age guard any more (a minutes-old member is rallied).
 *   - AC1 leader guard: no future slot carries a `yes` -> 400, and the 6h
 *     cooldown is NOT armed, so a rally straight after the first `yes` works.
 *   - AC2 anti-spam: a second rally inside the 6h window is 429 with zero new
 *     rows. Per-member dedup is the rally's OWN 6h key
 *     `sched-poll-rally:{matchId}:{slotId}:{userId}` — the cron's 24h
 *     `sched-poll-nudge:` key no longer silences a rally.
 *   - AC2 refund (§3.6): an empty audience gives the cooldown key back, so
 *     an immediate second rally is 200 rather than 429.
 *   - AC3 body shape: `pending === nudged + skipped` in every outcome.
 *   - AC4 authz: a plain member is refused with the same ForbiddenException
 *     envelope the lock-in gate uses; creator / admin / operator pass.
 *   - D8 lifecycle: a poll that is no longer open is 400, unlike `/remind`.
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
import { rallyCooldownKey } from './scheduling-rally.helpers';

const HOUR_MS = 60 * 60 * 1000;
/** Mirrors POLL_RALLY_COOLDOWN_SECONDS — asserted verbatim so a ms/s slip fails. */
const RALLY_COOLDOWN_SECONDS = 6 * 3600;
/** Default member-row age. The age guard is GONE; this just keeps seeds sane. */
const AGED_MEMBER_HOURS = 72;

describe('Scheduling poll rally (integration, ROK-1618)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let tag = 0;

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
    const label = `${suffix}-${++tag}`;
    const email = `rally-${label}@test.local`;
    const hash = await bcrypt.hash('RallyPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:rally-${label}`,
        username: `rally-${label}`,
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
      .send({ email, password: 'RallyPass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  /**
   * Seed a nudgeable poll: a decided, deadline-less lineup with a
   * `scheduling` match, its creator enrolled, and one future slot. The
   * returned `slotId` only becomes the LEADING slot once somebody votes
   * `yes` on it — most cases start with `castVote(slotId, creator.id)`.
   */
  async function seedPoll(opts: {
    creatorId: number;
    includeSchedulingPhase?: boolean;
  }): Promise<{ lineupId: number; matchId: number; slotId: number }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `Rally Poll ${generatePublicSlug()}`,
        createdBy: opts.creatorId,
        status: 'decided',
        visibility: 'public',
        publicSlug: generatePublicSlug(),
        includeSchedulingPhase: opts.includeSchedulingPhase ?? true,
        // ROK-977 standalone marker — the "Schedule a Game" poll variant.
        phaseDurationOverride: { standalone: true },
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
    await addMember(match.id, opts.creatorId);
    const slotId = await addSlot(match.id, 72);
    return { lineupId: lineup.id, matchId: match.id, slotId };
  }

  /**
   * Enrol a member. `ageHours` is kept so the "no age guard any more" case can
   * seed a minutes-old row explicitly.
   */
  async function addMember(
    matchId: number,
    userId: number,
    ageHours: number = AGED_MEMBER_HOURS,
  ): Promise<void> {
    await testApp.db.insert(schema.communityLineupMatchMembers).values({
      matchId,
      userId,
      source: 'voted' as const,
      createdAt: new Date(Date.now() - ageHours * HOUR_MS),
    });
  }

  /** Insert a slot `hoursFromNow` away (negative = already passed). */
  async function addSlot(
    matchId: number,
    hoursFromNow: number,
  ): Promise<number> {
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + hoursFromNow * HOUR_MS),
        suggestedBy: 'user',
      })
      .returning();
    return slot.id;
  }

  async function castVote(
    slotId: number,
    userId: number,
    stance: 'yes' | 'no' = 'yes',
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId, userId, stance });
  }

  function postRally(token: string, lineupId: number, matchId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/rally`)
      .set('Authorization', `Bearer ${token}`)
      .send();
  }

  /** Rally DMs persisted for a user (the rally's OWN subtype, not the cron's). */
  async function ralliesFor(userId: number) {
    const rows = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    return rows.filter(
      (r) =>
        (r.payload as { subtype?: string } | null)?.subtype ===
        'scheduling_poll_rally',
    );
  }

  /** Whether the per-poll cooldown key is currently claimed in either layer. */
  async function cooldownClaimed(matchId: number): Promise<boolean> {
    const key = rallyCooldownKey(matchId);
    if (testApp.redisMock.store.has(key)) return true;
    const rows = await testApp.db
      .select()
      .from(schema.notificationDedup)
      .where(eq(schema.notificationDedup.dedupKey, key));
    return rows.length > 0;
  }

  // ── AC1: the leading slot decides the audience ─────────────────────

  it('rallies only the member with no stance on the LEADING slot', async () => {
    // The production shape: one time is clearly winning, one member is the
    // reason it cannot be locked in yet.
    const creator = await createUser('lead-creator');
    const yesB = await createUser('lead-yes-b');
    const yesC = await createUser('lead-yes-c');
    const otherSlotOnly = await createUser('lead-d');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    const slotB = await addSlot(matchId, 96);
    for (const m of [yesB, yesC, otherSlotOnly]) await addMember(matchId, m.id);
    // Leading slot: 3 yes vs slot B's 1.
    await castVote(slotId, creator.id, 'yes');
    await castVote(slotId, yesB.id, 'yes');
    await castVote(slotId, yesC.id, 'yes');
    // A vote on a NON-leading slot is not an answer to "does the leader work".
    await castVote(slotB, otherSlotOnly.id, 'yes');

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1, skipped: 0 });
    expect(res.body.pending).toBe(res.body.nudged + res.body.skipped);
    expect(Date.parse(res.body.cooldownUntil as string)).toBeGreaterThan(
      Date.now(),
    );

    const dms = await ralliesFor(otherSlotOnly.id);
    expect(dms).toHaveLength(1);
    expect(dms[0].payload).toMatchObject({ slotId });
    for (const quiet of [yesB, yesC, creator]) {
      expect(await ralliesFor(quiet.id)).toHaveLength(0);
    }
  });

  it('carries the leading slot, its Discord timestamp and the tally in the DM', async () => {
    const creator = await createUser('copy-creator');
    const yesB = await createUser('copy-yes-b');
    const yesC = await createUser('copy-yes-c');
    const silent = await createUser('copy-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    for (const m of [yesB, yesC, silent]) await addMember(matchId, m.id);
    for (const m of [creator, yesB, yesC]) await castVote(slotId, m.id, 'yes');

    const res = await postRally(creator.token, lineupId, matchId);
    expect(res.status).toBe(200);

    const [slot] = await testApp.db
      .select()
      .from(schema.communityLineupScheduleSlots)
      .where(eq(schema.communityLineupScheduleSlots.id, slotId));
    const [dm] = await ralliesFor(silent.id);
    expect(dm).toBeDefined();
    expect(dm.type).toBe('community_lineup');
    expect(dm.payload).toMatchObject({
      subtype: 'scheduling_poll_rally',
      reminderWindow: `rally-${matchId}`,
      lineupId,
      matchId,
      slotId,
    });
    expect(dm.title).toBe('Does this time work for you?');
    // "{yes on the leader} of {member rows} picked …" — 3 of the 4 members.
    expect(dm.message).toMatch(/^3 of 4 picked/);
    expect(dm.message).toContain('Does it work for you?');
    // A Discord long-date stamp OF THE LEADING SLOT, not of any other slot.
    const stamp = /<t:(\d{9,11}):f>/.exec(dm.message ?? '');
    expect(stamp).not.toBeNull();
    const expectedEpoch = Math.floor(
      new Date(slot.proposedTime).getTime() / 1000,
    );
    expect(Math.abs(Number(stamp?.[1]) - expectedEpoch)).toBeLessThanOrEqual(1);
  });

  it('excludes a `no` on the leader but rallies a `no` cast elsewhere', async () => {
    const creator = await createUser('stance-creator');
    const yesVoter = await createUser('stance-yes');
    const noOnLeader = await createUser('stance-no-leader');
    const noElsewhere = await createUser('stance-no-other');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    const slotB = await addSlot(matchId, 96);
    for (const m of [yesVoter, noOnLeader, noElsewhere]) {
      await addMember(matchId, m.id);
    }
    await castVote(slotId, creator.id, 'yes');
    await castVote(slotId, yesVoter.id, 'yes');
    // ROK-1617: a `no` is a row, and on the LEADER it is an answer.
    await castVote(slotId, noOnLeader.id, 'no');
    // A `no` on a slot nobody is proposing is not an answer about the leader.
    await castVote(slotB, noElsewhere.id, 'no');

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1, skipped: 0 });
    expect(await ralliesFor(noElsewhere.id)).toHaveLength(1);
    expect(await ralliesFor(noOnLeader.id)).toHaveLength(0);
    expect(await ralliesFor(yesVoter.id)).toHaveLength(0);
  });

  it('never rallies the actor, even when the actor owes the leader a vote', async () => {
    const creator = await createUser('self-creator');
    const operator = await createUser('self-operator', 'operator');
    const silent = await createUser('self-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await addMember(matchId, operator.id);
    await addMember(matchId, silent.id);
    // Only the creator has answered; the operator pressing Rally has not.
    await castVote(slotId, creator.id, 'yes');

    const res = await postRally(operator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1, skipped: 0 });
    expect(await ralliesFor(silent.id)).toHaveLength(1);
    expect(await ralliesFor(operator.id)).toHaveLength(0);
  });

  it('rallies a member who joined minutes ago (the age guard is gone)', async () => {
    const creator = await createUser('age-creator');
    const fresh = await createUser('age-fresh');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    // Used to be held back by POLL_NUDGE_MIN_MEMBER_AGE_HOURS: the rally is a
    // deliberate organiser action about ONE time, so the grace no longer fits.
    await addMember(matchId, fresh.id, 5 / 60);

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1, skipped: 0 });
    expect(await ralliesFor(fresh.id)).toHaveLength(1);
  });

  it('excludes a deactivated member', async () => {
    const creator = await createUser('gone-creator');
    const gone = await createUser('gone-left');
    const silent = await createUser('gone-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, gone.id);
    await addMember(matchId, silent.id);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gone.id));

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1 });
    expect(await ralliesFor(silent.id)).toHaveLength(1);
    expect(await ralliesFor(gone.id)).toHaveLength(0);
  });

  it('rallies a member whose only vote sits on a slot that has passed', async () => {
    const creator = await createUser('stale-creator');
    const staleVoter = await createUser('stale-voter');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, staleVoter.id);
    const pastSlot = await addSlot(matchId, -48);
    await castVote(pastSlot, staleVoter.id, 'yes');

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1 });
    expect(await ralliesFor(staleVoter.id)).toHaveLength(1);
  });

  // ── AC1: no leader yet ─────────────────────────────────────────────

  it('400s when no future slot has a yes, without burning the 6h window', async () => {
    const creator = await createUser('noleader-creator');
    const silent = await createUser('noleader-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await addMember(matchId, silent.id);
    // A yes on a PASSED slot names no time anyone can still play.
    const pastSlot = await addSlot(matchId, -48);
    await castVote(pastSlot, silent.id, 'yes');

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toBe(
      'No leading time yet — no time has more yes votes than no votes',
    );
    expect(await ralliesFor(silent.id)).toHaveLength(0);
    // Nobody was DM'd, so the organiser must not be locked out for six hours:
    // the first yes on a future slot makes an immediate rally legal.
    expect(await cooldownClaimed(matchId)).toBe(false);
    await castVote(slotId, creator.id, 'yes');
    const second = await postRally(creator.token, lineupId, matchId);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ pending: 1, nudged: 1 });
  });

  // ── AC2: dedup, cooldown + refund ──────────────────────────────────

  it('rallies a member the cron nudged this window (the 24h key is not shared)', async () => {
    const creator = await createUser('cron-creator');
    const cronNudged = await createUser('cron-nudged');
    const other = await createUser('cron-other');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, cronNudged.id);
    await addMember(matchId, other.id);
    // Stand in for the cron having nudged `cronNudged` an hour ago. The rally
    // asks a different question ("this time — yes or no?"), so it goes anyway.
    await testApp.db.insert(schema.notificationDedup).values({
      dedupKey: `sched-poll-nudge:${matchId}:${cronNudged.id}`,
      expiresAt: new Date(Date.now() + 12 * HOUR_MS),
    });

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 2, nudged: 2, skipped: 0 });
    expect(res.body.pending).toBe(res.body.nudged + res.body.skipped);
    expect(await ralliesFor(cronNudged.id)).toHaveLength(1);
    expect(await ralliesFor(other.id)).toHaveLength(1);
  });

  it("skips a member the rally's own per-slot key already covers", async () => {
    const creator = await createUser('dedup-creator');
    const covered = await createUser('dedup-covered');
    const other = await createUser('dedup-other');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, covered.id);
    await addMember(matchId, other.id);
    // The key format is load-bearing (match + LEADING slot + member), so it is
    // written out literally rather than imported.
    await testApp.db.insert(schema.notificationDedup).values({
      dedupKey: `sched-poll-rally:${matchId}:${slotId}:${covered.id}`,
      expiresAt: new Date(Date.now() + 3 * HOUR_MS),
    });

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 2, nudged: 1, skipped: 1 });
    expect(res.body.pending).toBe(res.body.nudged + res.body.skipped);
    expect(await ralliesFor(covered.id)).toHaveLength(0);
    expect(await ralliesFor(other.id)).toHaveLength(1);
  });

  it('a second rally inside the 6h window is 429 with zero new notifications', async () => {
    const creator = await createUser('cd-creator');
    const silent = await createUser('cd-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, silent.id);

    const first = await postRally(creator.token, lineupId, matchId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ pending: 1, nudged: 1 });

    const second = await postRally(creator.token, lineupId, matchId);
    expect(second.status).toBe(429);
    expect(String(second.body.message)).toMatch(/rallied this poll recently/i);

    expect(await ralliesFor(silent.id)).toHaveLength(1);
  });

  it('claims the cooldown key for six hours, in seconds', async () => {
    const creator = await createUser('ttl-creator');
    const silent = await createUser('ttl-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, silent.id);

    const before = Date.now();
    const res = await postRally(creator.token, lineupId, matchId);
    expect(res.status).toBe(200);

    const [row] = await testApp.db
      .select()
      .from(schema.notificationDedup)
      .where(eq(schema.notificationDedup.dedupKey, rallyCooldownKey(matchId)));
    expect(row).toBeDefined();
    const elapsedMs = Date.now() - before;
    const ttlMs = new Date(row.expiresAt as Date).getTime() - before;
    // The expiry is stamped DURING the request, so measured from `before` it
    // is the cooldown plus however long the request had run — never less than
    // the cooldown, never more than cooldown + the whole round trip. One
    // second of slack covers clock granularity. A ms/s slip would still land
    // three orders of magnitude away.
    expect(ttlMs).toBeGreaterThanOrEqual(RALLY_COOLDOWN_SECONDS * 1000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(
      RALLY_COOLDOWN_SECONDS * 1000 + elapsedMs + 1000,
    );
  });

  it('reports pending 0 and refunds the cooldown when everyone answered the leader', async () => {
    const creator = await createUser('empty-creator');
    const yesVoter = await createUser('empty-yes');
    const noVoter = await createUser('empty-no');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await addMember(matchId, yesVoter.id);
    await addMember(matchId, noVoter.id);
    await castVote(slotId, creator.id, 'yes');
    await castVote(slotId, yesVoter.id, 'yes');
    // A `no` is an answer: this member is not pending either.
    await castVote(slotId, noVoter.id, 'no');

    const first = await postRally(creator.token, lineupId, matchId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ pending: 0, nudged: 0, skipped: 0 });
    expect(await ralliesFor(yesVoter.id)).toHaveLength(0);
    expect(await ralliesFor(noVoter.id)).toHaveLength(0);

    // §3.6: burning six hours to learn "nobody to rally" is a trap.
    expect(await cooldownClaimed(matchId)).toBe(false);
    const second = await postRally(creator.token, lineupId, matchId);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ pending: 0 });
  });

  // ── AC4: authorization ─────────────────────────────────────────────

  it('refuses a plain member with the organiser refusal, arming no cooldown', async () => {
    const creator = await createUser('authz-creator');
    const member = await createUser('authz-member');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, member.id);

    const denied = await postRally(member.token, lineupId, matchId);
    expect(denied.status).toBe(403);
    expect(String(denied.body.message)).toBe(
      'Only the poll creator or an operator can rally voters',
    );
    expect(await ralliesFor(member.id)).toHaveLength(0);
    expect(await cooldownClaimed(matchId)).toBe(false);

    // The refusal must not have burnt the creator's own cooldown.
    const allowed = await postRally(creator.token, lineupId, matchId);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ pending: 1, nudged: 1 });
  });

  it('allows an admin and an operator who did not create the poll', async () => {
    const creator = await createUser('role-creator');
    const silentA = await createUser('role-silent-a');
    const pollA = await seedPoll({ creatorId: creator.id });
    await castVote(pollA.slotId, creator.id, 'yes');
    await addMember(pollA.matchId, silentA.id);

    const asAdmin = await postRally(adminToken, pollA.lineupId, pollA.matchId);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toMatchObject({ pending: 1, nudged: 1 });

    const operator = await createUser('role-operator', 'operator');
    const silentB = await createUser('role-silent-b');
    const pollB = await seedPoll({ creatorId: creator.id });
    await castVote(pollB.slotId, creator.id, 'yes');
    await addMember(pollB.matchId, silentB.id);

    const asOperator = await postRally(
      operator.token,
      pollB.lineupId,
      pollB.matchId,
    );
    expect(asOperator.status).toBe(200);
    expect(asOperator.body).toMatchObject({ pending: 1, nudged: 1 });
  });

  it('rejects an unauthenticated call', async () => {
    const creator = await createUser('anon-creator');
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });

    const res = await testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/rally`)
      .send();
    expect(res.status).toBe(401);
  });

  // ── state guards (§3.5 / D8) ───────────────────────────────────────

  it('404s a matchId that belongs to a different lineup (ROK-1306)', async () => {
    const creator = await createUser('cross-creator');
    const pollA = await seedPoll({ creatorId: creator.id });
    const pollB = await seedPoll({ creatorId: creator.id });

    const res = await postRally(creator.token, pollA.lineupId, pollB.matchId);
    expect(res.status).toBe(404);
  });

  it('400s a poll that is no longer accepting votes (D8 — stricter than /remind)', async () => {
    const creator = await createUser('closed-creator');
    const silent = await createUser('closed-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await addMember(matchId, silent.id);
    // A leader exists, so this 400 can only be the lifecycle guard — which
    // runs BEFORE the "no leading time" check.
    await castVote(slotId, creator.id, 'yes');
    // The phase job archives the LINEUP and leaves the match on 'scheduling'.
    await testApp.db
      .update(schema.communityLineups)
      .set({ phaseDeadline: new Date(Date.now() - HOUR_MS) })
      .where(eq(schema.communityLineups.id, lineupId));

    const res = await postRally(creator.token, lineupId, matchId);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toBe(
      'This poll is no longer accepting votes',
    );
    expect(await ralliesFor(silent.id)).toHaveLength(0);
    expect(await cooldownClaimed(matchId)).toBe(false);
  });

  it('404s without burning the cooldown when the poll is open but not nudgeable', async () => {
    const creator = await createUser('gap-creator');
    const silent = await createUser('gap-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await addMember(matchId, silent.id);
    // A leading slot exists, so this case is about the state gap and not the
    // "no leading time" 400.
    await castVote(slotId, creator.id, 'yes');
    // `assertPollOpen` accepts a `voting` lineup whose match is `suggested`,
    // but the nudgeable-polls SQL demands `decided` + `scheduling` — the gap
    // between the two predicates that used to arm the 6h key and then 404.
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'voting' })
      .where(eq(schema.communityLineups.id, lineupId));
    await testApp.db
      .update(schema.communityLineupMatches)
      .set({ status: 'suggested' })
      .where(eq(schema.communityLineupMatches.id, matchId));

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(404);
    expect(await ralliesFor(silent.id)).toHaveLength(0);
    // Nobody was DM'd, so the window must have been given back: no dedup row,
    // and an immediate retry is the same 404 rather than a 429 for six hours.
    expect(await cooldownClaimed(matchId)).toBe(false);
    const second = await postRally(creator.token, lineupId, matchId);
    expect(second.status).toBe(404);
  });

  it('404s when the lineup opted out of the scheduling phase', async () => {
    const creator = await createUser('optout-creator');
    const { lineupId, matchId } = await seedPoll({
      creatorId: creator.id,
      includeSchedulingPhase: false,
    });

    const res = await postRally(creator.token, lineupId, matchId);
    expect(res.status).toBe(404);
  });
});
