/**
 * Deadline-driven lineup phase transition notification integration tests
 * (ROK-1363). TDD gate — written BEFORE the implementation.
 *
 * Bug: the deadline-expiry trigger (`LineupPhaseProcessor.executeTransition →
 * applyTransition → updateLineupStatus`) does a bare
 * `db.update(communityLineups).set({ status, phaseDeadline })` that BYPASSES
 * every side-effect the canonical `runStatusTransition` orchestrator fires —
 * voting-open / decided notifications, the gateway `lineup:status` emit, the
 * activity-log entry, the matching algorithm, and tiebreaker detection. The
 * grace/quorum trigger was already converted under ROK-1253; the deadline
 * trigger was left on the old pattern.
 *
 * The fix (1) routes `executeTransition` through `runStatusTransition`,
 * deleting the redundant manual scheduling, and (2) threads the freshly-
 * computed voting `phaseDeadline` into `fireVotingOpen` instead of the stale
 * pre-update building deadline.
 *
 * These tests drive the DEADLINE path specifically by invoking
 * `processor.process({ name: LINEUP_PHASE_TRANSITION, data: {...} })`.
 *
 * The five spec assertions (with their TDD status against current code):
 *   AC1 building→voting by deadline — CONFIRMED FAILING (no notify/emit/log,
 *        and double-schedule guard). Current code does a bare UPDATE.
 *   AC2 voting→decided by deadline — CONFIRMED FAILING (no decided notify, no
 *        matching, no auto-pick of decidedGameId, no activity log).
 *   AC3 secondary deadline bug — CONFIRMED FAILING. Driven through the GRACE
 *        path (which DOES call notifyVotingOpen today) so the stale-deadline
 *        defect is observable on current code; also asserted on the deadline
 *        path once it routes through runStatusTransition.
 *   AC4 stale-job no-op — PASS BY CONSTRUCTION. The early `status !==
 *        expectedFrom` guard already short-circuits.
 *   AC5 grace path still single-fires — PASS BY CONSTRUCTION (regression
 *        guard; grace already routes through runStatusTransition).
 */
import { and, desc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';
import { LINEUP_PHASE_TRANSITION } from './queue/lineup-phase.constants';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupsGateway } from './lineups.gateway';
import { LineupNotificationService } from './lineup-notification.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { at, defined, nonEmpty } from '../common/testing/narrow';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

interface Spies {
  notifyVotingOpen: jest.SpyInstance;
  notifyMatchesFound: jest.SpyInstance;
  emitStatusChange: jest.SpyInstance;
  scheduleTransition: jest.SpyInstance;
  activityLog: jest.SpyInstance;
}

function describeDeadlineNotify() {
  let testApp: TestApp;
  let adminToken: string;
  let processor: LineupPhaseProcessor;
  let phaseQueue: LineupPhaseQueueService;
  let gateway: LineupsGateway;
  let notifications: LineupNotificationService;
  let activityLogSvc: ActivityLogService;
  let settings: SettingsService;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    processor = testApp.app.get(LineupPhaseProcessor);
    // `LineupPhaseQueueService` is provided in BOTH LineupsModule and
    // StandalonePollModule, so `app.get()` may resolve a different instance
    // than the one the processor injected. Spy on the processor's actual
    // injected service so `scheduleTransition` call-counts are observed.
    phaseQueue = (
      processor as unknown as { queueService: LineupPhaseQueueService }
    ).queueService;
    gateway = testApp.app.get(LineupsGateway);
    notifications = testApp.app.get(LineupNotificationService);
    activityLogSvc = testApp.app.get(ActivityLogService);
    settings = testApp.app.get(SettingsService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS);
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── helpers ────────────────────────────────────────────────────

  /**
   * Install spies on every side-effect surface `runStatusTransition` should
   * drive. `notifyVotingOpen` / `notifyMatchesFound` are mocked to no-op so
   * the (fire-and-forget) Discord dispatch never reaches the bot client; we
   * only care that they were invoked with the right args. `scheduleTransition`
   * is left calling through (we assert call COUNT, the double-schedule guard).
   */
  function installSpies(): Spies {
    return {
      notifyVotingOpen: jest
        .spyOn(notifications, 'notifyVotingOpen')
        .mockResolvedValue(undefined),
      notifyMatchesFound: jest
        .spyOn(notifications, 'notifyMatchesFound')
        .mockResolvedValue(undefined),
      emitStatusChange: jest
        .spyOn(gateway, 'emitStatusChange')
        .mockImplementation(() => undefined),
      scheduleTransition: jest.spyOn(phaseQueue, 'scheduleTransition'),
      activityLog: jest.spyOn(activityLogSvc, 'log'),
    };
  }

  async function createMember(
    tag: string,
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('Deadline1!', 4);
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:${tag}@deadline.local`,
          username: tag,
          role: 'member',
        })
        .returning(),
      'user',
    );
    const email = `${tag}@deadline.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'Deadline1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createPrivateLineup(
    inviteeUserIds: number[],
    nominationTargetPct?: number,
  ) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Deadline Notify Test',
        visibility: 'private',
        inviteeUserIds,
        votesPerPlayer: 1,
        ...(nominationTargetPct === undefined ? {} : { nominationTargetPct }),
      });
  }

  async function createGames(count: number) {
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = nonEmpty(
        await testApp.db
          .insert(schema.games)
          .values({
            name: `Deadline Game ${i + 1}`,
            slug: `deadline-game-${i + 1}-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 7)}`,
          })
          .returning(),
        'game',
      );
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

  async function advanceToVoting(lineupId: number) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'voting' });
  }

  /** Read the persisted row directly (bypasses caches). */
  async function readLineup(lineupId: number) {
    const [row] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    return defined(row, `lineup ${lineupId}`);
  }

  /** Drive the deadline phase-transition job through the processor. */
  async function fireDeadlineJob(
    lineupId: number,
    targetStatus: 'voting' | 'decided',
  ): Promise<void> {
    await processor.process({
      name: LINEUP_PHASE_TRANSITION,
      data: { lineupId, targetStatus },
    } as never);
  }

  async function countActivity(
    lineupId: number,
    action: string,
  ): Promise<number> {
    const rows = await testApp.db
      .select({ id: schema.activityLog.id })
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.entityType, 'lineup'),
          eq(schema.activityLog.entityId, lineupId),
          eq(schema.activityLog.action, action),
        ),
      );
    return rows.length;
  }

  async function latestActivity(lineupId: number, action: string) {
    const [row] = await testApp.db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.entityType, 'lineup'),
          eq(schema.activityLog.entityId, lineupId),
          eq(schema.activityLog.action, action),
        ),
      )
      .orderBy(desc(schema.activityLog.createdAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Poll a predicate until truthy or timeout. Used for fire-and-forget
   * side-effects (notify hooks, activity log) that resolve AFTER the awaited
   * transition returns. Never uses sleep().
   */
  async function pollFor<T>(
    fn: () => T | null | Promise<T | null>,
    timeoutMs: number,
  ): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await fn();
      if (result) return result;
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  }

  // ── AC1: building → voting by deadline ─────────────────────────
  //
  // CONFIRMED FAILING against current code: the bare UPDATE in
  // `applyTransition` fires NO notification, NO gateway emit, NO activity
  // log. `scheduleTransition` IS called once today (the manual call in
  // applyTransition), but the fix moves that into applyStatusUpdate — the
  // call-count-of-exactly-1 assertion guards against the double-schedule
  // regression where BOTH paths enqueue.

  it('AC1: building→voting by deadline fires voting-open notify + single emit + single activity log + single next-phase schedule', async () => {
    const v1 = await createMember('ac1-v1');
    const createRes = await createPrivateLineup([v1.userId]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const games = await createGames(2);
    await nominate(adminToken, lineupId, at(games, 0).id);
    await nominate(v1.token, lineupId, at(games, 1).id);

    // Lineup is in 'building'; quorum NOT met (no submits). The deadline job
    // must still flip it to 'voting' and fire the full transition.
    expect((await readLineup(lineupId)).status).toBe('building');

    const spies = installSpies();
    await fireDeadlineJob(lineupId, 'voting');

    // Row flipped to voting.
    expect((await readLineup(lineupId)).status).toBe('voting');

    // Voting-open notification fired exactly once (fire-and-forget — poll).
    const notified = await pollFor(
      () => (spies.notifyVotingOpen.mock.calls.length >= 1 ? true : null),
      4_000,
    );
    expect(notified).toBe(true);
    expect(spies.notifyVotingOpen).toHaveBeenCalledTimes(1);

    // Gateway emit fired once with 'voting'.
    expect(spies.emitStatusChange).toHaveBeenCalledTimes(1);
    expect(spies.emitStatusChange.mock.calls[0][1]).toBe('voting');

    // Exactly one `voting_started` activity-log row.
    const logged = await pollFor(
      async () =>
        (await countActivity(lineupId, 'voting_started')) >= 1 ? true : null,
      4_000,
    );
    expect(logged).toBe(true);
    expect(await countActivity(lineupId, 'voting_started')).toBe(1);

    // Next phase (voting → decided) scheduled EXACTLY once. Double-schedule
    // regression guard: the manual applyTransition schedule must NOT coexist
    // with applyStatusUpdate's schedule.
    const votingSchedules = spies.scheduleTransition.mock.calls.filter(
      (c) => c[1] === 'decided',
    );
    expect(votingSchedules.length).toBe(1);
  });

  // ── AC2: voting → decided by deadline ──────────────────────────
  //
  // CONFIRMED FAILING: the bare UPDATE lands the row in 'decided' with
  // decided_game_id NULL, runs no matching, fires no decided notification,
  // and writes no `lineup_decided` activity log.

  it('AC2: voting→decided by deadline runs matching + auto-picks winner + fires decided notify + activity log', async () => {
    const v1 = await createMember('ac2-v1');
    const v2 = await createMember('ac2-v2');
    const createRes = await createPrivateLineup([v1.userId, v2.userId]);
    const lineupId = createRes.body.id as number;

    const games = await createGames(2);
    await nominate(adminToken, lineupId, at(games, 0).id);
    await nominate(v1.token, lineupId, at(games, 1).id);
    await advanceToVoting(lineupId);
    expect((await readLineup(lineupId)).status).toBe('voting');

    // All three voters back games[0] — unique top, no tie.
    await vote(adminToken, lineupId, at(games, 0).id);
    await vote(v1.token, lineupId, at(games, 0).id);
    await vote(v2.token, lineupId, at(games, 0).id);

    const spies = installSpies();
    await fireDeadlineJob(lineupId, 'decided');

    // Row flipped to decided WITH the auto-picked winner (matching ran).
    const decided = await readLineup(lineupId);
    expect(decided.status).toBe('decided');
    expect(decided.decidedGameId).toBe(at(games, 0).id);

    // Matching produced a match row for the winning game.
    const matchRow = await pollFor(async () => {
      const [row] = await testApp.db
        .select()
        .from(schema.communityLineupMatches)
        .where(eq(schema.communityLineupMatches.lineupId, lineupId))
        .limit(1);
      return row ?? null;
    }, 4_000);
    expect(matchRow).toBeTruthy();

    // Decided notification fired (notifyMatchesFound — fire-and-forget).
    const decidedNotified = await pollFor(
      () => (spies.notifyMatchesFound.mock.calls.length >= 1 ? true : null),
      4_000,
    );
    expect(decidedNotified).toBe(true);

    // Gateway emit + activity log for the decided flip.
    expect(spies.emitStatusChange).toHaveBeenCalledWith(
      lineupId,
      'decided',
      expect.any(Date),
    );
    const decidedActivity = await pollFor(
      async () => latestActivity(lineupId, 'lineup_decided'),
      4_000,
    );
    expect(decidedActivity).toBeTruthy();
  });

  // ── AC3: secondary deadline bug — fireVotingOpen gets the NEW deadline ──
  //
  // CONFIRMED FAILING. Driven through the GRACE path (building→voting on
  // quorum) — that path already calls runStatusTransition → fireVotingOpen
  // today, but threads the STALE pre-update building deadline. We assert the
  // votingDeadline handed to notifyVotingOpen equals the row's NEW (voting)
  // phaseDeadline, not the old building deadline they straddle. The defect is
  // shared by both triggers; fixing line ~96 of lineups-transition.helpers.ts
  // is what makes this pass. We also assert the deadline path (once it routes
  // through runStatusTransition) gets the new deadline.

  it('AC3: notifyVotingOpen receives the NEW voting phaseDeadline, not the stale building deadline (deadline path)', async () => {
    const v1 = await createMember('ac3-v1');
    const createRes = await createPrivateLineup([v1.userId]);
    const lineupId = createRes.body.id as number;

    const games = await createGames(2);
    await nominate(adminToken, lineupId, at(games, 0).id);
    await nominate(v1.token, lineupId, at(games, 1).id);

    const buildingDeadline = (await readLineup(lineupId)).phaseDeadline;

    const spies = installSpies();
    await fireDeadlineJob(lineupId, 'voting');

    const notified = await pollFor(
      () => (spies.notifyVotingOpen.mock.calls.length >= 1 ? true : null),
      4_000,
    );
    expect(notified).toBe(true);

    // The deadline argument threaded into notifyVotingOpen is the FIRST
    // positional arg's `votingDeadline` (LineupInfo). It must equal the row's
    // freshly-written voting phaseDeadline, NOT the pre-update building one.
    const passedInfo = spies.notifyVotingOpen.mock.calls[0][0] as {
      votingDeadline?: Date;
    };
    const newDeadline = (await readLineup(lineupId)).phaseDeadline;
    expect(passedInfo.votingDeadline).toBeDefined();
    expect(passedInfo.votingDeadline!.getTime()).toBe(newDeadline!.getTime());

    // And specifically NOT the stale building deadline (sanity: they differ —
    // building default 48h vs voting default 24h give distinct timestamps).
    if (buildingDeadline) {
      expect(passedInfo.votingDeadline!.getTime()).not.toBe(
        buildingDeadline.getTime(),
      );
    }
  });

  // ── AC4: stale-job no-op ───────────────────────────────────────
  //
  // PASS BY CONSTRUCTION: the early `status !== expectedFrom` guard
  // short-circuits before any transition logic. A job targeting 'voting' for
  // a lineup that is ALREADY 'voting' (expectedFrom 'building' ≠ 'voting')
  // must do nothing.

  it('AC4 (pass-by-construction): stale phase-transition job on an already-advanced lineup is a no-op', async () => {
    const v1 = await createMember('ac4-v1');
    const createRes = await createPrivateLineup([v1.userId]);
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    await nominate(adminToken, lineupId, at(games, 0).id);
    await nominate(v1.token, lineupId, at(games, 1).id);
    await advanceToVoting(lineupId);
    expect((await readLineup(lineupId)).status).toBe('voting');

    // The legitimate advance above already wrote one `voting_started` row;
    // baseline it so we assert the STALE job adds none.
    const baselineLog = await countActivity(lineupId, 'voting_started');

    const spies = installSpies();
    // Stale job: targetStatus 'voting' but the lineup is already 'voting'
    // (expectedFrom resolves to 'building').
    await fireDeadlineJob(lineupId, 'voting');

    // Give any erroneous fire-and-forget hook a beat to (not) fire.
    await new Promise((r) => setTimeout(r, 250));

    expect(spies.notifyVotingOpen).not.toHaveBeenCalled();
    expect(spies.emitStatusChange).not.toHaveBeenCalled();
    expect(spies.scheduleTransition).not.toHaveBeenCalled();
    // No NEW activity-log row from the stale job.
    expect(await countActivity(lineupId, 'voting_started')).toBe(baselineLog);
    // Status unchanged.
    expect((await readLineup(lineupId)).status).toBe('voting');
  });

  // ── AC5: grace path still single-fires (regression guard) ──────
  //
  // PASS BY CONSTRUCTION: the grace path already routes through
  // runStatusTransition (ROK-1253). This guards that the ROK-1363 changes
  // (shared orchestrator + return-deadline plumbing) don't introduce a
  // double-notify on the grace trigger.

  it('AC5 (pass-by-construction): grace building→voting fires voting-open exactly once (no double-notify)', async () => {
    // The live building→voting grace trigger is the ROK-1444 nomination count
    // target (TDB:449 retired the submission quorum). A 25% target of the
    // 20-entry cap is 5 nominations, which also clears the default floor of 4.
    // The lineup is created with 0 entries, so the target is armed (below it)
    // and the 5th nomination is the rising edge that claims the grace window.
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '300000');
    const v1 = await createMember('ac5-v1');
    const createRes = await createPrivateLineup([v1.userId], 25);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    const games = await createGames(5);
    for (const [i, game] of games.entries()) {
      const token = i === games.length - 1 ? v1.token : adminToken;
      expect((await nominate(token, lineupId, game.id)).status).toBe(201);
    }
    // A long grace window: the crossing claims it without the BullMQ job
    // firing during the test, so the grace branch is ours to drive.
    expect((await readLineup(lineupId)).status).toBe('building');
    expect((await readLineup(lineupId)).pendingAdvanceAt).not.toBeNull();

    const spies = installSpies();
    const priv = processor as unknown as {
      processGraceAdvance(id: number): Promise<void>;
    };
    await priv.processGraceAdvance(lineupId);

    expect((await readLineup(lineupId)).status).toBe('voting');
    // Fire-and-forget hooks land after the transition returns: wait for the
    // notify AND the activity-log row before counting, never a fixed sleep.
    expect(
      await pollFor(() => spies.notifyVotingOpen.mock.calls.length > 0, 5_000),
    ).toBe(true);
    expect(
      await pollFor(() => latestActivity(lineupId, 'voting_started'), 5_000),
    ).not.toBeNull();
    expect(spies.notifyVotingOpen).toHaveBeenCalledTimes(1);
    expect(await countActivity(lineupId, 'voting_started')).toBe(1);
  });
}

describe(
  'Lineup deadline-driven transition notifications (ROK-1363, integration)',
  describeDeadlineNotify,
);
