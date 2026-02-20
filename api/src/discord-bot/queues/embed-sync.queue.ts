import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const EMBED_SYNC_QUEUE = 'discord-embed-sync';

/** Debounce window in milliseconds — max 1 embed edit per event per window. */
const DEBOUNCE_DELAY_MS = 10_000;

export interface EmbedSyncJobData {
  eventId: number;
  reason: string;
}

/**
 * Producer service for the discord-embed-sync BullMQ queue (ROK-119).
 *
 * Enqueues debounced embed sync jobs. If a job for the same eventId is
 * already waiting in the queue, the old job is removed and replaced with
 * a fresh one (effectively resetting the debounce timer).
 */
@Injectable()
export class EmbedSyncQueueService {
  private readonly logger = new Logger(EmbedSyncQueueService.name);

  constructor(@InjectQueue(EMBED_SYNC_QUEUE) private readonly queue: Queue) {}

  /**
   * Enqueue a debounced embed sync job for the given event.
   * Uses a deterministic job ID so duplicate jobs for the same event
   * are deduplicated. Removes any existing pending job before adding
   * a new one with a fresh delay.
   */
  async enqueue(eventId: number, reason: string): Promise<void> {
    const jobId = `embed-sync-${eventId}`;

    try {
      // Remove any existing delayed/waiting job for this event
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'delayed' || state === 'waiting') {
          await existingJob.remove();
        }
      }

      await this.queue.add(
        'sync-embed',
        { eventId, reason } satisfies EmbedSyncJobData,
        {
          jobId,
          delay: DEBOUNCE_DELAY_MS,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );

      this.logger.debug(
        `Enqueued embed sync for event ${eventId} (reason: ${reason})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue embed sync for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
