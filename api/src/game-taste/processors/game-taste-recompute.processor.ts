import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { QueueHealthService } from '../../queue/queue-health.service';
import { recomputeGameVector } from '../pipelines/aggregate-game-vectors';
import {
  GAME_TASTE_RECOMPUTE_QUEUE,
  type GameTasteRecomputeJobData,
} from '../game-taste.constants';

/**
 * BullMQ processor for ROK-1082 event-driven recompute.
 * Jobs are deduped at enqueue time via `jobId: game-taste-recompute-<gameId>`.
 */
@Processor(GAME_TASTE_RECOMPUTE_QUEUE)
export class GameTasteRecomputeProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(GameTasteRecomputeProcessor.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @InjectQueue(GAME_TASTE_RECOMPUTE_QUEUE)
    private readonly queue: Queue<GameTasteRecomputeJobData>,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<GameTasteRecomputeJobData>): Promise<void> {
    const { gameId } = job.data;
    this.logger.log(`Recomputing taste vector for game ${gameId}`);
    await recomputeGameVector(this.db, gameId);
  }
}
