import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import { QueueHealthService } from '../../queue/queue-health.service';
import { EphemeralVoiceService } from '../services/ephemeral-voice.service';
import {
  EPHEMERAL_VOICE_IDLE_QUEUE,
  type EphemeralVoiceIdleJobData,
} from '../queues/ephemeral-voice-idle.queue';

/**
 * BullMQ worker for the ephemeral-voice idle-delete queue (ROK-1352).
 *
 * The job fires `idleMinutes` after the channel went empty post-event. The
 * service re-checks occupancy immediately before delete, so a rejoin that
 * missed cancellation still cannot delete an occupied channel.
 */
@Processor(EPHEMERAL_VOICE_IDLE_QUEUE)
export class EphemeralVoiceIdleProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(EphemeralVoiceIdleProcessor.name);

  constructor(
    @InjectQueue(EPHEMERAL_VOICE_IDLE_QUEUE) private readonly queue: Queue,
    private readonly ephemeralVoice: EphemeralVoiceService,
    @Inject(QueueHealthService)
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<EphemeralVoiceIdleJobData>): Promise<void> {
    const { eventId, channelId } = job.data;
    this.logger.log(
      `Ephemeral idle-delete fired for event ${eventId} (channel ${channelId})`,
    );
    try {
      await this.ephemeralVoice.destroyById(eventId);
    } catch (err) {
      // Fire-and-forget: swallow so a transient failure doesn't wedge the
      // worker; the reaper cron is the safety net for any missed teardown.
      this.logger.error(
        `Ephemeral idle-delete failed for event ${eventId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
      Sentry.captureException(err, {
        tags: { context: 'ephemeral-voice-idle-processor' },
      });
    }
  }
}
