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
import * as schema from '../../drizzle/schema';
import {
  LINEUP_PHASE_QUEUE,
  type LineupPhaseJobData,
} from './lineup-phase.constants';

interface ActiveStandaloneArchiveCandidate {
  lineupId: number;
  phaseDeadline: Date | string;
}

/**
 * `phase_deadline` is a `timestamp without time zone` column. postgres-js
 * returns it as a naïve string; default `new Date()` parses in local TZ.
 * We INSERT JS Dates as UTC, so re-parse with an explicit UTC suffix.
 */
function parsePhaseDeadlineUtc(value: Date | string): Date {
  if (value instanceof Date) return value;
  const s = String(value);
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
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
      const deadline = parsePhaseDeadlineUtc(phaseDeadline);
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
      await this.addJob(jobId, lineupId, targetStatus, delayMs);
    } catch (error) {
      this.logger.error(
        `Failed to schedule transition for lineup ${lineupId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  /**
   * Cancel all pending phase-transition jobs for a lineup.
   * Removes delayed/waiting jobs for all four target statuses.
   * Used by smoke tests to prevent stale jobs from advancing lineups.
   */
  async cancelAllForLineup(lineupId: number): Promise<number> {
    const targets = ['voting', 'decided', 'scheduling', 'archived'];
    let removed = 0;
    for (const target of targets) {
      const jobId = `lineup-phase-${lineupId}-${target}`;
      const job = await this.queue.getJob(jobId);
      if (!job) continue;
      const state = await job.getState();
      if (state === 'delayed' || state === 'waiting') {
        await job.remove();
        removed++;
      }
    }
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

  /** Add the delayed job to the queue. */
  private async addJob(
    jobId: string,
    lineupId: number,
    targetStatus: string,
    delayMs: number,
  ): Promise<void> {
    await this.queue.add(
      'phase-transition',
      { lineupId, targetStatus } satisfies LineupPhaseJobData,
      {
        jobId,
        delay: Math.max(0, delayMs),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    this.logger.debug(
      `Scheduled ${targetStatus} for lineup ${lineupId} in ${Math.round(delayMs / 60_000)}m`,
    );
  }
}
