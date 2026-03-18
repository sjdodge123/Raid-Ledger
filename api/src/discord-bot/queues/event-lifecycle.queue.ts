import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { EventPayload } from '../listeners/event.listener';

export const EVENT_LIFECYCLE_QUEUE = 'event-lifecycle';

export interface EventLifecycleJobData {
  eventId: number;
  payload: EventPayload;
}

/**
 * Producer service for the event-lifecycle BullMQ queue (ROK-858).
 *
 * Enqueues event creation work (Discord scheduled event, embed posting,
 * game affinity notifications) so the HTTP response returns immediately.
 * Uses a deterministic jobId to prevent duplicate jobs for the same event.
 */
@Injectable()
export class EventLifecycleQueueService {
  private readonly logger = new Logger(EventLifecycleQueueService.name);

  constructor(
    @InjectQueue(EVENT_LIFECYCLE_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Enqueue an event-created lifecycle job.
   * Uses a deterministic jobId to prevent duplicate jobs for the same event.
   */
  async enqueue(eventId: number, payload: EventPayload): Promise<void> {
    const jobId = `event-created-${eventId}`;
    try {
      await this.queue.add(
        'event-created',
        { eventId, payload } satisfies EventLifecycleJobData,
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      this.logger.debug(`Enqueued event lifecycle job for event ${eventId}`);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue event lifecycle job for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
