/**
 * BullMQ processor for lineup phase transitions (ROK-946).
 * Handles automatic phase advancement and rehydration on startup.
 *
 * ROK-1253 — the same queue now carries two job names: `phase-transition`
 * (deadline-driven) and `grace-advance` (re-evaluate quorum after grace
 * window). The processor branches on `job.name`.
 */
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { bestEffortInit } from '../../common/lifecycle.util';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Job } from 'bullmq';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { LineupStatus } from '../../drizzle/schema';
import {
  LINEUP_GRACE_ADVANCE,
  LINEUP_PHASE_QUEUE,
  LINEUP_PHASE_TRANSITION,
  NEXT_PHASE,
  type LineupGraceAdvanceJobData,
  type LineupPhaseJobData,
} from './lineup-phase.constants';
import { LineupPhaseQueueService } from './lineup-phase.queue';
import { SettingsService } from '../../settings/settings.service';
import { LineupsGateway } from '../lineups.gateway';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { LineupNotificationService } from '../lineup-notification.service';
import { isPauseActive } from '../lineups-auto-advance.helpers';
import { runStatusTransition } from '../lineups-transition.helpers';
import {
  checkBuildingQuorum,
  checkVotingQuorum,
} from '../quorum/quorum-check.helpers';

@Processor(LINEUP_PHASE_QUEUE)
export class LineupPhaseProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(LineupPhaseProcessor.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly queueService: LineupPhaseQueueService,
    /** ROK-1253: injected for the grace-advance re-quorum-check path. */
    private readonly settings: SettingsService,
    /** ROK-1253: gateway emit on grace-driven status flip flows through
     *  `runStatusTransition`; kept here to bundle into TransitionDeps and
     *  for any future direct broadcast needs from this processor. */
    private readonly lineupsGateway: LineupsGateway,
    /**
     * ROK-1253 rework: grace-driven `voting → decided` (and `building →
     * voting`) now routes through `runStatusTransition` so it triggers
     * tiebreaker detection, matching, activity logging, voting-open /
     * decided notifications, and the gateway emit. The bypassing UPDATE
     * silently skipped all of those side-effects.
     */
    private readonly activityLog: ActivityLogService,
    private readonly lineupNotifications: LineupNotificationService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await bestEffortInit(
      'LineupPhaseProcessor',
      this.logger,
      () => this.rehydratePendingJobs(),
      { retries: 3 },
    );
  }

  /** Process a phase or grace-advance job (branches on `job.name`). */
  async process(
    job: Job<LineupPhaseJobData | LineupGraceAdvanceJobData>,
  ): Promise<void> {
    if (job.name === LINEUP_GRACE_ADVANCE) {
      const { lineupId } = job.data;
      this.logger.debug(`Processing grace-advance for lineup ${lineupId}`);
      await this.processGraceAdvance(lineupId);
      return;
    }
    if (job.name === LINEUP_PHASE_TRANSITION) {
      const { lineupId, targetStatus } = job.data as LineupPhaseJobData;
      this.logger.debug(
        `Processing phase transition for lineup ${lineupId} → ${targetStatus}`,
      );
      await this.executeTransition(lineupId, targetStatus);
      return;
    }
    this.logger.warn(`Unknown lineup-phase job name: ${job.name}`);
  }

  /**
   * ROK-1253: Re-evaluate quorum after the grace window has elapsed.
   * Bails out as no-op for stale rows: status moved on, pause armed during
   * the wait, or the timestamp was cleared by a mutation that broke quorum.
   */
  private async processGraceAdvance(lineupId: number): Promise<void> {
    const [lineup] = await this.findLineup(lineupId);
    if (!lineup) return;
    if (lineup.status !== 'building' && lineup.status !== 'voting') return;
    // Architect correction #3: belt-and-suspenders pause check; the
    // backwards-revert side-effect already cancels the job, but cancel
    // can race with the worker pulling the job off the queue.
    if (await isPauseActive(this.db, this.settings, lineup)) return;
    if (lineup.pendingAdvanceAt === null) return;
    const ready =
      lineup.status === 'building'
        ? (await checkBuildingQuorum(this.db, this.settings, lineup)).ready
        : (await checkVotingQuorum(this.db, lineup)).ready;
    if (!ready) {
      await this.clearPendingAdvance(lineupId);
      return;
    }
    await this.runGraceTransition(lineupId, lineup);
  }

  /**
   * Route the grace flip through `runStatusTransition` (ROK-1253 rework
   * for Codex finding #1). Doing so preserves:
   *  - tiebreaker detection on `voting → decided`
   *  - matching algorithm + decided notifications
   *  - activity log entries (transition + auto-advance metadata)
   *  - voting-open notifications on `building → voting`
   *  - gateway `lineup:status` emit
   *
   * The previous direct UPDATE bypassed every one of those. A `ConflictException`
   * from `applyStatusUpdate` (status changed mid-grace) is swallowed — same
   * shape as `maybeAutoAdvance`'s try/catch. A `TIEBREAKER_REQUIRED` 400
   * indicates the operator needs to pick a winner; we leave `pendingAdvanceAt`
   * alone so the banner stays up and the next vote will re-trigger.
   */
  private async runGraceTransition(
    lineupId: number,
    lineup: typeof schema.communityLineups.$inferSelect,
  ): Promise<void> {
    const targetStatus: LineupStatus =
      lineup.status === 'building' ? 'voting' : 'decided';
    try {
      await runStatusTransition(this.buildTransitionDeps(), lineupId, {
        status: targetStatus,
      });
      this.logger.log(`Lineup ${lineupId} grace-advanced to '${targetStatus}'`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Grace transition for lineup ${lineupId} → '${targetStatus}' failed: ${msg}`,
      );
      // ROK-1253 rework v2 (Codex round 2 P1): when grace hits
      // TIEBREAKER_REQUIRED the BullMQ job is already consumed; if we leave
      // `pendingAdvanceAt` set, `scheduleOrAdvance` refuses to re-schedule
      // and the lineup deadlocks behind the stuck banner. Clear the claim
      // so the next mutation (or operator tiebreaker resolution) can
      // re-trigger cleanly. Same hygiene for any other failure mode.
      //
      // Codex round 3 P2: cancel BEFORE clearing. Once `pendingAdvanceAt`
      // is null, `scheduleOrAdvance` can race ahead and claim a fresh
      // window + enqueue a new `lineup-grace-<id>` job. If we cancelled
      // after the clear, we'd delete that NEW job by ID and leave the
      // row in the same deadlock we're trying to prevent. The consumed
      // job is removed first so the same-ID cancel is a no-op by the
      // time a new one is enqueued.
      await this.queueService.cancelGraceAdvance(lineupId);
      await this.clearPendingAdvance(lineupId);
    }
  }

  /** ROK-1253: Null `pending_advance_at` when grace re-check sees quorum is gone. */
  private async clearPendingAdvance(lineupId: number): Promise<void> {
    await this.db
      .update(schema.communityLineups)
      .set({ pendingAdvanceAt: null, updatedAt: new Date() })
      .where(eq(schema.communityLineups.id, lineupId));
  }

  /**
   * ROK-1363: bundle the injected services into the `runStatusTransition`
   * dependency object. Shared by the grace and deadline transition paths so
   * the (identical) deps block isn't duplicated.
   */
  private buildTransitionDeps() {
    return {
      db: this.db,
      activityLog: this.activityLog,
      phaseQueue: this.queueService,
      lineupNotifications: this.lineupNotifications,
      lineupsGateway: this.lineupsGateway,
      logger: this.logger,
    };
  }

  /**
   * Execute a deadline-driven transition through `runStatusTransition`
   * (ROK-1363). The deadline path previously did a bare UPDATE that bypassed
   * voting-open / decided notifications, the gateway emit, the activity-log
   * entry, the matching algorithm, and tiebreaker detection. Routing it
   * through the canonical orchestrator (mirroring `runGraceTransition`) fires
   * all of them — and `applyStatusUpdate` already schedules the next phase,
   * so we must NOT also schedule here (double-enqueue double-advances).
   *
   * Keep the early stale-job no-op so the common "two jobs raced, one won"
   * case stays a quiet debug log rather than a noisy `validateTransition`
   * throw. The try/catch additionally swallows a late CAS-race
   * `ConflictException` (same shape as `runGraceTransition`).
   */
  private async executeTransition(
    lineupId: number,
    targetStatus: string,
  ): Promise<void> {
    const [lineup] = await this.findLineup(lineupId);
    if (!lineup) {
      this.logger.debug(`Lineup ${lineupId} not found, skipping`);
      return;
    }

    const expectedFrom = this.findExpectedFrom(targetStatus);
    if (lineup.status !== expectedFrom) {
      this.logger.debug(
        `Lineup ${lineupId} is '${lineup.status}', expected '${expectedFrom}' — stale job, no-op`,
      );
      return;
    }

    try {
      await runStatusTransition(this.buildTransitionDeps(), lineupId, {
        status: targetStatus as LineupStatus,
      });
      this.logger.log(`Lineup ${lineupId} transitioned to '${targetStatus}'`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Deadline transition for lineup ${lineupId} → '${targetStatus}' failed: ${msg}`,
      );
    }
  }

  /** Find which phase we expect the lineup to currently be in. */
  private findExpectedFrom(targetStatus: string): string | null {
    for (const [from, to] of Object.entries(NEXT_PHASE)) {
      if (to === targetStatus) return from;
    }
    return null;
  }

  /** Find a lineup by ID. */
  private findLineup(lineupId: number) {
    return this.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
  }

  /**
   * Rehydrate pending jobs on startup for active lineups (phase deadlines
   * AND grace windows). ROK-1253 rework: a restart between
   * `scheduleGraceAdvance` and the job firing would otherwise leave the
   * lineup with `pending_advance_at` set but no scheduled work — the row
   * sits stuck until the next mutation or the much later `phaseDeadline`
   * job fires.
   */
  private async rehydratePendingJobs(): Promise<void> {
    const activeStatuses: LineupStatus[] = ['building', 'voting', 'decided'];
    const lineups = await this.db
      .select()
      .from(schema.communityLineups)
      .where(inArray(schema.communityLineups.status, activeStatuses));

    const withDeadline = lineups.filter((l) => l.phaseDeadline !== null);
    // ROK-1253 rework v2 (Codex round 2 P1): include EVERY non-null
    // pendingAdvanceAt row — not just future ones. `rehydrateGraceJob`
    // already clamps overdue deadlines to delay=0 via `Math.max(0, ...)`,
    // so an overdue grace just fires immediately on restart. Filtering by
    // `> now` would silently drop lineups that expired during downtime
    // and leave them stuck.
    const withPendingGrace = lineups.filter((l) => l.pendingAdvanceAt !== null);

    if (withDeadline.length === 0 && withPendingGrace.length === 0) return;

    this.logger.log(
      `Rehydrating ${withDeadline.length} phase + ${withPendingGrace.length} grace job(s)`,
    );

    for (const lineup of withDeadline) {
      await this.rehydrateOneLineup(lineup);
    }
    for (const lineup of withPendingGrace) {
      await this.rehydrateGraceJob(lineup);
    }
  }

  /** Rehydrate a single lineup's phase job. */
  private async rehydrateOneLineup(
    lineup: typeof schema.communityLineups.$inferSelect,
  ): Promise<void> {
    const next = NEXT_PHASE[lineup.status];
    if (!next || !lineup.phaseDeadline) return;

    const delayMs = Math.max(0, lineup.phaseDeadline.getTime() - Date.now());
    await this.queueService.scheduleTransition(lineup.id, next, delayMs);
  }

  /**
   * ROK-1253 rework: re-enqueue a delayed grace-advance job for any lineup
   * whose `pending_advance_at` is still in the future. `scheduleGraceAdvance`
   * is idempotent — it removes any stale job before re-adding.
   */
  private async rehydrateGraceJob(
    lineup: typeof schema.communityLineups.$inferSelect,
  ): Promise<void> {
    if (!lineup.pendingAdvanceAt) return;
    const delayMs = Math.max(0, lineup.pendingAdvanceAt.getTime() - Date.now());
    await this.queueService.scheduleGraceAdvance(lineup.id, delayMs);
  }
}
