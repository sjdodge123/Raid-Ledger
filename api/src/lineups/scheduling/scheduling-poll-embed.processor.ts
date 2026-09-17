/**
 * BullMQ worker for the scheduling-poll embed sync queue (ROK-1549 S1-AC2).
 *
 * Runs the card re-render and RETHROWS so BullMQ retries with backoff. Every
 * failed attempt leaves a Sentry breadcrumb; only the final one is captured.
 * A deleted card (Discord 10008) is terminal — retrying cannot bring it back.
 */
import { Logger, type OnModuleInit } from '@nestjs/common';
import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import * as Sentry from '@sentry/node';
import { QueueHealthService } from '../../queue/queue-health.service';
import { isUnknownMessage } from '../../discord-bot/discord-bot-client.messages.helpers';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import {
  SCHEDULING_POLL_EMBED_QUEUE,
  type SchedulingPollEmbedJobData,
} from './scheduling-poll-embed.queue';

@Processor(SCHEDULING_POLL_EMBED_QUEUE)
export class SchedulingPollEmbedProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(SchedulingPollEmbedProcessor.name);

  constructor(
    @InjectQueue(SCHEDULING_POLL_EMBED_QUEUE) private readonly queue: Queue,
    private readonly pollEmbed: SchedulingPollEmbedService,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  /** Registers the queue so `awaitProcessingForTest` drains it. */
  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  /**
   * Re-render one poll card.
   *
   * @param job - The sync job for a match.
   * @throws The render / edit failure (retried), or `UnrecoverableError`
   * when the card was deleted in Discord.
   */
  async process(job: Job<SchedulingPollEmbedJobData>): Promise<void> {
    const { matchId } = job.data;
    try {
      await this.pollEmbed.syncEmbed(matchId);
    } catch (err) {
      if (!isUnknownMessage(err)) throw err;
      this.logger.warn(
        `Scheduling poll card for match ${matchId} was deleted in Discord; not retrying`,
      );
      throw new UnrecoverableError(
        `Scheduling poll card for match ${matchId} no longer exists`,
      );
    }
  }

  /**
   * Surface a failed attempt: breadcrumb always, capture on the last one.
   *
   * @param job - The failed job (BullMQ may pass undefined).
   * @param err - The failure.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<SchedulingPollEmbedJobData> | undefined, err: Error): void {
    const matchId = job?.data.matchId;
    const attempt = job?.attemptsMade ?? 0;
    this.logger.warn(
      `Scheduling poll embed sync failed for match ${matchId} (attempt ${attempt}): ${err.message}`,
    );
    Sentry.addBreadcrumb({
      category: 'scheduling-poll-embed',
      level: 'warning',
      message: err.message,
      data: { matchId, attempt },
    });
    if (err instanceof UnrecoverableError) return;
    if (attempt >= (job?.opts.attempts ?? 1)) {
      Sentry.captureException(err, {
        tags: { context: 'scheduling-poll-embed' },
        extra: { matchId },
      });
    }
  }
}
