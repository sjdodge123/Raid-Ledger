/**
 * BullMQ producer for lineup phase transitions (ROK-946).
 * Follows the embed-sync.queue.ts pattern.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  LINEUP_PHASE_QUEUE,
  type LineupPhaseJobData,
} from './lineup-phase.constants';

@Injectable()
export class LineupPhaseQueueService {
  private readonly logger = new Logger(LineupPhaseQueueService.name);

  constructor(@InjectQueue(LINEUP_PHASE_QUEUE) private readonly queue: Queue) {}

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
