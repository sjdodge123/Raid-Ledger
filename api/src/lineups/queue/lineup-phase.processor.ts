/**
 * BullMQ processor for lineup phase transitions (ROK-946).
 * Handles automatic phase advancement and rehydration on startup.
 */
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Job } from 'bullmq';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { LineupStatus } from '../../drizzle/schema';
import {
  LINEUP_PHASE_QUEUE,
  NEXT_PHASE,
  type LineupPhaseJobData,
} from './lineup-phase.constants';
import { LineupPhaseQueueService } from './lineup-phase.queue';

@Processor(LINEUP_PHASE_QUEUE)
export class LineupPhaseProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(LineupPhaseProcessor.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly queueService: LineupPhaseQueueService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.rehydratePendingJobs();
  }

  /** Process a phase transition job. */
  async process(job: Job<LineupPhaseJobData>): Promise<void> {
    const { lineupId, targetStatus } = job.data;
    this.logger.debug(
      `Processing phase transition for lineup ${lineupId} → ${targetStatus}`,
    );
    await this.executeTransition(lineupId, targetStatus);
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

  /** Get duration hours for the target phase from overrides. */
  private getDurationForPhase(
    targetStatus: string,
    lineup: typeof schema.communityLineups.$inferSelect,
  ): number | null {
    if (targetStatus === 'archived') return null;
    const overrides = lineup.phaseDurationOverride;
    if (overrides && typeof overrides === 'object') {
      const key = targetStatus as keyof typeof overrides;
      if (key in overrides && overrides[key] != null) return overrides[key];
    }
    return null;
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
