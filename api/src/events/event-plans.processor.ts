import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { isPerfEnabled, perfLog } from '../common/perf-logger';
import {
  EventPlansService,
  EVENT_PLANS_QUEUE,
  type PollClosedJobData,
} from './event-plans.service';

/**
 * BullMQ processor for event plan poll-close delayed jobs (ROK-392).
 * Fires when a poll's duration expires, then delegates to EventPlansService
 * to determine the winner or trigger a re-poll.
 */
@Processor(EVENT_PLANS_QUEUE)
@Injectable()
export class EventPlansProcessor extends WorkerHost {
  private readonly logger = new Logger(EventPlansProcessor.name);

  constructor(private readonly eventPlansService: EventPlansService) {
    super();
  }

  async process(job: Job<PollClosedJobData>): Promise<void> {
    const { planId } = job.data;
    const start = isPerfEnabled() ? performance.now() : 0;
    this.logger.log(`Processing poll-closed job for plan ${planId}`);

    try {
      await this.eventPlansService.processPollClose(planId);
      if (start)
        perfLog('QUEUE', 'event-plans', performance.now() - start, { planId });
    } catch (error) {
      this.logger.error(
        `Error processing poll-closed for plan ${planId}:`,
        error,
      );
      throw error; // Re-throw so BullMQ retries
    }
  }
}
