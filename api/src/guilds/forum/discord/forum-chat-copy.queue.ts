/**
 * ROK-2297 D2 — "copy earlier chat" runs as ONE BullMQ job per source →
 * target pair, off the poll/event flow (D-5): the emit only enqueues. The
 * job id dedups a repeated trigger; BullMQ forbids `:` in custom ids, so the
 * spec's `chat-copy:<kind>:…` shape is spelled with dashes.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

export const FORUM_CHAT_COPY_QUEUE = 'hub-forum-chat-copy';

/** Which way the chat moves. */
export type ChatCopyDirection = 'event-to-poll' | 'poll-to-event';

/** Payload of a copy job. */
export interface ChatCopyJobData {
  direction: ChatCopyDirection;
  matchId: number;
  eventId: number;
}

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: 50,
} as const;

/** The dedup id of one pair's copy job. */
export function chatCopyJobId(data: ChatCopyJobData): string {
  return `forum-chat-copy-${data.direction}-${data.matchId}-${data.eventId}`;
}

@Injectable()
export class ForumChatCopyQueue {
  private readonly logger = new Logger(ForumChatCopyQueue.name);

  constructor(
    @InjectQueue(FORUM_CHAT_COPY_QUEUE) private readonly queue: Queue,
  ) {}

  /** Enqueue one copy; never throws into the emitter (false = not queued). */
  async enqueue(data: ChatCopyJobData): Promise<boolean> {
    const jobId = chatCopyJobId(data);
    try {
      await this.queue.add('copy-chat', data, { ...JOB_OPTIONS, jobId });
      return true;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Chat copy ${jobId} not queued: ${why}`);
      return false;
    }
  }
}
