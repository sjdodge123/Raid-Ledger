import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface QueueHealthStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Queues whose `delayed` jobs should be treated as busy by `awaitDrained`.
 *
 * Most queues (bench-promotion, departure-grace, etc.) schedule jobs minutes
 * or hours into the future as part of normal business logic — counting their
 * delayed jobs would make awaitDrained block indefinitely. The only queues
 * here are those using short-window *coalescing* delays where the test must
 * wait for the in-flight job to actually fire. (ROK-1196.)
 */
const SHORT_COALESCE_QUEUES = new Set<string>(['discord-embed-sync']);

/** A queue is busy if it has waiting/active jobs, or delayed jobs in a
 * short-coalesce queue. Long-lived delayed jobs (e.g. bench-promotion
 * 5-minute scheduled promotions) are never considered busy. */
function isQueueBusy(status: QueueHealthStatus): boolean {
  if (status.waiting > 0 || status.active > 0) return true;
  if (status.delayed > 0 && SHORT_COALESCE_QUEUES.has(status.name)) return true;
  return false;
}

@Injectable()
export class QueueHealthService {
  private readonly queues = new Map<string, Queue>();
  private readonly pollIntervalMs: number;

  constructor() {
    const parsed = parseInt(process.env.QUEUE_POLL_INTERVAL_MS ?? '500', 10);
    this.pollIntervalMs = Number.isNaN(parsed) ? 500 : parsed;
  }

  /**
   * Register a queue for health monitoring.
   * Called by processors during onModuleInit.
   */
  register(queue: Queue): void {
    this.queues.set(queue.name, queue);
  }

  /** Collect job counts for all registered queues. */
  async getHealthStatus(): Promise<QueueHealthStatus[]> {
    const results: QueueHealthStatus[] = [];

    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );
      results.push({
        name,
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed,
      });
    }

    return results;
  }

  /** Drain (remove waiting jobs from) all registered queues. */
  async drainAll(): Promise<void> {
    for (const [, queue] of this.queues) {
      await queue.drain();
    }
  }

  /**
   * Poll all registered queues until none have waiting/active jobs (and no
   * delayed jobs in short-coalesce queues — see `SHORT_COALESCE_QUEUES`).
   * Throws if the timeout expires before all queues are idle.
   */
  async awaitDrained(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = this.pollIntervalMs;

    while (Date.now() < deadline) {
      const statuses = await this.getHealthStatus();
      const busy = statuses.some((s) => isQueueBusy(s));
      if (!busy) return;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((r) =>
        setTimeout(r, Math.min(pollInterval, remaining)),
      );
    }

    throw new Error(
      `awaitDrained timed out after ${timeoutMs}ms — queues still have pending jobs`,
    );
  }
}
