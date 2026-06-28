import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const EPHEMERAL_VOICE_IDLE_QUEUE = 'ephemeral-voice-idle';

export interface EphemeralVoiceIdleJobData {
  eventId: number;
  channelId: string;
}

/**
 * Producer for the ephemeral-voice idle-delete queue (ROK-1352).
 *
 * Enqueued when an ephemeral channel goes empty post-event; cancelled when
 * someone rejoins before expiry. Mirrors `DepartureGraceQueueService`.
 */
@Injectable()
export class EphemeralVoiceIdleQueueService {
  private readonly logger = new Logger(EphemeralVoiceIdleQueueService.name);

  constructor(
    @InjectQueue(EPHEMERAL_VOICE_IDLE_QUEUE) private readonly queue: Queue,
  ) {}

  /** Schedule an idle-delete for an event's ephemeral channel. Replaces any pending job. */
  async enqueue(
    data: EphemeralVoiceIdleJobData,
    delayMs: number,
  ): Promise<void> {
    const jobId = `ephemeral-idle-${data.eventId}`;
    try {
      await this.removeIfPending(jobId);
      await this.queue.add('ephemeral-idle-expire', data, {
        jobId,
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      });
      this.logger.debug(
        `Enqueued ephemeral idle-delete for event ${data.eventId} (delay ${Math.round(delayMs / 1000)}s)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ephemeral idle-delete for event ${data.eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /** Cancel a pending idle-delete (someone rejoined the channel). */
  async cancel(eventId: number): Promise<void> {
    try {
      await this.removeIfPending(`ephemeral-idle-${eventId}`);
    } catch (error) {
      this.logger.error(
        `Failed to cancel ephemeral idle-delete for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async removeIfPending(jobId: string): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (!existing) return;
    const state = await existing.getState();
    if (state === 'delayed' || state === 'waiting') await existing.remove();
  }
}
