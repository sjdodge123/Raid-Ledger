/**
 * ROK-2297 D2 — runs one "copy earlier chat" job (spec Lane D §2–4):
 *  A. make sure both RL threads exist (`syncEventDiscussion` /
 *     `syncPollDiscussion` are idempotent + locked, so a lock-in that fires
 *     before EVENT CREATED still finds the new event's thread), then read them;
 *  B. copy the RL rows in one locked transaction (`copyForumChat`);
 *  C. mirror each new row to Discord in insert order (header first), one at a
 *     time, through the outbound service — never via `HUB_FORUM_CHANGED`.
 * A failed send never stops the rest: its link row stays retryable (S6).
 * A/B errors throw so BullMQ retries; the final failure goes to Sentry.
 */
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import * as Sentry from '@sentry/nestjs';
import type { Job, Queue } from 'bullmq';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { QueueHealthService } from '../../../queue/queue-health.service';
import {
  copyForumChat,
  type ChatCopyResult,
} from '../chat-copy/forum-chat-copy.writes';
import { findLiveEventThread } from '../event-discussion/event-discussion.queries';
import { syncEventDiscussion } from '../event-discussion/event-discussion.sync';
import type { Db } from '../hub-forum.queries';
import { findLivePollThread } from '../subject-discussion/poll-discussion.queries';
import { syncPollDiscussion } from '../subject-discussion/poll-discussion.sync';
import {
  FORUM_CHAT_COPY_QUEUE,
  type ChatCopyJobData,
} from './forum-chat-copy.queue';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';

/** The source and target RL thread ids, or null when either is missing. */
export async function resolveCopyThreads(
  db: Db,
  data: ChatCopyJobData,
): Promise<{ srcThreadId: number; dstThreadId: number } | null> {
  await syncEventDiscussion(db, data.eventId);
  await syncPollDiscussion(db, data.matchId);
  const event = await findLiveEventThread(db, data.eventId);
  const poll = await findLivePollThread(db, data.matchId);
  if (!event || !poll) return null;
  return data.direction === 'event-to-poll'
    ? { srcThreadId: event.id, dstThreadId: poll.id }
    : { srcThreadId: poll.id, dstThreadId: event.id };
}

const isFinalAttempt = (job: Job): boolean =>
  job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

@Processor(FORUM_CHAT_COPY_QUEUE, { concurrency: 1 })
export class ForumChatCopyProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ForumChatCopyProcessor.name);

  constructor(
    @InjectQueue(FORUM_CHAT_COPY_QUEUE) private readonly queue: Queue,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly outbound: HubForumDiscordOutboundService,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  /** Registers the queue so `awaitProcessingForTest` drains it. */
  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<ChatCopyJobData>): Promise<void> {
    let copied: ChatCopyResult | null;
    try {
      const pair = await resolveCopyThreads(this.db, job.data);
      copied = pair && (await copyForumChat(this.db, pair));
    } catch (err) {
      this.logger.error(`Chat copy ${job.id ?? '?'}: ${describe(err)}`);
      if (isFinalAttempt(job)) {
        Sentry.captureException(err, {
          tags: { area: 'forum-chat-copy' },
          extra: { ...job.data },
        });
      }
      throw err;
    }
    if (copied) await this.mirror(copied);
  }

  /** Step C: one awaited send per row, in insert order; failures logged. */
  async mirror(copied: ChatCopyResult): Promise<void> {
    const { guildId, threadId } = copied;
    for (const replyId of copied.replyIds) {
      try {
        await this.outbound.apply({
          guildId,
          op: 'reply.created',
          threadId,
          replyId,
          actorId: 0,
        });
      } catch (err) {
        this.logger.warn(
          `Chat copy send of reply ${replyId}: ${describe(err)}`,
        );
      }
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
