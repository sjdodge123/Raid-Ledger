import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const AD_HOC_GRACE_QUEUE = 'ad-hoc-grace-period';

export interface AdHocGracePeriodJobData {
  eventId: number;
}

/**
 * Producer service for the ad-hoc grace period BullMQ queue (ROK-293).
 *
 * Enqueues a delayed job that fires when the grace period expires.
 * If members rejoin before expiry, the job is cancelled.
 * Follows the EmbedSyncQueueService pattern.
 */
@Injectable()
export class AdHocGracePeriodQueueService {
  private readonly logger = new Logger(AdHocGracePeriodQueueService.name);

  constructor(@InjectQueue(AD_HOC_GRACE_QUEUE) private readonly queue: Queue) {}

  /**
   * Enqueue a grace period expiration job.
   * Replaces any existing job for the same event.
   */
  async enqueue(eventId: number, delayMs: number): Promise<void> {
    const jobId = `grace-${eventId}`;

    try {
      // Remove any existing delayed/waiting job
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'delayed' || state === 'waiting') {
          await existingJob.remove();
        }
      }

      await this.queue.add(
        'grace-expire',
        { eventId } satisfies AdHocGracePeriodJobData,
        {
          jobId,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );

      this.logger.debug(
        `Enqueued grace period for event ${eventId} (delay: ${Math.round(delayMs / 1000)}s)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue grace period for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Cancel a pending grace period job (member rejoined).
   */
  async cancel(eventId: number): Promise<void> {
    const jobId = `grace-${eventId}`;

    try {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'delayed' || state === 'waiting') {
          await existingJob.remove();
          this.logger.debug(`Cancelled grace period for event ${eventId}`);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to cancel grace period for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
