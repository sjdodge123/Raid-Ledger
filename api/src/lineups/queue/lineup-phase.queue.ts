/**
 * BullMQ producer for lineup phase transitions (ROK-946).
 * Follows the embed-sync.queue.ts pattern.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { bestEffortInit } from '../../common/lifecycle.util';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { parseTimestampUtc } from '../../drizzle/timestamp-utils';
import * as schema from '../../drizzle/schema';
import {
  LINEUP_GRACE_ADVANCE,
  LINEUP_PHASE_QUEUE,
  LINEUP_PHASE_TRANSITION,
  type LineupGraceAdvanceJobData,
  type LineupPhaseJobData,
} from './lineup-phase.constants';

interface ActiveStandaloneArchiveCandidate {
  lineupId: number;
  phaseDeadline: Date | string;
}

@Injectable()
export class LineupPhaseQueueService implements OnModuleInit {
  private readonly logger = new Logger(LineupPhaseQueueService.name);

  constructor(
    @InjectQueue(LINEUP_PHASE_QUEUE) private readonly queue: Queue,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Re-queue missing archive transitions for active standalone polls
   * (ROK-1192). Runs at boot so a deploy that drops the BullMQ queue
   * doesn't leave decided-state polls without a deadline job.
   */
  async onModuleInit(): Promise<void> {
    await bestEffortInit('LineupPhaseQueueService', this.logger, () =>
      this.reconcileArchiveJobs(),
    );
  }

  /**
   * Idempotent: re-schedule the `decided → archived` transition for
   * every active standalone poll whose `phase_deadline` is still in
   * the future. Safe to call repeatedly — `scheduleTransition`
   * removes the existing delayed job before re-adding it.
   */
  async reconcileArchiveJobs(): Promise<void> {
    const candidates = await this.findStandaloneArchiveCandidates();
    if (candidates.length === 0) return;
    this.logger.log(
      `Reconciling ${candidates.length} standalone archive job(s)`,
    );
    for (const { lineupId, phaseDeadline } of candidates) {
      const deadline = parseTimestampUtc(phaseDeadline);
      const delayMs = deadline.getTime() - Date.now();
      if (delayMs <= 0) continue;
      await this.scheduleTransition(lineupId, 'archived', delayMs);
    }
  }

  /** Decided standalone lineups with a future deadline. */
  private async findStandaloneArchiveCandidates(): Promise<
    ActiveStandaloneArchiveCandidate[]
  > {
    return (await this.db.execute(sql`
      SELECT id AS "lineupId",
             phase_deadline AS "phaseDeadline"
      FROM community_lineups
      WHERE status = 'decided'
        AND phase_duration_override->>'standalone' = 'true'
        AND phase_deadline IS NOT NULL
        AND phase_deadline > NOW()
    `)) as unknown as ActiveStandaloneArchiveCandidate[];
  }

  /** Schedule a phase transition after the given delay. */
  async scheduleTransition(
    lineupId: number,
    targetStatus: string,
    delayMs: number,
  ): Promise<void> {
    const jobId = `lineup-phase-${lineupId}-${targetStatus}`;
    try {
      await this.removeExisting(jobId);
      await this.enqueue(
        jobId,
        LINEUP_PHASE_TRANSITION,
        { lineupId, targetStatus } satisfies LineupPhaseJobData,
        delayMs,
      );
      this.logger.debug(
        `Scheduled ${targetStatus} for lineup ${lineupId} in ${Math.round(delayMs / 60_000)}m`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to schedule transition for lineup ${lineupId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  /**
   * ROK-1253: Schedule a delayed grace re-evaluation. After `delayMs` the
   * processor's grace branch loads the lineup, re-runs the quorum check and
   * either advances or clears `pending_advance_at`. Distinct job name and
   * jobId namespace from `phase-transition` so a stale-status no-op never
   * fires unintentionally.
   */
  async scheduleGraceAdvance(lineupId: number, delayMs: number): Promise<void> {
    const jobId = `lineup-grace-${lineupId}`;
    try {
      await this.removeExisting(jobId);
      await this.enqueue(
        jobId,
        LINEUP_GRACE_ADVANCE,
        { lineupId } satisfies LineupGraceAdvanceJobData,
        delayMs,
      );
      this.logger.debug(
        `Scheduled grace-advance for lineup ${lineupId} in ${delayMs}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to schedule grace-advance for lineup ${lineupId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  /**
   * ROK-1253: Remove a pending grace-advance job. Idempotent; safe to call
   * when no job exists. Called by `applyStatusUpdate` on any operator-driven
   * transition so the row's new state (forward or backward) is authoritative.
   */
  async cancelGraceAdvance(lineupId: number): Promise<void> {
    const jobId = `lineup-grace-${lineupId}`;
    try {
      await this.removeExisting(jobId);
    } catch (error) {
      this.logger.debug(
        `cancelGraceAdvance(${lineupId}) ignored: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  /**
   * Cancel all pending phase-transition jobs for a lineup.
   * Removes delayed/waiting jobs for all four target statuses AND the
   * ROK-1253 grace job. Used by smoke tests to prevent stale jobs from
   * advancing lineups.
   */
  async cancelAllForLineup(lineupId: number): Promise<number> {
    const targets = ['voting', 'decided', 'scheduling', 'archived'];
    let removed = 0;
    for (const target of targets) {
      const jobId = `lineup-phase-${lineupId}-${target}`;
      removed += (await this.removeIfPending(jobId)) ? 1 : 0;
    }
    // ROK-1253: also drop any pending grace-advance job.
    removed += (await this.removeIfPending(`lineup-grace-${lineupId}`)) ? 1 : 0;
    if (removed > 0) {
      this.logger.debug(
        `Cancelled ${removed} phase job(s) for lineup ${lineupId}`,
      );
    }
    return removed;
  }

  /** Remove an existing delayed job by ID. */
  private async removeExisting(jobId: string): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'delayed' || state === 'waiting') {
        await existing.remove();
      }
    }
  }

  /** Remove a delayed/waiting job and report whether anything was removed. */
  private async removeIfPending(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'delayed' || state === 'waiting') {
      await job.remove();
      return true;
    }
    return false;
  }

  /** Shared add-with-options used by both phase and grace job scheduling. */
  private async enqueue(
    jobId: string,
    jobName: string,
    payload: LineupPhaseJobData | LineupGraceAdvanceJobData,
    delayMs: number,
  ): Promise<void> {
    await this.queue.add(jobName, payload, {
      jobId,
      delay: Math.max(0, delayMs),
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
