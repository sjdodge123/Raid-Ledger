import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const DEPARTURE_GRACE_QUEUE = 'departure-grace';

/** Default grace period before a departed member's slot is freed (ms). */
export const DEPARTURE_GRACE_DELAY_MS = 30 * 1000; // 30s for dev testing — revert to 5 * 60 * 1000 before shipping

export interface DepartureGraceJobData {
  eventId: number;
  discordUserId: string;
  signupId: number;
}

/**
 * Producer service for the departure grace period BullMQ queue (ROK-596).
 *
 * Enqueues a delayed job per user+event when a member leaves voice mid-event.
 * If the member rejoins before expiry, the job is cancelled.
 * Follows the AdHocGracePeriodQueueService pattern.
 */
@Injectable()
export class DepartureGraceQueueService {
  private readonly logger = new Logger(DepartureGraceQueueService.name);

  constructor(
    @InjectQueue(DEPARTURE_GRACE_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Enqueue a departure grace period expiration job.
   * Replaces any existing job for the same user+event pair.
   */
  async enqueue(data: DepartureGraceJobData, delayMs: number): Promise<void> {
    const jobId = `depart-${data.eventId}-${data.discordUserId}`;

    try {
      // Remove any existing delayed/waiting job
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'delayed' || state === 'waiting') {
          await existingJob.remove();
        }
      }

      await this.queue.add('departure-expire', data, {
        jobId,
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      });

      this.logger.debug(
        `Enqueued departure grace for user ${data.discordUserId} event ${data.eventId} (delay: ${Math.round(delayMs / 1000)}s)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue departure grace for user ${data.discordUserId} event ${data.eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Cancel a pending departure grace job (member rejoined voice).
   */
  async cancel(eventId: number, discordUserId: string): Promise<void> {
    const jobId = `depart-${eventId}-${discordUserId}`;

    try {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'delayed' || state === 'waiting') {
          await existingJob.remove();
          this.logger.debug(
            `Cancelled departure grace for user ${discordUserId} event ${eventId}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to cancel departure grace for user ${discordUserId} event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
