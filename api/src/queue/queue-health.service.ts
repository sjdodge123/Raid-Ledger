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
   * Poll all registered queues until none have waiting or active jobs.
   * Throws if the timeout expires before all queues are idle.
   */
  async awaitDrained(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = this.pollIntervalMs;

    while (Date.now() < deadline) {
      const statuses = await this.getHealthStatus();
      const busy = statuses.some((s) => s.waiting > 0 || s.active > 0);
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
