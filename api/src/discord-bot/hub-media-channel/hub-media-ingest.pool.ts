/**
 * ROK-1941 (Codex P2) — the ONE process-wide gate in front of hub media
 * ingest: every download + sharp job the live listener and the backfill
 * start goes through it, so a burst of large pictures in a bound channel
 * cannot hold more than `limit` image buffers at once.
 *
 * - `droppable` work (live gateway creates) waits in a queue capped at
 *   `queueMax`; beyond that it is refused with a logged warning — a dropped
 *   picture comes back with the next "Import last 3 weeks".
 * - `essential` work (edits, deletes, backfill posts) always queues: an edit
 *   or delete that removes a picture is never replayed by backfill, so it must
 *   not be lost; a backfill submits one post at a time per hub.
 *
 * FIFO, so a delete queued behind a create of the same message starts after it.
 */
import { Logger } from '@nestjs/common';

export const DEFAULT_INGEST_CONCURRENCY = 2;
export const DEFAULT_INGEST_QUEUE_MAX = 50;
/** Upper bounds an env override cannot exceed (image buffers are large). */
export const MAX_INGEST_CONCURRENCY = 8;
export const MAX_INGEST_QUEUE_MAX = 500;

export interface IngestPoolLimits {
  /** Max tasks in flight at once (`HUB_MEDIA_INGEST_CONCURRENCY`). */
  limit: number;
  /** Max droppable tasks waiting (`HUB_MEDIA_INGEST_QUEUE_MAX`). */
  queueMax: number;
}

export type IngestPriority = 'droppable' | 'essential';

/** Thrown to a droppable task refused because the queue is full. */
export class HubMediaIngestQueueFullError extends Error {
  constructor(readonly label: string) {
    super(`hub media ingest queue full; dropped ${label}`);
  }
}

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** The pool's limits from the environment (positive ints, else defaults; clamped to the MAX_* bounds). */
export function readIngestPoolLimits(
  env: Record<string, string | undefined> = process.env,
): IngestPoolLimits {
  return {
    limit: Math.min(
      positiveInt(env.HUB_MEDIA_INGEST_CONCURRENCY, DEFAULT_INGEST_CONCURRENCY),
      MAX_INGEST_CONCURRENCY,
    ),
    queueMax: Math.min(
      positiveInt(env.HUB_MEDIA_INGEST_QUEUE_MAX, DEFAULT_INGEST_QUEUE_MAX),
      MAX_INGEST_QUEUE_MAX,
    ),
  };
}

interface Waiter {
  priority: IngestPriority;
  start: () => void;
}

/** A bounded FIFO worker pool (one Nest singleton per process). */
export class HubMediaIngestPool {
  private readonly logger = new Logger(HubMediaIngestPool.name);
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(private readonly limits: IngestPoolLimits) {}

  /** Tasks currently running (specs, diagnostics). */
  inFlight(): number {
    return this.active;
  }

  /**
   * Run `work` once a slot is free. A droppable task meeting a full queue
   * rejects with `HubMediaIngestQueueFullError` (already logged).
   */
  async run<T>(
    label: string,
    work: () => Promise<T>,
    priority: IngestPriority = 'droppable',
  ): Promise<T> {
    await this.acquire(label, priority);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(label: string, priority: IngestPriority): Promise<void> {
    if (this.active < this.limits.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (
      priority === 'droppable' &&
      this.droppableWaiting() >= this.limits.queueMax
    ) {
      this.logger.warn(
        `hub media ingest queue full (${this.limits.queueMax}); dropped ${label}`,
      );
      return Promise.reject(new HubMediaIngestQueueFullError(label));
    }
    return new Promise((start) => this.waiting.push({ priority, start }));
  }

  /** Hand the slot straight to the next waiter, else free it. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) next.start();
    else this.active -= 1;
  }

  private droppableWaiting(): number {
    return this.waiting.filter((w) => w.priority === 'droppable').length;
  }
}
