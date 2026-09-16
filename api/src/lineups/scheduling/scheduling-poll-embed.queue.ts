/**
 * Producer for the scheduling-poll embed sync queue (ROK-1549 S1-AC1/AC2).
 *
 * Every vote / suggestion / lifecycle change used to re-render the Discord
 * poll card inline (`void updateEmbed().catch(logger.error)`): a burst of N
 * votes meant N edits and a failure was logged and forgotten. This producer
 * coalesces those calls into ONE delayed BullMQ job per match; the processor
 * retries with backoff and surfaces the final failure to Sentry.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as Sentry from '@sentry/node';

export const SCHEDULING_POLL_EMBED_QUEUE = 'scheduling-poll-embed-sync';

/** Coalescing window — at most one card edit per match per window. */
export const SCHEDULING_POLL_EMBED_COALESCE_MS = 2_000;

/** Payload of a scheduling-poll embed sync job. */
export interface SchedulingPollEmbedJobData {
  matchId: number;
}

/** Retry policy for a sync job (S1-AC2). */
const JOB_OPTIONS = {
  delay: SCHEDULING_POLL_EMBED_COALESCE_MS,
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: 50,
} as const;

/** What an existing job id means for a new enqueue. */
type SlotOutcome = 'coalesced' | 'busy' | 'free';

/**
 * Custom job id for a match's sync job. Uses `-`, never `:` — BullMQ rejects
 * `:` in custom ids (the ROK-1512 incident).
 *
 * @param matchId - The poll's match id.
 * @param trail - The trailing job queued behind an already-running one.
 * @returns The BullMQ job id.
 */
export function schedulingPollEmbedJobId(
  matchId: number,
  trail = false,
): string {
  return `sched-poll-embed-${matchId}${trail ? '-trail' : ''}`;
}

@Injectable()
export class SchedulingPollEmbedQueueService {
  private readonly logger = new Logger(SchedulingPollEmbedQueueService.name);

  constructor(
    @InjectQueue(SCHEDULING_POLL_EMBED_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Enqueue a coalesced card re-render for a match.
   *
   * A delayed job gets its timer reset. A job that is already active/waiting
   * may have read the DB before this change landed, so a trailing job is
   * queued (coalesced the same way) — the last vote of a burst is never lost.
   * Never throws: a Redis failure is warned + reported, not pushed into the
   * vote request.
   *
   * @param matchId - The poll's match id.
   */
  async enqueue(matchId: number): Promise<void> {
    try {
      const primary = schedulingPollEmbedJobId(matchId);
      const outcome = await this.coalesce(primary);
      if (outcome === 'free') return await this.add(primary, matchId);
      if (outcome === 'coalesced') return;
      const trail = schedulingPollEmbedJobId(matchId, true);
      if ((await this.coalesce(trail)) === 'free') {
        await this.add(trail, matchId);
      }
    } catch (err) {
      this.reportEnqueueFailure(matchId, err);
    }
  }

  /** Fold into an existing job when possible; clear a finished one. */
  private async coalesce(jobId: string): Promise<SlotOutcome> {
    const job = await this.queue.getJob(jobId);
    if (!job) return 'free';
    const state = await job.getState();
    if (state === 'delayed') {
      await job.changeDelay(SCHEDULING_POLL_EMBED_COALESCE_MS);
      return 'coalesced';
    }
    if (state === 'completed' || state === 'failed') {
      // A retained job would make `add` a silent no-op on the same id.
      await job.remove();
      return 'free';
    }
    return 'busy';
  }

  private async add(jobId: string, matchId: number): Promise<void> {
    await this.queue.add(
      'sync-poll-embed',
      { matchId } satisfies SchedulingPollEmbedJobData,
      { ...JOB_OPTIONS, jobId },
    );
  }

  private reportEnqueueFailure(matchId: number, err: unknown): void {
    this.logger.warn(
      `Failed to enqueue scheduling poll embed sync for match ${matchId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    Sentry.captureException(err, {
      tags: { context: 'scheduling-poll-embed-enqueue' },
      extra: { matchId },
    });
  }
}
