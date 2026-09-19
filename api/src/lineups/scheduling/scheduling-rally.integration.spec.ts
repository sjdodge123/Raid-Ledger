/**
 * Organiser "Rally the non-responders" —
 * POST /lineups/:lineupId/schedule/:matchId/rally (ROK-1618, integration).
 *
 * Pins the acceptance criteria against a real Postgres:
 *   - AC1 audience: members with NO stance on a still-future slot. A `yes`
 *     and a `no` both exclude (ROK-1617 made a `no` a row with
 *     `stance = 'no'`); a vote on a slot that has PASSED does not; members
 *     younger than POLL_NUDGE_MIN_MEMBER_AGE_HOURS and deactivated members
 *     are excluded; the actor never self-nudges.
 *   - AC2 anti-spam: a second rally inside the 6h window is 429 with zero
 *     new rows, and a member the cron already nudged in the last 24h is
 *     `skipped` rather than re-DM'd (the SHARED dedup key, D2).
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
/** Member rows older than this are in the audience (POLL_NUDGE_MIN_MEMBER_AGE_HOURS). */
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
   * `scheduling` match, its creator enrolled, and one future slot.
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
   * Enrol a member with an explicit row age — the audience query holds back
   * members younger than 24h, so the default must be older than that.
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

  /** Poll-nudge notifications persisted for a user (shared with the cron). */
  async function nudgesFor(userId: number) {
    const rows = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    return rows.filter(
      (r) =>
        (r.payload as { subtype?: string } | null)?.subtype ===
        'scheduling_poll_nudge',
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

  // ── AC1: audience ──────────────────────────────────────────────────

  it('nudges only the member with no stance on a future slot (yes and no both exclude)', async () => {
    const creator = await createUser('aud-creator');
    const yesVoter = await createUser('aud-yes');
    const noVoter = await createUser('aud-no');
    const silent = await createUser('aud-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    // The creator is a member too, and has voted — but is the actor anyway.
    await castVote(slotId, creator.id, 'yes');
    await addMember(matchId, yesVoter.id);
    await addMember(matchId, noVoter.id);
    await addMember(matchId, silent.id);
    await castVote(slotId, yesVoter.id, 'yes');
    // ROK-1617: a `no` is a row, so it removes its voter from the audience.
    await castVote(slotId, noVoter.id, 'no');

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1, skipped: 0 });
    expect(res.body.pending).toBe(res.body.nudged + res.body.skipped);
    expect(Date.parse(res.body.cooldownUntil as string)).toBeGreaterThan(
      Date.now(),
    );

    expect(await nudgesFor(silent.id)).toHaveLength(1);
    expect(await nudgesFor(yesVoter.id)).toHaveLength(0);
    expect(await nudgesFor(noVoter.id)).toHaveLength(0);
    expect(await nudgesFor(creator.id)).toHaveLength(0);
  });

  it('carries the cron-compatible nudge payload so the Discord surface is unchanged', async () => {
    const creator = await createUser('payload-creator');
    const silent = await createUser('payload-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
    await addMember(matchId, silent.id);

    const res = await postRally(creator.token, lineupId, matchId);
    expect(res.status).toBe(200);

    const [dm] = await nudgesFor(silent.id);
    expect(dm.type).toBe('community_lineup');
    expect(dm.payload).toMatchObject({
      subtype: 'scheduling_poll_nudge',
      reminderWindow: `poll-${matchId}`,
      lineupId,
      matchId,
    });
  });

  it('excludes a member younger than the 24h grace and a deactivated member', async () => {
    const creator = await createUser('guard-creator');
    const fresh = await createUser('guard-fresh');
    const gone = await createUser('guard-gone');
    const silent = await createUser('guard-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
    await addMember(matchId, fresh.id, 1);
    await addMember(matchId, gone.id);
    await addMember(matchId, silent.id);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gone.id));

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1 });
    expect(await nudgesFor(silent.id)).toHaveLength(1);
    expect(await nudgesFor(fresh.id)).toHaveLength(0);
    expect(await nudgesFor(gone.id)).toHaveLength(0);
  });

  it('re-nudges a member whose only vote sits on a slot that has passed', async () => {
    const creator = await createUser('stale-creator');
    const staleVoter = await createUser('stale-voter');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
    await addMember(matchId, staleVoter.id);
    const pastSlot = await addSlot(matchId, -48);
    await castVote(pastSlot, staleVoter.id, 'yes');

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 1, nudged: 1 });
    expect(await nudgesFor(staleVoter.id)).toHaveLength(1);
  });

  // ── AC2: cooldown + refund ─────────────────────────────────────────

  it('a second rally inside the 6h window is 429 with zero new notifications', async () => {
    const creator = await createUser('cd-creator');
    const silent = await createUser('cd-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
    await addMember(matchId, silent.id);

    const first = await postRally(creator.token, lineupId, matchId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ pending: 1, nudged: 1 });

    const second = await postRally(creator.token, lineupId, matchId);
    expect(second.status).toBe(429);
    expect(String(second.body.message)).toMatch(/rallied this poll recently/i);

    expect(await nudgesFor(silent.id)).toHaveLength(1);
  });

  it('claims the cooldown key for six hours, in seconds', async () => {
    const creator = await createUser('ttl-creator');
    const silent = await createUser('ttl-silent');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
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

  it('a fully-voted poll reports pending 0, notifies nobody, and refunds the cooldown', async () => {
    const creator = await createUser('empty-creator');
    const voter = await createUser('empty-voter');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
    await addMember(matchId, voter.id);
    await castVote(slotId, voter.id, 'yes');

    const first = await postRally(creator.token, lineupId, matchId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ pending: 0, nudged: 0, skipped: 0 });
    expect(await nudgesFor(voter.id)).toHaveLength(0);

    // §3.6: burning six hours to learn "nobody to rally" is a trap.
    expect(await cooldownClaimed(matchId)).toBe(false);
    const second = await postRally(creator.token, lineupId, matchId);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ pending: 0 });
  });

  it('skips (never re-DMs) a member the shared 24h nudge key already covers', async () => {
    const creator = await createUser('dedup-creator');
    const silent = await createUser('dedup-silent');
    const fresh = await createUser('dedup-other');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
    await addMember(matchId, silent.id);
    await addMember(matchId, fresh.id);
    // Stand in for the cron having already nudged `silent` this window.
    await testApp.db.insert(schema.notificationDedup).values({
      dedupKey: `sched-poll-nudge:${matchId}:${silent.id}`,
      expiresAt: new Date(Date.now() + 12 * HOUR_MS),
    });

    const res = await postRally(creator.token, lineupId, matchId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: 2, nudged: 1, skipped: 1 });
    expect(res.body.pending).toBe(res.body.nudged + res.body.skipped);
    expect(await nudgesFor(silent.id)).toHaveLength(0);
    expect(await nudgesFor(fresh.id)).toHaveLength(1);
  });

  // ── AC4: authorization ─────────────────────────────────────────────

  it('refuses a plain member with the organiser refusal, arming no cooldown', async () => {
    const creator = await createUser('authz-creator');
    const member = await createUser('authz-member');
    const { lineupId, matchId, slotId } = await seedPoll({
      creatorId: creator.id,
    });
    await castVote(slotId, creator.id);
    await addMember(matchId, member.id);

    const denied = await postRally(member.token, lineupId, matchId);
    expect(denied.status).toBe(403);
    expect(String(denied.body.message)).toBe(
      'Only the poll creator or an operator can rally voters',
    );
    expect(await nudgesFor(member.id)).toHaveLength(0);
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
    await castVote(pollA.slotId, creator.id);
    await addMember(pollA.matchId, silentA.id);

    const asAdmin = await postRally(adminToken, pollA.lineupId, pollA.matchId);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toMatchObject({ pending: 1, nudged: 1 });

    const operator = await createUser('role-operator', 'operator');
    const silentB = await createUser('role-silent-b');
    const pollB = await seedPoll({ creatorId: creator.id });
    await castVote(pollB.slotId, creator.id);
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
    const { lineupId, matchId } = await seedPoll({ creatorId: creator.id });
    await addMember(matchId, silent.id);
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
    expect(await nudgesFor(silent.id)).toHaveLength(0);
    expect(await cooldownClaimed(matchId)).toBe(false);
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
