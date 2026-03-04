import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const EMBED_SYNC_QUEUE = 'discord-embed-sync';

/** Coalescing window in milliseconds — max 1 embed edit per event per window. */
const COALESCE_DELAY_MS = 2_000;

export interface EmbedSyncJobData {
  eventId: number;
  reason: string;
}

/**
 * Producer service for the discord-embed-sync BullMQ queue (ROK-119, ROK-664).
 *
 * Coalesces rapid-fire embed sync requests per event. When multiple triggers
 * arrive for the same eventId within the coalescing window, the delay is
 * reset so only the final state gets synced to Discord.
 */
@Injectable()
export class EmbedSyncQueueService {
  private readonly logger = new Logger(EmbedSyncQueueService.name);

  constructor(@InjectQueue(EMBED_SYNC_QUEUE) private readonly queue: Queue) {}

  /**
   * Enqueue a coalesced embed sync job for the given event.
   *
   * If a delayed job already exists for the same eventId, resets its timer
   * and updates the reason (avoiding the remove+re-add race condition).
   * If the existing job is already active/waiting, skips — the running
   * job will pick up the latest state from the DB anyway.
   */
  async enqueue(eventId: number, reason: string): Promise<void> {
    const jobId = `embed-sync-${eventId}`;

    try {
      const existingJob = await this.queue.getJob(jobId);

      if (existingJob) {
        const state = await existingJob.getState();

        if (state === 'delayed') {
          // Reset the coalescing window — only the final state matters
          await existingJob.updateData({ eventId, reason });
          await existingJob.changeDelay(COALESCE_DELAY_MS);
          this.logger.debug(
            `Coalesced embed sync for event ${eventId} (reason: ${reason})`,
          );
          return;
        }

        if (state === 'active' || state === 'waiting') {
          // Job is already processing or about to — processor reads
          // latest state from DB, so this trigger is a no-op.
          this.logger.debug(
            `Embed sync already ${state} for event ${eventId}, skipping (reason: ${reason})`,
          );
          return;
        }
      }

      await this.queue.add(
        'sync-embed',
        { eventId, reason } satisfies EmbedSyncJobData,
        {
          jobId,
          delay: COALESCE_DELAY_MS,
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
