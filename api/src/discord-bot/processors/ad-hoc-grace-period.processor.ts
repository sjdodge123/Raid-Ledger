import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueHealthService } from '../../queue/queue-health.service';
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
export class AdHocGracePeriodProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(AdHocGracePeriodProcessor.name);

  constructor(
    @InjectQueue(AD_HOC_GRACE_QUEUE)
    private readonly queue: Queue,
    private readonly adHocEventService: AdHocEventService,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.queue);
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
