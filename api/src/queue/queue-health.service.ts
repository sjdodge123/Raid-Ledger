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

  /**
   * Register a queue for health monitoring.
   * Called by processors during onModuleInit.
   */
  register(queue: Queue): void {
    this.queues.set(queue.name, queue);
  }

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
}
