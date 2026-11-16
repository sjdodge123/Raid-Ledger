import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { clearFinishedJob } from '../../queue/clear-finished-job.helpers';

export const EMBED_SYNC_QUEUE = 'discord-embed-sync';

/** Coalescing window in milliseconds — max 1 embed edit per event per window. */
const COALESCE_DELAY_MS = 2_000;

export interface EmbedSyncJobData {
  eventId: number;
  reason: string;
}

/**
 * What one coalesce-or-add pass did: `added` a fresh job, `coalesced` into a
 * delayed one, or left an existing `waiting` / `active` job untouched.
 */
type EnqueueOutcome = 'added' | 'coalesced' | 'waiting' | 'active';

/** Fixed jobId of an event's main sync job. */
function mainJobId(eventId: number): string {
  return `embed-sync-${eventId}`;
}

/**
 * Fixed jobId of the single follow-up sync queued behind an ACTIVE main job
 * (ROK-2227). The processor reads only `job.data`, never the jobId.
 */
function followUpJobId(eventId: number): string {
  return `embed-sync-${eventId}-followup`;
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
   * - A delayed job for the eventId → reset its timer and update its reason
   *   (avoiding the remove+re-add race condition).
   * - A waiting job → skip: it has not read the DB yet, so it will see this
   *   write when it runs.
   * - An ACTIVE job → it may already have read the DB, so this write could be
   *   lost (ROK-2227: event 316's embed stayed at DPS 1/3). Queue exactly one
   *   delayed follow-up under its own fixed jobId; every further enqueue while
   *   the main job runs coalesces into that same follow-up.
   */
  async enqueue(eventId: number, reason: string): Promise<void> {
    const data: EmbedSyncJobData = { eventId, reason };
    try {
      const outcome = await this.coalesceOrAdd(mainJobId(eventId), data);
      if (outcome !== 'active') return;
      const followUp = await this.coalesceOrAdd(followUpJobId(eventId), data);
      this.logger.debug(
        `Embed sync active for event ${eventId}; follow-up ${followUp} (reason: ${reason})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue embed sync for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Coalesce into the job holding `jobId`, or add a fresh delayed one.
   * A `waiting` or `active` job is left alone and its state returned.
   */
  private async coalesceOrAdd(
    jobId: string,
    data: EmbedSyncJobData,
  ): Promise<EnqueueOutcome> {
    const job = await this.queue.getJob(jobId);
    const state = job ? await job.getState() : 'missing';
    if (job && state === 'delayed') {
      await job.updateData(data);
      await job.changeDelay(COALESCE_DELAY_MS);
      this.logger.debug(
        `Coalesced embed sync ${jobId} (reason: ${data.reason})`,
      );
      return 'coalesced';
    }
    if (state === 'active' || state === 'waiting') return state;
    await this.addDelayed(jobId, data);
    return 'added';
  }

  /** Add a fresh delayed sync job under a fixed jobId. */
  private async addDelayed(
    jobId: string,
    data: EmbedSyncJobData,
  ): Promise<void> {
    // ROK-1762: a retained completed/failed job would turn this add into a
    // silent no-op. Pending jobs never reach here (coalesceOrAdd handled them).
    await clearFinishedJob(this.queue, jobId);
    await this.queue.add('sync-embed', data, {
      jobId,
      delay: COALESCE_DELAY_MS,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
    this.logger.debug(`Enqueued embed sync ${jobId} (reason: ${data.reason})`);
  }
}
