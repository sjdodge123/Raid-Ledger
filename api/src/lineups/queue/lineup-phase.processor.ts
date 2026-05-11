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
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Job } from 'bullmq';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { LineupStatus } from '../../drizzle/schema';
import {
  DEFAULT_DURATIONS,
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
import { isPauseActive } from '../lineups-auto-advance.helpers';
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
    /** ROK-1253: emit on grace-driven status flip so subscribed clients
     *  invalidate the lineup query immediately instead of waiting for
     *  their poll interval — without this the GraceCountdownBanner
     *  stays stuck on "Transitioning..." until the next refetch. */
    private readonly lineupsGateway: LineupsGateway,
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
   * Apply the status flip and clear the grace columns atomically. We don't
   * fire downstream notifications here; mirroring `applyTransition` keeps
   * the queue path simple. The lineup row's `updatedAt` change is enough
   * for clients to poll and re-render.
   */
  private async runGraceTransition(
    lineupId: number,
    lineup: typeof schema.communityLineups.$inferSelect,
  ): Promise<void> {
    const targetStatus: LineupStatus =
      lineup.status === 'building' ? 'voting' : 'decided';
    const duration = this.getDurationForPhase(targetStatus, lineup);
    const phaseDeadline = this.computeDeadline(targetStatus, duration);
    const result = await this.db
      .update(schema.communityLineups)
      .set({
        status: targetStatus,
        phaseDeadline,
        pendingAdvanceAt: null,
        autoAdvancePausedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.communityLineups.id, lineupId),
          eq(schema.communityLineups.status, lineup.status),
          isNotNull(schema.communityLineups.pendingAdvanceAt),
        ),
      )
      .returning({ id: schema.communityLineups.id });
    if (result.length === 0) return;
    this.logger.log(`Lineup ${lineupId} grace-advanced to '${targetStatus}'`);
    // ROK-1253: push the status flip to subscribed clients immediately.
    // Mirrors the emit `runStatusTransition` does for synchronous flips.
    this.lineupsGateway.emitStatusChange(lineupId, targetStatus, new Date());
    const nextPhase = NEXT_PHASE[targetStatus];
    if (nextPhase && phaseDeadline) {
      const delayMs = phaseDeadline.getTime() - Date.now();
      await this.queueService.scheduleTransition(lineupId, nextPhase, delayMs);
    }
  }

  /** ROK-1253: Null `pending_advance_at` when grace re-check sees quorum is gone. */
  private async clearPendingAdvance(lineupId: number): Promise<void> {
    await this.db
      .update(schema.communityLineups)
      .set({ pendingAdvanceAt: null, updatedAt: new Date() })
      .where(eq(schema.communityLineups.id, lineupId));
  }

  /** Execute transition if lineup is in the expected pre-phase. */
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

    await this.applyTransition(lineupId, targetStatus, lineup);
  }

  /** Find which phase we expect the lineup to currently be in. */
  private findExpectedFrom(targetStatus: string): string | null {
    for (const [from, to] of Object.entries(NEXT_PHASE)) {
      if (to === targetStatus) return from;
    }
    return null;
  }

  /** Apply the status update and schedule next phase. */
  private async applyTransition(
    lineupId: number,
    targetStatus: string,
    lineup: typeof schema.communityLineups.$inferSelect,
  ): Promise<void> {
    const nextPhase = NEXT_PHASE[targetStatus];
    const duration = this.getDurationForPhase(targetStatus, lineup);
    const phaseDeadline = this.computeDeadline(targetStatus, duration);

    await this.updateLineupStatus(
      lineupId,
      targetStatus as LineupStatus,
      phaseDeadline,
    );
    this.logger.log(`Lineup ${lineupId} transitioned to '${targetStatus}'`);

    if (nextPhase && phaseDeadline) {
      const delayMs = phaseDeadline.getTime() - Date.now();
      await this.queueService.scheduleTransition(lineupId, nextPhase, delayMs);
    }
  }

  /** Compute phase deadline, null for archived. */
  private computeDeadline(
    targetStatus: string,
    durationHours: number | null,
  ): Date | null {
    if (targetStatus === 'archived' || !durationHours) return null;
    return new Date(Date.now() + durationHours * 3_600_000);
  }

  /** Get duration hours for the target phase from overrides → hardcoded defaults. */
  private getDurationForPhase(
    targetStatus: string,
    lineup: typeof schema.communityLineups.$inferSelect,
  ): number | null {
    if (targetStatus === 'archived') return null;
    const overrides = lineup.phaseDurationOverride;
    if (overrides && typeof overrides === 'object') {
      const key = targetStatus as keyof typeof overrides;
      const val = key !== 'standalone' ? overrides[key] : undefined;
      if (typeof val === 'number') return val;
    }
    const key = targetStatus as keyof typeof DEFAULT_DURATIONS;
    return DEFAULT_DURATIONS[key] ?? 48;
  }

  /** Update lineup status and phaseDeadline in DB. */
  private async updateLineupStatus(
    lineupId: number,
    status: LineupStatus,
    phaseDeadline: Date | null,
  ): Promise<void> {
    await this.db
      .update(schema.communityLineups)
      .set({ status, phaseDeadline, updatedAt: new Date() })
      .where(eq(schema.communityLineups.id, lineupId));
  }

  /** Find a lineup by ID. */
  private findLineup(lineupId: number) {
    return this.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
  }

  /** Rehydrate pending jobs on startup for active lineups. */
  private async rehydratePendingJobs(): Promise<void> {
    const activeStatuses: LineupStatus[] = ['building', 'voting', 'decided'];
    const lineups = await this.db
      .select()
      .from(schema.communityLineups)
      .where(inArray(schema.communityLineups.status, activeStatuses));

    const withDeadline = lineups.filter((l) => l.phaseDeadline !== null);
    if (withDeadline.length === 0) return;

    this.logger.log(`Rehydrating ${withDeadline.length} lineup phase jobs`);

    for (const lineup of withDeadline) {
      await this.rehydrateOneLineup(lineup);
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
}
