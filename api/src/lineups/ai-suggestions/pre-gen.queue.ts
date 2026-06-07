/**
 * BullMQ producer for AI-suggestions pre-generation (ROK-1316).
 *
 * Serve-stale-while-revalidate: voter-set mutations and cold/stale reads
 * enqueue a DEBOUNCED background job that warms the suggestions cache so
 * the request thread never awaits the 10–62s Gemini round-trip.
 *
 * Debounce is jobId-based (`ai-suggestions-pregen-<lineupId>`): a burst of
 * voter-set changes coalesces to ONE job. Mirrors the
 * `lineup-phase.queue.ts` `removeExisting()` + `add()` delay-reset pattern.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/** Queue name — registered in `queue-registry.ts` ALL_QUEUE_NAMES. */
export const AI_SUGGESTIONS_PREGEN_QUEUE = 'ai-suggestions-pregen';

/** Single job name carried on the queue. */
export const AI_SUGGESTIONS_PREGEN_JOB = 'pregen';

/** Default debounce on voter-set mutations — a voting burst coalesces. */
export const PREGEN_MUTATION_DELAY_MS = 30_000;

/** Short debounce on request-path (cold/stale) enqueues — first visitors
 *  aren't stuck behind the full 30s mutation debounce. */
export const PREGEN_REQUEST_DELAY_MS = 2_000;

export interface AiSuggestionsPreGenJobData {
  lineupId: number;
}

/** Build the jobId used for debounce dedup. */
export function preGenJobId(lineupId: number): string {
  return `ai-suggestions-pregen-${lineupId}`;
}

@Injectable()
export class AiSuggestionsPreGenQueueService {
  private readonly logger = new Logger(AiSuggestionsPreGenQueueService.name);

  constructor(
    @InjectQueue(AI_SUGGESTIONS_PREGEN_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Debounced enqueue. Removes any pending job for this lineup then adds a
   * fresh one with the given delay — so repeated calls during a settle
   * window collapse to a single delayed job (last delay wins).
   */
  async enqueue(
    lineupId: number,
    delayMs: number = PREGEN_MUTATION_DELAY_MS,
  ): Promise<void> {
    const jobId = preGenJobId(lineupId);
    try {
      await this.removeExisting(jobId);
      await this.queue.add(
        AI_SUGGESTIONS_PREGEN_JOB,
        { lineupId } satisfies AiSuggestionsPreGenJobData,
        {
          jobId,
          delay: Math.max(0, delayMs),
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
    } catch (error) {
      // Cache hygiene must never fail a parent mutation or read.
      this.logger.warn(
        `Failed to enqueue pre-gen for lineup ${lineupId}: ${
          error instanceof Error ? error.message : 'Unknown'
        }`,
      );
    }
  }

  /** Remove an existing delayed/waiting job so the debounce delay resets. */
  private async removeExisting(jobId: string): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (!existing) return;
    const state = await existing.getState();
    if (state === 'delayed' || state === 'waiting') {
      await existing.remove();
    }
  }
}
