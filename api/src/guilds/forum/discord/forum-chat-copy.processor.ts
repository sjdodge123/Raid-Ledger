/**
 * ROK-2297 D2 — runs one "copy earlier chat" job (spec Lane D §2–4):
 *  A. make sure both RL threads exist (`syncEventDiscussion` /
 *     `syncPollDiscussion` are idempotent + locked, so a lock-in that fires
 *     before EVENT CREATED still finds the new event's thread), then read them;
 *  B. copy the RL rows in one locked transaction (`copyForumChat`);
 *  C. mirror each new row to Discord in insert order (header first), one at a
 *     time, through the outbound service — never via `HUB_FORUM_CHANGED`.
 *     When B writes nothing because the pair was already copied (a retry
 *     after B committed), C re-drives that existing copy: rows already
 *     linked send nothing again (the link claim is ON CONFLICT DO NOTHING).
 * A failed send never stops the rest; once every row was tried, the failures
 * throw together so BullMQ retries (the retry re-drives the existing copy).
 * Errors in any step throw for that retry; the final failure goes to Sentry.
 */
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import * as Sentry from '@sentry/nestjs';
import type { Job, Queue } from 'bullmq';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { QueueHealthService } from '../../../queue/queue-health.service';
import { findChatCopy } from '../chat-copy/forum-chat-copy.queries';
import { sameHub } from '../chat-copy/forum-chat-copy.rules';
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

const resolveLogger = new Logger('ForumChatCopyThreads');

/**
 * The source and target RL thread ids, or null when either is missing or
 * the two live in different hubs (an event retagged mid-poll — Codex P1).
 */
export async function resolveCopyThreads(
  db: Db,
  data: ChatCopyJobData,
): Promise<{ srcThreadId: number; dstThreadId: number } | null> {
  await syncEventDiscussion(db, data.eventId);
  await syncPollDiscussion(db, data.matchId);
  const event = await findLiveEventThread(db, data.eventId);
  const poll = await findLivePollThread(db, data.matchId);
  if (!event || !poll) return null;
  if (!sameHub(event, poll)) {
    resolveLogger.log(
      `Chat copy skipped: event ${data.eventId} (hub ${event.guildId}) and match ${data.matchId} (hub ${poll.guildId}) are in different hubs`,
    );
    return null;
  }
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
    const copied = await this.step(job, () => this.copy(job.data));
    if (copied) await this.step(job, () => this.mirror(copied));
  }

  /** Steps A + B; a pair already copied re-reads its rows for step C. */
  private async copy(data: ChatCopyJobData): Promise<ChatCopyResult | null> {
    const pair = await resolveCopyThreads(this.db, data);
    if (!pair) return null;
    return (
      (await copyForumChat(this.db, pair)) ??
      (await findChatCopy(this.db, pair))
    );
  }

  /** Runs a step; an error is logged, sent to Sentry on the final attempt and rethrown. */
  private async step<T>(job: Job<ChatCopyJobData>, run: () => Promise<T>) {
    try {
      return await run();
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
  }

  /**
   * Step C: one awaited send per row, in insert order. A failed send never
   * stops the rest; failures are collected and thrown together afterwards so
   * BullMQ retries (Codex P2) — the retry re-drives the existing copy and
   * already-linked rows send nothing again.
   */
  async mirror(copied: ChatCopyResult): Promise<void> {
    const { guildId, threadId } = copied;
    const failed: number[] = [];
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
        failed.push(replyId);
      }
    }
    if (failed.length > 0) {
      throw new Error(
        `Discord send failed for ${failed.length} of ${copied.replyIds.length} copied replies (${failed.join(', ')})`,
      );
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
