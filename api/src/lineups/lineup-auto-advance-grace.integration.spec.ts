/**
 * Lineup auto-advance grace window integration tests (ROK-1253).
 *
 * TDD gate: these tests define the behavior of the pre-advance grace
 * window AND the manual phase-revert stickiness feature. They MUST fail
 * until the implementation lands:
 *   - new columns `community_lineups.pending_advance_at` and
 *     `community_lineups.auto_advance_paused_at` (migration 0137)
 *   - new settings keys `LINEUP_AUTO_ADVANCE_GRACE_MS`,
 *     `LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS`
 *   - new BullMQ job name `grace-advance` (job id `lineup-grace-<id>`)
 *   - new contract fields `pendingAdvanceAt`, `autoAdvancePausedAt` on
 *     `LineupDetailResponseDto`
 *   - revised `maybeAutoAdvance` flow + new processor branch
 *
 * The four AC-T cases from the spec are covered:
 *   AC-T1: quorum met → grace scheduled → elapses → advance fires
 *   AC-T2: quorum met → un-vote → pending_advance_at cleared synchronously,
 *          grace job no-ops
 *   AC-T3: revert (voting → building) → auto_advance_paused_at set, next
 *          nominate does not re-schedule grace
 *   AC-T4: revert + cool-off TTL elapses → next mutation advances normally
 *
 * Plus four architect-flagged gap tests:
 *   GAP-A: cancelAllForLineup removes grace jobs during abort
 *   GAP-B: processor pause-check no-ops on a paused lineup
 *   GAP-C: forward manual during grace clears pending_advance_at AND the
 *          BullMQ grace job
 *   GAP-D: conditional-UPDATE race — two parallel maybeAutoAdvance calls
 *          schedule exactly one grace job
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { SettingsService } from '../settings/settings.service';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LINEUP_PHASE_QUEUE } from './queue/lineup-phase.constants';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';
import { maybeAutoAdvance } from './lineups-auto-advance.helpers';
import { LineupsService } from './lineups.service';
import { LineupsGateway } from './lineups.gateway';
import * as transitionMod from './lineups-transition.helpers';

// The two SETTING_KEYS the implementation must add. We resolve them
// at runtime so the spec FILE still compiles before the implementation
// lands; failure manifests at test time (graceKey/pauseKey === undefined
// → SettingsService throws on .set()), which is the TDD "fails-by-
// construction" mode allowed by the brief.
const KEY_MAP = SETTING_KEYS as Record<string, string>;
const graceKey = (KEY_MAP.LINEUP_AUTO_ADVANCE_GRACE_MS ??
  'lineup_auto_advance_grace_ms') as never;
const pauseTtlKey = (KEY_MAP.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS ??
  'lineup_auto_advance_pause_ttl_ms') as never;
const HAS_NEW_KEYS =
  typeof KEY_MAP.LINEUP_AUTO_ADVANCE_GRACE_MS === 'string' &&
  typeof KEY_MAP.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS === 'string';

function describeGrace() {
  let testApp: TestApp;
  let adminToken: string;
  let settings: SettingsService;
  let phaseQueue: LineupPhaseQueueService;
  let rawQueue: Queue;
  let lineupsService: LineupsService;
  let lineupsGateway: LineupsGateway;
  let phaseProcessor: LineupPhaseProcessor;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    settings = testApp.app.get(SettingsService);
    phaseQueue = testApp.app.get(LineupPhaseQueueService);
    rawQueue = testApp.app.get<Queue>(getQueueToken(LINEUP_PHASE_QUEUE));
    lineupsService = testApp.app.get(LineupsService);
    lineupsGateway = testApp.app.get(LineupsGateway);
    phaseProcessor = testApp.app.get(LineupPhaseProcessor);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    // Reset the two new settings between tests so a short grace value
    // doesn't bleed into the next case.
    if (HAS_NEW_KEYS) {
      await settings.delete(graceKey);
      await settings.delete(pauseTtlKey);
    }
  });

  // ── helpers ────────────────────────────────────────────────────

  async function createMember(
    tag: string,
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('GraceTest1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@grace.local`,
        username: tag,
        role: 'member',
      })
      .returning();
    const email = `${tag}@grace.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'GraceTest1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createPrivateLineup(
    token: string,
    inviteeUserIds: number[],
    votesPerPlayer: number,
  ) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Grace Window Test',
        visibility: 'private',
        inviteeUserIds,
        votesPerPlayer,
      });
  }

  async function createGames(count: number) {
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = await testApp.db
        .insert(schema.games)
        .values({
          name: `Grace Game ${i + 1}`,
          slug: `grace-game-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

  // ROK-1296: per-voter quorum gate now requires explicit submit. Helper
  // posts /submit-votes for each token so the grace tests can drive the
  // pending_advance_at / grace-job paths exactly as before.
  async function submitAllVotes(lineupId: number, tokens: string[]) {
    for (const t of tokens) {
      await testApp.request
        .post(`/lineups/${lineupId}/submit-votes`)
        .set('Authorization', `Bearer ${t}`)
        .send({});
    }
  }

  async function revertToBuilding(lineupId: number, token: string) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'building' });
  }

  /** Read the persisted status from the DB directly (bypasses caches). */
  async function readStatus(lineupId: number): Promise<string> {
    const [row] = await testApp.db
      .select({ status: schema.communityLineups.status })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    return row?.status ?? 'missing';
  }

  /**
   * Read the raw advance-state columns from the row via parameterised
   * SQL so the spec still type-checks before the Drizzle schema is
   * updated. When the columns are missing in DB the query will throw,
   * which is itself a valid TDD failure signal.
   */
  async function readAdvanceState(lineupId: number): Promise<{
    pendingAdvanceAt: Date | null;
    autoAdvancePausedAt: Date | null;
  }> {
    const rows = (await testApp.db.execute(sql`
      SELECT pending_advance_at      AS "pendingAdvanceAt",
             auto_advance_paused_at  AS "autoAdvancePausedAt"
      FROM community_lineups
      WHERE id = ${lineupId}
    `)) as unknown as Array<{
      pendingAdvanceAt: string | Date | null;
      autoAdvancePausedAt: string | Date | null;
    }>;
    const row = rows[0];
    const toDate = (v: string | Date | null): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      // postgres-js returns naive timestamps; treat as UTC.
      const s = String(v);
      if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
      return new Date(s.replace(' ', 'T') + 'Z');
    };
    return {
      pendingAdvanceAt: toDate(row?.pendingAdvanceAt ?? null),
      autoAdvancePausedAt: toDate(row?.autoAdvancePausedAt ?? null),
    };
  }

  /** Write to one of the advance-state columns via raw SQL. */
  async function writeAdvanceState(
    lineupId: number,
    column: 'pending_advance_at' | 'auto_advance_paused_at',
    value: Date | null,
  ): Promise<void> {
    // postgres-js cannot bind a JS Date through Drizzle's `sql` template,
    // so we serialise to ISO and let Postgres coerce to timestamp.
    const literal = value === null ? null : value.toISOString();
    if (column === 'pending_advance_at') {
      await testApp.db.execute(sql`
        UPDATE community_lineups
        SET pending_advance_at = ${literal}::timestamp
        WHERE id = ${lineupId}
      `);
    } else {
      await testApp.db.execute(sql`
        UPDATE community_lineups
        SET auto_advance_paused_at = ${literal}::timestamp
        WHERE id = ${lineupId}
      `);
    }
  }

  async function getGraceJob(lineupId: number) {
    return rawQueue.getJob(`lineup-grace-${lineupId}`);
  }

  /**
   * Wait for the DB status to become `expected` (lazy polling, hard
   * deadline). Used because the grace job is delayed and processed
   * asynchronously by BullMQ.
   */
  async function waitForStatus(
    lineupId: number,
    expected: string,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await readStatus(lineupId);
      if (current === expected) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    const final = await readStatus(lineupId);
    throw new Error(
      `Status did not reach '${expected}' within ${timeoutMs}ms; last seen '${final}'`,
    );
  }

  /**
   * Poll a predicate until it returns a truthy value or the timeout elapses.
   * Returns the truthy value (or null on timeout). Used to wait for async
   * write side-effects that run AFTER the observable state change we
   * already gated on (e.g. activity log entries written after status flip).
   */
  async function pollForCondition<T>(
    fn: () => Promise<T | null>,
    timeoutMs: number,
  ): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await fn();
      if (result) return result;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  // ── AC-T1: grace scheduled + elapses + advance fires ──────────

  it('AC-T1: schedules pending_advance_at on quorum + fires advance after grace elapses', async () => {
    await settings.set(graceKey, '500');

    const v1 = await createMember('act1-v1');
    const v2 = await createMember('act1-v2');

    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1, // single vote per player → quorum trivially closeable
    );
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);

    // Force-advance to voting (we test the voting → decided grace path).
    await advanceToVoting(lineupId, adminToken);
    expect(await readStatus(lineupId)).toBe('voting');

    // All 3 voters cast their single vote → voting quorum met. The
    // implementation must NOT flip status immediately — it must set
    // pending_advance_at and enqueue the grace job.
    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);

    // Immediately after quorum closes: status is still 'voting' AND
    // pending_advance_at is populated.
    const immediate = await readAdvanceState(lineupId);
    expect(immediate.pendingAdvanceAt).not.toBeNull();
    expect(await readStatus(lineupId)).toBe('voting');

    // Detail DTO surfaces the new field.
    const detail = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(
      (detail.body as { pendingAdvanceAt: unknown }).pendingAdvanceAt,
    ).toEqual(expect.any(String));

    // After the 500ms grace elapses the BullMQ job processes and flips
    // the row to 'decided'. We give it a generous window because BullMQ
    // workers tick on their own schedule.
    await waitForStatus(lineupId, 'decided', 10_000);

    // Once advanced, pending_advance_at is cleared.
    const after = await readAdvanceState(lineupId);
    expect(after.pendingAdvanceAt).toBeNull();
  });

  // ── AC-T2: un-vote during grace clears pending_advance_at ─────

  it('AC-T2: clears pending_advance_at synchronously when quorum breaks during grace', async () => {
    // Long grace so the job can't fire before we break quorum.
    await settings.set(graceKey, '300000');

    const v1 = await createMember('act2-v1');
    const v2 = await createMember('act2-v2');

    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);

    // Quorum just closed — grace pending.
    let state = await readAdvanceState(lineupId);
    expect(state.pendingAdvanceAt).not.toBeNull();

    // ROK-1296: per-voter quorum gate is submission presence, so a vote
    // toggle no longer breaks quorum. Adding a NEW invitee who has not
    // submitted is the post-1296 equivalent — the gating set grows by one
    // unsubmitted voter, so quorum breaks.
    const v3 = await createMember('act2-v3');
    const addRes = await testApp.request
      .post(`/lineups/${lineupId}/invitees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [v3.userId] });
    // POST returns 201 by default; the endpoint also tolerates 200.
    expect([200, 201]).toContain(addRes.status);

    // Synchronously: pending_advance_at must be cleared on the mutation
    // path. The status remains 'voting' (no advance fired).
    state = await readAdvanceState(lineupId);
    expect(state.pendingAdvanceAt).toBeNull();
    expect(await readStatus(lineupId)).toBe('voting');

    // The orphaned BullMQ grace job, if it still exists, must no-op: with
    // grace=300s it stays parked as a `delayed` BullMQ job and cannot fire
    // within the test, so the status cannot advance. The job *may* be
    // cancelled eagerly — both are acceptable. Assert the OBSERVABLE outcome
    // (status) plus that any surviving job is still parked — deterministic
    // rather than sleeping to "give it a chance to wake".
    const orphan = await getGraceJob(lineupId);
    if (orphan) {
      expect(await orphan.getState()).toBe('delayed');
    }
    expect(await readStatus(lineupId)).toBe('voting');
  });

  // ── AC-T3: revert (voting → building) sets auto_advance_paused_at ──

  it('AC-T3: reverting voting → building sets auto_advance_paused_at and suppresses next auto-advance', async () => {
    await settings.set(graceKey, '500');
    // Long pause TTL so the cool-off does not expire during the test.
    await settings.set(pauseTtlKey, '86400000');

    const v1 = await createMember('act3-v1');
    const v2 = await createMember('act3-v2');

    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    // Cast quorum-closing votes so grace is scheduled.
    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);
    expect((await readAdvanceState(lineupId)).pendingAdvanceAt).not.toBeNull();

    // Operator reverts BEFORE the grace job fires.
    const revertRes = await revertToBuilding(lineupId, adminToken);
    expect(revertRes.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('building');

    // auto_advance_paused_at is now set, pending_advance_at cleared.
    const state = await readAdvanceState(lineupId);
    expect(state.autoAdvancePausedAt).not.toBeNull();
    expect(state.pendingAdvanceAt).toBeNull();

    // Detail DTO surfaces the autoAdvancePausedAt field.
    const detail = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(
      (detail.body as { autoAdvancePausedAt: unknown }).autoAdvancePausedAt,
    ).toEqual(expect.any(String));

    // The next quorum-affecting mutation must NOT re-schedule the grace
    // window. ROK-1296: building quorum is met when every expected voter
    // calls /submit-nominations. We satisfy that AND ensure the nomination
    // floor (default 4) is hit so a paused-but-otherwise-ready lineup is
    // exercised — the pause must suppress advance regardless.
    for (let i = 0; i < 3; i++) {
      const morePersonal = await createGames(1);
      await nominate(adminToken, lineupId, morePersonal[0].id);
    }
    for (const token of [adminToken, v1.token, v2.token]) {
      await testApp.request
        .post(`/lineups/${lineupId}/submit-nominations`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
    }

    // Even with quorum technically met, pause must keep the lineup put.
    // No grace job should exist; pending_advance_at stays null.
    const stillPaused = await readAdvanceState(lineupId);
    expect(stillPaused.pendingAdvanceAt).toBeNull();
    expect(await readStatus(lineupId)).toBe('building');

    // A paused lineup must NOT have an erroneous grace job queued. Assert its
    // absence directly instead of sleeping to "let it fire": with no job
    // scheduled nothing can flip the status, so the lineup stays 'building'.
    expect(await getGraceJob(lineupId)).toBeFalsy();
    expect(await readStatus(lineupId)).toBe('building');
  });

  // ── ROK-1296 (Codex P2): revert clears stale submitted_at stamps ──

  it('reverting voting → building clears stale nominations_submitted_at stamps so post-TTL quorum requires re-submit', async () => {
    await settings.set(graceKey, '500');
    await settings.set(pauseTtlKey, '86400000');

    const v1 = await createMember('p2-v1');
    const v2 = await createMember('p2-v2');
    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);

    // Stamp every voter's nominations_submitted_at BEFORE the revert so
    // there's something to clear.
    for (const token of [adminToken, v1.token, v2.token]) {
      await testApp.request
        .post(`/lineups/${lineupId}/submit-nominations`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
    }

    const beforeRevert = await testApp.db.execute<{
      user_id: number;
      nominations_submitted_at: Date | null;
    }>(
      sql`SELECT user_id, nominations_submitted_at FROM community_lineup_user_submissions WHERE lineup_id = ${lineupId}`,
    );
    expect(beforeRevert.length).toBe(3);
    for (const row of beforeRevert) {
      expect(row.nominations_submitted_at).not.toBeNull();
    }

    // Advance to voting, then revert back to building.
    await advanceToVoting(lineupId, adminToken);
    await revertToBuilding(lineupId, adminToken);
    expect(await readStatus(lineupId)).toBe('building');

    // Revert MUST have cleared the stale nominations_submitted_at stamps.
    const afterRevert = await testApp.db.execute<{
      user_id: number;
      nominations_submitted_at: Date | null;
    }>(
      sql`SELECT user_id, nominations_submitted_at FROM community_lineup_user_submissions WHERE lineup_id = ${lineupId}`,
    );
    expect(afterRevert.length).toBe(3);
    for (const row of afterRevert) {
      expect(row.nominations_submitted_at).toBeNull();
    }
  });

  // ── AC-T4: pause TTL elapse → next mutation advances normally ──

  it('AC-T4: after pause TTL elapses, next mutation re-schedules grace and advances', async () => {
    await settings.set(graceKey, '500');
    // Tiny pause TTL so it expires immediately.
    await settings.set(pauseTtlKey, '50');

    const v1 = await createMember('act4-v1');
    const v2 = await createMember('act4-v2');

    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: submit closes the voting-quorum gate so grace is set.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);

    await revertToBuilding(lineupId, adminToken);
    expect(
      (await readAdvanceState(lineupId)).autoAdvancePausedAt,
    ).not.toBeNull();

    // Deterministically expire the pause cool-off: push auto_advance_paused_at
    // far enough into the past that the 50ms TTL is guaranteed elapsed, rather
    // than sleeping for it. This puts the row in the exact "TTL elapsed" state
    // the next mutation must observe to re-schedule grace.
    await writeAdvanceState(
      lineupId,
      'auto_advance_paused_at',
      new Date(Date.now() - 60_000),
    );

    // Top up nominations to satisfy the nomination floor (default 4).
    for (let i = 0; i < 3; i++) {
      const g = await createGames(1);
      await nominate(adminToken, lineupId, g[0].id);
    }

    // ROK-1296: every voter must submit-nominations for building quorum.
    for (const token of [adminToken, v1.token, v2.token]) {
      await testApp.request
        .post(`/lineups/${lineupId}/submit-nominations`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
    }

    // Once the floor is met AND TTL has elapsed, the next mutation must
    // schedule grace and (after 500ms) flip to voting.
    await waitForStatus(lineupId, 'voting', 10_000);
  });

  // ── GAP-A: cancelAllForLineup removes grace jobs ───────────────

  it('GAP-A: cancelAllForLineup removes a pending grace job', async () => {
    await settings.set(graceKey, '300000');

    const v1 = await createMember('gapa-v1');
    const v2 = await createMember('gapa-v2');
    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);
    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);

    // Grace job exists.
    const before = await getGraceJob(lineupId);
    expect(before).toBeDefined();
    expect(before).not.toBeNull();

    await phaseQueue.cancelAllForLineup(lineupId);

    const after = await getGraceJob(lineupId);
    // After cancellation the job is gone (or at minimum, not in a runnable
    // state). We tolerate either "null returned" or "state is completed".
    if (after) {
      const state = await after.getState();
      expect(['completed', 'removed', 'failed']).toContain(state);
    } else {
      expect(after).toBeFalsy();
    }
  });

  // ── GAP-B: processor pause-check no-ops on a paused lineup ────

  it('GAP-B: grace processor no-ops when auto_advance_paused_at is set', async () => {
    await settings.set(graceKey, '500');
    await settings.set(pauseTtlKey, '86400000');

    const v1 = await createMember('gapb-v1');
    const v2 = await createMember('gapb-v2');
    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);
    expect((await readAdvanceState(lineupId)).pendingAdvanceAt).not.toBeNull();

    // Manually stamp the row as paused WHILE the grace job is still
    // pending. We do this directly via raw SQL to simulate a race
    // where the BullMQ cancel-on-revert lost.
    await writeAdvanceState(lineupId, 'auto_advance_paused_at', new Date());

    // Wait until the delayed grace job actually fires and the processor runs
    // to completion (job removed on complete, or a terminal state) instead of
    // sleeping for the 500ms delay. Once it has run we can assert it no-op'd.
    const processed = await pollForCondition(async () => {
      const job = await getGraceJob(lineupId);
      if (!job) return true; // removeOnComplete → processor ran and finished
      const state = await job.getState();
      return state === 'completed' || state === 'failed' ? true : null;
    }, 10_000);
    expect(processed).toBe(true);

    // Status must stay 'voting' — the processor saw the pause and bailed.
    expect(await readStatus(lineupId)).toBe('voting');
  });

  // ── GAP-C: forward manual during grace clears pending_advance_at ──

  it('GAP-C: forward manual advance during grace nulls pending_advance_at and removes the grace job', async () => {
    await settings.set(graceKey, '300000');

    const v1 = await createMember('gapc-v1');
    const v2 = await createMember('gapc-v2');
    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);
    expect((await readAdvanceState(lineupId)).pendingAdvanceAt).not.toBeNull();
    const beforeJob = await getGraceJob(lineupId);
    expect(beforeJob).toBeTruthy();

    // Operator clicks "Advance now" — forward manual transition.
    const adv = await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: games[0].id });
    expect(adv.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('decided');

    // After manual advance: pending_advance_at + auto_advance_paused_at
    // are both null (forward transition clears).
    const after = await readAdvanceState(lineupId);
    expect(after.pendingAdvanceAt).toBeNull();
    expect(after.autoAdvancePausedAt).toBeNull();

    // The grace job is gone (eagerly cancelled by the forward-transition
    // side-effect).
    const afterJob = await getGraceJob(lineupId);
    if (afterJob) {
      const state = await afterJob.getState();
      expect(['completed', 'removed', 'failed']).toContain(state);
    } else {
      expect(afterJob).toBeFalsy();
    }
  });

  // ── GAP-D: race — two parallel maybeAutoAdvance schedule exactly one ──

  it('GAP-D: two concurrent maybeAutoAdvance calls schedule exactly one grace job', async () => {
    await settings.set(graceKey, '300000');

    const v1 = await createMember('gapd-v1');
    const v2 = await createMember('gapd-v2');
    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    // Cast 2 of 3 votes so quorum is NOT yet met. The third vote
    // — fired concurrently from two parallel callers — should drive
    // both to invoke maybeAutoAdvance against a quorum-ready row.
    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);

    // Build the deps the helper needs. We expose the helper directly
    // (the service has its own copy; we ask for a public test handle
    // so the conditional-UPDATE race can be triggered without going
    // through the toggle endpoint twice and double-mutating votes).
    // If `autoAdvanceDeps` is not exposed, this assertion will fail
    // by construction.
    const svc = lineupsService as unknown as {
      autoAdvanceDeps?: () => Parameters<typeof maybeAutoAdvance>[0];
    };
    expect(typeof svc.autoAdvanceDeps).toBe('function');
    const deps = svc.autoAdvanceDeps!();

    // Cast v2's vote so quorum closes, then fire two parallel advance
    // attempts. The conditional-UPDATE (`pending_advance_at IS NULL`)
    // must ensure only one wins; the loser must no-op.
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);

    // Clear any baseline pending_advance_at written by the vote path
    // so the race is observable on its own merits.
    await writeAdvanceState(lineupId, 'pending_advance_at', null);
    const baseline = await getGraceJob(lineupId);
    if (baseline) await baseline.remove();

    await Promise.all([
      maybeAutoAdvance(deps, lineupId),
      maybeAutoAdvance(deps, lineupId),
    ]);

    // Exactly one grace job exists (BullMQ jobId uniqueness + conditional
    // UPDATE both contribute, but the assertion is on the OBSERVABLE
    // outcome: one job in the queue, one timestamp on the row).
    const after = await getGraceJob(lineupId);
    expect(after).toBeTruthy();
    const state = await readAdvanceState(lineupId);
    expect(state.pendingAdvanceAt).not.toBeNull();
  });

  // ── REWORK-1: grace transition routes through runStatusTransition ──

  it('REWORK-1: grace voting→decided runs full transition (auto-picks decidedGameId + writes activity log)', async () => {
    await settings.set(graceKey, '500');

    const v1 = await createMember('rwk1-v1');
    const v2 = await createMember('rwk1-v2');

    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);
    expect(await readStatus(lineupId)).toBe('voting');

    // All 3 voters back games[0] — unique top, no tie.
    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);

    // Wait for grace to elapse and the BullMQ worker to process.
    await waitForStatus(lineupId, 'decided', 10_000);

    // ROK-1263 / ROK-1253-rework: the grace path must have routed through
    // `runStatusTransition` → `deriveTopVotedGame`, leaving decided_game_id
    // set instead of NULL. Previously the direct UPDATE in the processor
    // would land the row in `decided` with no winner picked.
    const [decidedRow] = await testApp.db
      .select({ decidedGameId: schema.communityLineups.decidedGameId })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    expect(decidedRow.decidedGameId).toBe(games[0].id);

    // `logTransition` must have written a `lineup_decided` activity entry —
    // the bypassing UPDATE in the previous implementation never reached it.
    // `runStatusTransition` writes the activity log AFTER applyStatusUpdate
    // succeeds, so the row's status may flip slightly before the log lands;
    // poll briefly.
    const decidedActivity = await pollForCondition(async () => {
      const [row] = await testApp.db
        .select()
        .from(schema.activityLog)
        .where(
          and(
            eq(schema.activityLog.entityType, 'lineup'),
            eq(schema.activityLog.entityId, lineupId),
            eq(schema.activityLog.action, 'lineup_decided'),
          ),
        )
        .orderBy(desc(schema.activityLog.createdAt))
        .limit(1);
      return row ?? null;
    }, 5_000);
    expect(decidedActivity).toBeTruthy();
  });

  // ── REWORK-2: rehydrate pending grace jobs after API restart ──

  it('REWORK-2: rehydratePendingJobs re-enqueues a grace job for a lineup whose pending_advance_at is in the future', async () => {
    await settings.set(graceKey, '300000');

    const v1 = await createMember('rwk2-v1');
    const createRes = await createPrivateLineup(adminToken, [v1.userId], 1);
    const lineupId = createRes.body.id as number;

    // Stamp a future pending_advance_at directly — simulates a row left
    // behind when the API restarted between scheduleGraceAdvance and the
    // job firing. Force-flip status to 'voting' so the processor's grace
    // branch (which checks `status in {building, voting}`) would accept it.
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'voting' })
      .where(eq(schema.communityLineups.id, lineupId));
    const futureDeadline = new Date(Date.now() + 120_000);
    await writeAdvanceState(lineupId, 'pending_advance_at', futureDeadline);

    // Pre-condition: no grace job exists for this lineup.
    const baseline = await getGraceJob(lineupId);
    if (baseline) await baseline.remove();
    expect(await getGraceJob(lineupId)).toBeFalsy();

    // Drive the rehydration directly — same path bestEffortInit runs at boot.
    await (
      phaseProcessor as unknown as {
        rehydratePendingJobs(): Promise<void>;
      }
    ).rehydratePendingJobs();

    // The job must now exist as a delayed BullMQ entry.
    const rehydrated = await getGraceJob(lineupId);
    expect(rehydrated).toBeTruthy();
    if (rehydrated) {
      const state = await rehydrated.getState();
      expect(['delayed', 'waiting']).toContain(state);
    }
  });

  // ── REWORK-3: gateway emits lineup:graceScheduled when grace BEGINS ──

  it('REWORK-3: scheduleOrAdvance broadcasts lineup:graceScheduled on grace claim', async () => {
    await settings.set(graceKey, '300000');

    const v1 = await createMember('rwk3-v1');
    const v2 = await createMember('rwk3-v2');
    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    // All 3 voters vote, but only 2 submit — quorum not yet ready under
    // the ROK-1296 per-voter submission gate.
    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    await submitAllVotes(lineupId, [adminToken, v1.token]);

    // Spy on the gateway BEFORE the quorum-closing submit so the emit is
    // captured. Use jest.spyOn so we don't clobber the real socket.io server.
    const spy = jest
      .spyOn(lineupsGateway, 'emitGraceScheduled')
      .mockImplementation(() => undefined);

    try {
      // v2's submit closes quorum → maybeAutoAdvance → scheduleOrAdvance.
      await submitAllVotes(lineupId, [v2.token]);

      // The fire-and-forget call inside the toggle handler races the HTTP
      // response; poll until the gateway emit has flushed instead of sleeping
      // for a fixed window.
      await pollForCondition(
        () => Promise.resolve(spy.mock.calls.length > 0 ? true : null),
        5_000,
      );

      expect(spy).toHaveBeenCalledTimes(1);
      const [emittedId, emittedAt] = spy.mock.calls[0];
      expect(emittedId).toBe(lineupId);
      expect(emittedAt).toBeInstanceOf(Date);
      const state = await readAdvanceState(lineupId);
      expect(state.pendingAdvanceAt).not.toBeNull();
      // Emitted timestamp matches the row's pending_advance_at (within ms).
      const diff = Math.abs(
        emittedAt.getTime() - state.pendingAdvanceAt!.getTime(),
      );
      expect(diff).toBeLessThan(2000);
    } finally {
      spy.mockRestore();
    }
  });

  // ── REWORK v2 (Codex round 2): clear claim on failed grace transition ──

  it('REWORK-4: grace failure clears pendingAdvanceAt + cancels job (no deadlock on TIEBREAKER_REQUIRED)', async () => {
    await settings.set(graceKey, '300');

    const v1 = await createMember('rwk4-v1');
    const v2 = await createMember('rwk4-v2');
    const createRes = await createPrivateLineup(
      adminToken,
      [v1.userId, v2.userId],
      1,
    );
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(v1.token, lineupId, games[1].id);
    await advanceToVoting(lineupId, adminToken);

    // Cast all 3 votes so the quorum predicate inside processGraceAdvance
    // returns ready: true → reaches runGraceTransition where the stub
    // throws. Without this the grace branch short-circuits to
    // clearPendingAdvance and we never exercise the catch path.
    await vote(adminToken, lineupId, games[0].id);
    await vote(v1.token, lineupId, games[0].id);
    await vote(v2.token, lineupId, games[0].id);
    // ROK-1296: explicit submit closes the per-voter quorum gate.
    await submitAllVotes(lineupId, [adminToken, v1.token, v2.token]);

    // The three votes + submits already triggered the real grace pipeline.
    // Cancel any in-flight grace job + reset claim so we drive the
    // processor by hand under the stub.
    await phaseQueue.cancelGraceAdvance(lineupId);
    const futureDeadline = new Date(Date.now() + 60_000);
    await writeAdvanceState(lineupId, 'pending_advance_at', futureDeadline);
    await phaseQueue.scheduleGraceAdvance(lineupId, 60_000);
    expect(await getGraceJob(lineupId)).toBeTruthy();

    // Stub runStatusTransition via the processor's deps surface. The
    // processor builds its own TransitionDeps locally so we hijack by
    // mocking the helper module's exported function.
    const stub = jest
      .spyOn(transitionMod, 'runStatusTransition')
      .mockRejectedValue(new Error('TIEBREAKER_REQUIRED'));

    try {
      await (
        phaseProcessor as unknown as {
          processGraceAdvance(id: number): Promise<void>;
        }
      ).processGraceAdvance(lineupId);

      // Post-failure: pendingAdvanceAt cleared, grace job removed.
      const state = await readAdvanceState(lineupId);
      expect(state.pendingAdvanceAt).toBeNull();
      const job = await getGraceJob(lineupId);
      expect(job).toBeFalsy();
    } finally {
      stub.mockRestore();
    }
  });

  // ── REWORK v2 (Codex round 2): rehydrate overdue grace too ──

  it('REWORK-5: rehydratePendingJobs re-enqueues an OVERDUE grace job (downtime case)', async () => {
    await settings.set(graceKey, '300000');

    const v1 = await createMember('rwk5-v1');
    const createRes = await createPrivateLineup(adminToken, [v1.userId], 1);
    const lineupId = createRes.body.id as number;

    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'voting' })
      .where(eq(schema.communityLineups.id, lineupId));

    // Stamp a deadline in the PAST — simulates API down past the grace
    // window. Pre-fix the rehydration filtered `> now` and dropped this.
    const overdueDeadline = new Date(Date.now() - 30_000);
    await writeAdvanceState(lineupId, 'pending_advance_at', overdueDeadline);

    const baseline = await getGraceJob(lineupId);
    if (baseline) await baseline.remove();
    expect(await getGraceJob(lineupId)).toBeFalsy();

    await (
      phaseProcessor as unknown as {
        rehydratePendingJobs(): Promise<void>;
      }
    ).rehydratePendingJobs();

    // Codex round 3 P3: don't assert on the queued job — overdue work
    // fires at delay=0 with removeOnComplete:true, so a healthy worker
    // can consume it before we sample. Assert on the durable outcome:
    // processGraceAdvance must have run and (with no quorum) cleared
    // `pending_advance_at`. This proves the rehydration path actually
    // re-engaged the worker, surviving worker-already-ran races.
    const cleared = await pollForCondition(async () => {
      const state = await readAdvanceState(lineupId);
      return state.pendingAdvanceAt === null ? true : null;
    }, 5_000);
    expect(cleared).toBe(true);
  });
}

describe(
  'Lineup auto-advance grace window (ROK-1253, integration)',
  describeGrace,
);
