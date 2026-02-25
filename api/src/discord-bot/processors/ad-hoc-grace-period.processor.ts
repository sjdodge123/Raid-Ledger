import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import {
  AD_HOC_GRACE_QUEUE,
  type AdHocGracePeriodJobData,
} from '../queues/ad-hoc-grace-period.queue';

/**
 * BullMQ processor for the ad-hoc grace period queue (ROK-293).
 *
 * When the grace period expires without any members rejoining,
 * this processor finalizes the ad-hoc event (→ "Completed").
 * Follows the EmbedSyncProcessor pattern.
 */
@Processor(AD_HOC_GRACE_QUEUE)
export class AdHocGracePeriodProcessor extends WorkerHost {
  private readonly logger = new Logger(AdHocGracePeriodProcessor.name);

  constructor(private readonly adHocEventService: AdHocEventService) {
    super();
  }

  async process(job: Job<AdHocGracePeriodJobData>): Promise<void> {
    const { eventId } = job.data;

    this.logger.log(
      `Grace period expired for ad-hoc event ${eventId}, finalizing`,
    );

    try {
      await this.adHocEventService.finalizeEvent(eventId);
    } catch (error) {
      this.logger.error(
        `Failed to finalize ad-hoc event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}
