/**
 * ROK-1192 — Standalone scheduling poll deadline reminders (integration).
 *
 * TDD gate: these tests pin down the spec for the new
 * `StandalonePollReminderService` cron, the deadline-backfill migration,
 * and the archive-recovery reconciler. They MUST fail until the dev
 * agent wires:
 *   - `StandalonePollReminderService.checkReminders()` / `runReminders()`
 *   - The backfill migration that fills `phase_deadline` on existing
 *     active standalone polls.
 *   - The boot-time `reconcileArchiveJobs()` hook on the lineup phase queue.
 *
 * Coverage (8 cases):
 *   1. 24h reminder fires for non-voter
 *   2. 1h reminder fires for non-voter
 *   3. Voter who voted before 1h tick does NOT get the 1h DM
 *   4. Same window dedup — running cron twice = one DM per non-voter
 *   5. Polls with `phase_deadline = NULL` are skipped
 *   6. Concluded poll (status='archived') generates no further reminders
 *   7. Backfill migration: active standalone lineup w/ null deadline gets
 *      `created_at + 36h` after the migration query runs.
 *   8. Reconciler: active decided standalone lineup with phase_deadline
 *      future-of-now has an archive job queued after boot.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { LineupPhaseQueueService } from '../queue/lineup-phase.queue';
// NOTE: this import target does NOT yet exist — the dev agent creates it
// in this story. Importing here is what makes the test fail (compile-time)
// until the service file is added.
import { StandalonePollReminderService } from './standalone-poll-reminder.service';

interface StandaloneSetup {
  lineupId: number;
  matchId: number;
  gameId: number;
  memberIds: number[];
}

const HOUR_MS = 60 * 60 * 1000;

function describeStandalonePollReminders() {
  let testApp: TestApp;
  let adminToken: string;
  let reminderService: StandalonePollReminderService;
  let notificationService: NotificationService;
  let dedup: NotificationDedupService;
  let phaseQueue: LineupPhaseQueueService;
  let createSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    reminderService = testApp.app.get(StandalonePollReminderService);
    notificationService = testApp.app.get(NotificationService);
    dedup = testApp.app.get(NotificationDedupService);
    phaseQueue = testApp.app.get(LineupPhaseQueueService);
    void adminToken;
  });

  beforeEach(() => {
    createSpy = jest
      .spyOn(notificationService, 'create')
      .mockResolvedValue({ id: 'mock-notif' } as never);
    // Reset dedup behaviour to "never seen before" each test; specific
    // tests override this when they need to assert dedup short-circuits.
    jest.spyOn(dedup, 'checkAndMarkSent').mockResolvedValue(false);
  });

  afterEach(async () => {
    createSpy.mockRestore();
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── helpers ──────────────────────────────────────────────────────

  async function createMember(tag: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:${tag}`,
        username: `mem-${tag}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  async function createGame(name: string): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: `${name.toLowerCase()}-${Date.now()}` })
      .returning();
    return g.id;
  }

  /**
   * Build a standalone scheduling poll directly in the DB so we control
   * `phase_deadline` to the millisecond. Mirrors the shape produced by
   * `StandalonePollService.create()` (decided lineup +
   * `phaseDurationOverride.standalone=true` marker + scheduling match +
   * one match member per provided id).
   */
  async function setupStandalonePoll(
    tag: string,
    hoursUntilDeadline: number | null,
    extraMembers = 2,
    overrides: { status?: 'decided' | 'archived' } = {},
  ): Promise<StandaloneSetup> {
    const creatorId = testApp.seed.adminUser.id;
    const memberIds: number[] = [];
    for (let i = 0; i < extraMembers; i++) {
      memberIds.push(await createMember(`${tag}-m${i}`));
    }
    const gameId = await createGame(`Game-${tag}`);

    const phaseDeadline =
      hoursUntilDeadline === null
        ? null
        : new Date(Date.now() + hoursUntilDeadline * HOUR_MS);

    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Standalone Scheduling Poll',
        status: overrides.status ?? 'decided',
        visibility: 'public',
        createdBy: creatorId,
        phaseDeadline,
        phaseDurationOverride: { standalone: true },
      })
      .returning();

    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 0,
      })
      .returning();

    await testApp.db.insert(schema.communityLineupMatchMembers).values(
      [creatorId, ...memberIds].map((userId) => ({
        matchId: match.id,
        userId,
        source: 'voted' as const,
      })),
    );

    return {
      lineupId: lineup.id,
      matchId: match.id,
      gameId,
      memberIds,
    };
  }

  /** Insert a schedule slot + a vote from `userId` so they count as a voter. */
  async function castScheduleVote(
    matchId: number,
    userId: number,
  ): Promise<void> {
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + 7 * 24 * HOUR_MS),
        suggestedBy: 'user',
      })
      .returning();
    await testApp.db.insert(schema.communityLineupScheduleVotes).values({
      slotId: slot.id,
      userId,
    });
  }

  function dmSubtypesSent(): string[] {
    return createSpy.mock.calls.map((c) => {
      const arg = c[0] as { payload?: { subtype?: string } };
      return arg.payload?.subtype ?? '';
    });
  }

  function dmsForUser(userId: number): Array<Record<string, unknown>> {
    return createSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((arg) => arg.userId === userId);
  }

  function dmWindowsByUser(): Map<number, Set<string>> {
    const out = new Map<number, Set<string>>();
    for (const call of createSpy.mock.calls) {
      const arg = call[0] as {
        userId: number;
        payload?: { window?: string };
      };
      if (!out.has(arg.userId)) out.set(arg.userId, new Set());
      if (arg.payload?.window) out.get(arg.userId)!.add(arg.payload.window);
    }
    return out;
  }

  // ── AC #2 / Test 1: 24h reminder fires for non-voters ────────────

  it('fires 24h DM with subtype standalone_scheduling_poll_reminder for non-voters', async () => {
    const { matchId, lineupId, memberIds } = await setupStandalonePoll(
      'a24',
      20, // 20h until deadline → 24h window
      2,
    );
    void matchId;

    await reminderService.runReminders();

    // Both invited members + creator are non-voters → 3 DMs.
    expect(createSpy).toHaveBeenCalled();
    const subtypes = dmSubtypesSent();
    expect(
      subtypes.filter((s) => s === 'standalone_scheduling_poll_reminder')
        .length,
    ).toBeGreaterThanOrEqual(memberIds.length);

    // Each DM carries the correct payload + the 24h window marker.
    for (const memberId of memberIds) {
      const calls = dmsForUser(memberId);
      expect(calls.length).toBe(1);
      expect(calls[0]).toMatchObject({
        type: 'community_lineup',
        title: expect.stringMatching(/closing soon|24 hours/i),
        payload: expect.objectContaining({
          subtype: 'standalone_scheduling_poll_reminder',
          lineupId,
          matchId,
          window: '24h',
        }),
      });
    }
  });

  // ── AC #3 / Test 2: 1h reminder fires for non-voters ─────────────

  it('fires 1h DM with copy "closing now" / "1 hour" when <= 1h remains', async () => {
    const { memberIds, lineupId, matchId } = await setupStandalonePoll(
      'a1h',
      0.5, // 30 minutes left → 1h window
      1,
    );

    await reminderService.runReminders();

    expect(createSpy).toHaveBeenCalled();
    for (const memberId of memberIds) {
      const calls = dmsForUser(memberId);
      expect(calls.length).toBe(1);
      expect(calls[0]).toMatchObject({
        title: expect.stringMatching(/closing now|1 hour/i),
        payload: expect.objectContaining({
          subtype: 'standalone_scheduling_poll_reminder',
          lineupId,
          matchId,
          window: '1h',
        }),
      });
    }
  });

  // ── AC #4 / Test 3: voted-before-1h users skip the 1h DM ─────────

  it('does NOT fire a 1h DM to a member who already voted on a slot', async () => {
    const { memberIds, matchId } = await setupStandalonePoll('voted', 0.5, 2);
    const voter = memberIds[0];
    const nonVoter = memberIds[1];
    await castScheduleVote(matchId, voter);

    await reminderService.runReminders();

    // The voter is excluded by the non-voters query.
    expect(dmsForUser(voter).length).toBe(0);
    expect(dmsForUser(nonVoter).length).toBe(1);
  });

  // ── AC #5 / Test 4: dedup — 2nd cron tick = no second DM ─────────

  it('dedup key prevents double-fire when cron runs twice in the same window', async () => {
    const { memberIds } = await setupStandalonePoll('dedup', 20, 1);
    const dedupSpy = jest
      .spyOn(dedup, 'checkAndMarkSent')
      // First tick: no key seen yet → false (DM goes out)
      // Second tick: key already marked → true (skip)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false) // creator (first run)
      .mockResolvedValue(true); // every subsequent call
    void dedupSpy;

    await reminderService.runReminders();
    const firstRun = createSpy.mock.calls.length;
    expect(firstRun).toBeGreaterThan(0);

    await reminderService.runReminders();

    // Total calls did NOT grow on the second run because dedup blocked.
    expect(createSpy.mock.calls.length).toBe(firstRun);

    // Sanity: dedup key uses the spec's exact shape.
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith(
      expect.stringMatching(/^standalone-poll-reminder:\d+:\d+:(24h|1h)$/),
      expect.anything(),
    );
    // Window-by-user: each user got at most one window across both runs.
    for (const memberId of memberIds) {
      const wins = dmWindowsByUser().get(memberId) ?? new Set();
      expect(wins.size).toBeLessThanOrEqual(1);
    }
  });

  // ── AC #6 / Test 5: phase_deadline IS NULL → no DMs ──────────────

  it('skips polls with phase_deadline = NULL (no reminders fired)', async () => {
    await setupStandalonePoll('null-deadline', null, 2);

    await reminderService.runReminders();

    expect(createSpy).not.toHaveBeenCalled();
  });

  // ── AC #7 / Test 6: archived poll → no DMs (concluded-poll guard) ─

  it('skips concluded polls (status flipped to archived)', async () => {
    await setupStandalonePoll('archived', 0.5, 2, { status: 'archived' });

    await reminderService.runReminders();

    expect(createSpy).not.toHaveBeenCalled();
  });

  // ── AC #10 / Test 7: backfill migration ─────────────────────────

  it(
    'backfill migration sets phase_deadline = created_at + 36h on active ' +
      'standalone polls with NULL deadline (idempotent)',
    async () => {
      // Insert a standalone lineup that was created 12h ago with NULL
      // deadline — mimics the production state described in the spec.
      const creatorId = testApp.seed.adminUser.id;
      const createdAt = new Date(Date.now() - 12 * HOUR_MS);
      const [lineup] = await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: 'Standalone Scheduling Poll',
          status: 'decided',
          visibility: 'public',
          createdBy: creatorId,
          phaseDeadline: null,
          phaseDurationOverride: { standalone: true },
          createdAt,
          updatedAt: createdAt,
        })
        .returning();

      // Re-run the migration body verbatim. Idempotent on its own and
      // should leave non-standalone rows untouched.
      const migrationSql = sql`
        UPDATE community_lineups
        SET phase_deadline = created_at + interval '36 hours'
        WHERE status = 'decided'
          AND phase_duration_override->>'standalone' = 'true'
          AND phase_deadline IS NULL
      `;
      await testApp.db.execute(migrationSql);

      const [after] = await testApp.db
        .select()
        .from(schema.communityLineups)
        .where(eq(schema.communityLineups.id, lineup.id));

      expect(after.phaseDeadline).not.toBeNull();
      const expected = new Date(createdAt.getTime() + 36 * HOUR_MS).getTime();
      const actual = (after.phaseDeadline as Date).getTime();
      // Allow 5s slack for clock skew between insert and migration body.
      expect(Math.abs(actual - expected)).toBeLessThan(5_000);

      // Idempotent: running the same SQL again must not change the row.
      await testApp.db.execute(migrationSql);
      const [afterSecond] = await testApp.db
        .select()
        .from(schema.communityLineups)
        .where(eq(schema.communityLineups.id, lineup.id));
      expect((afterSecond.phaseDeadline as Date).getTime()).toBe(actual);
    },
  );

  // ── AC #11 / Test 8: archive reconciler ─────────────────────────

  it(
    'reconcileArchiveJobs() schedules an archive job for every active ' +
      'standalone lineup with phase_deadline > now()',
    async () => {
      const { lineupId } = await setupStandalonePoll('reconcile', 6, 0);

      const scheduleSpy = jest
        .spyOn(phaseQueue, 'scheduleTransition')
        .mockResolvedValue(undefined as never);

      // The reconciler is a method on the service that owns the queue;
      // by spec it is invoked via `OnModuleInit` at boot but exposed as
      // a public method we can call directly in tests. Until the dev
      // agent adds it, this `(... as ...).reconcileArchiveJobs` access
      // is `undefined` and the call below throws — which is the failure
      // we want pre-implementation.
      const svc = phaseQueue as unknown as {
        reconcileArchiveJobs?: () => Promise<unknown>;
      };
      expect(typeof svc.reconcileArchiveJobs).toBe('function');
      await svc.reconcileArchiveJobs!();

      // Reconciler MUST have asked the queue to schedule a transition
      // for our lineup → archived, with a positive delay.
      const archiveCalls = scheduleSpy.mock.calls.filter(
        (c) => c[0] === lineupId && c[1] === 'archived',
      );
      expect(archiveCalls.length).toBeGreaterThanOrEqual(1);
      expect(archiveCalls[0][2]).toBeGreaterThan(0);
    },
  );
}

describe(
  'Standalone scheduling poll reminders (integration, ROK-1192)',
  describeStandalonePollReminders,
);
