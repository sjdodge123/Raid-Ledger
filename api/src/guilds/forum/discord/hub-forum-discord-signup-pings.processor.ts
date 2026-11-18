import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { QueueHealthService } from '../../../queue/queue-health.service';
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import {
  SIGNUP_PING_QUEUE,
  type SignupPingJobData,
} from './hub-forum-discord-signup-pings.queue';

/** Outcomes that mean "nothing was written yet — try again with backoff". */
const RETRY = new Set(['offline', 'pending']);

/** ROK-2260 — runs one event's debounced signup-ping flush. */
@Processor(SIGNUP_PING_QUEUE)
export class HubForumDiscordSignupPingProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(HubForumDiscordSignupPingProcessor.name);

  constructor(
    @InjectQueue(SIGNUP_PING_QUEUE) private readonly queue: Queue,
    private readonly pings: HubForumDiscordSignupPings,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  /** Registers the queue so `awaitProcessingForTest` drains it. */
  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  /** @throws when the bot is offline or the post is still unsent (retried). */
  async process(job: Job<SignupPingJobData>): Promise<void> {
    const { eventId } = job.data;
    const outcome = await this.pings.flush(eventId);
    if (RETRY.has(outcome)) {
      throw new Error(`Signup pings for event ${eventId}: ${outcome}`);
    }
    this.logger.debug(`Signup pings for event ${eventId}: ${outcome}`);
  }
}
