import {
  ConflictException,
  Inject,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { QueueHealthService } from '../../queue/queue-health.service';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import {
  CHANNEL_LIFECYCLE_NUDGE_QUEUE,
  type GameActivityNudgeJobData,
} from './channel-lifecycle.nudge';

/** The slice of a BullMQ job the processor reads. */
export type NudgeJob = Pick<
  Job<GameActivityNudgeJobData>,
  'data' | 'attemptsMade' | 'opts'
>;

/** True when this run is the job's last allowed attempt. */
export function isFinalAttempt(
  job: Pick<NudgeJob, 'attemptsMade' | 'opts'>,
): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/**
 * Worker for the per-game nudge (ROK-1431 D12, §2.9). Runs a single-game,
 * non-dry reconcile. A held advisory lock (409) is skipped — the daily run
 * catches it. A disabled setting makes `reconcile` itself a no-op. Other
 * failures are logged every attempt, Sentry-captured once (final attempt),
 * and rethrown so BullMQ retries (≤ 2 attempts).
 */
@Processor(CHANNEL_LIFECYCLE_NUDGE_QUEUE)
export class ChannelLifecycleNudgeProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(ChannelLifecycleNudgeProcessor.name);

  constructor(
    @InjectQueue(CHANNEL_LIFECYCLE_NUDGE_QUEUE) private readonly queue: Queue,
    private readonly lifecycle: ChannelLifecycleService,
    @Inject(QueueHealthService)
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  /** Reconcile the nudged game's channel. */
  async process(job: NudgeJob): Promise<void> {
    const { gameId } = job.data;
    try {
      await this.lifecycle.reconcile({
        dryRun: false,
        trigger: 'nudge',
        gameIds: [gameId],
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.debug(`Nudge for game ${gameId} skipped: reconcile busy`);
        return;
      }
      this.logger.error(
        `Channel lifecycle nudge failed for game ${gameId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (isFinalAttempt(job)) {
        Sentry.captureException(err, {
          tags: { area: 'channel-lifecycle-nudge' },
          extra: { gameId },
        });
      }
      throw err;
    }
  }
}
