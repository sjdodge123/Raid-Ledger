import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GameTasteProfileResponseDto,
  GameTasteVectorResponseDto,
  SimilarGameDto,
  SimilarGamesRequestDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { runAggregateGameVectors } from './pipelines/aggregate-game-vectors';
import { findSimilarGames } from './queries/similarity-queries';
import {
  getGameTasteProfile,
  getVectorWithDerivation,
} from './queries/profile-queries';
import {
  GAME_TASTE_RECOMPUTE_QUEUE,
  type GameTasteRecomputeJobData,
} from './game-taste.constants';

/**
 * Service layer for ROK-1082 game taste vectors.
 *
 * Owns the daily aggregate cron, per-game recompute enqueue, and the three
 * controller-facing queries (similarity, public profile, admin derivation).
 */
@Injectable()
export class GameTasteService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
    @InjectQueue(GAME_TASTE_RECOMPUTE_QUEUE)
    private readonly queue: Queue<GameTasteRecomputeJobData>,
  ) {}

  @Cron('0 0 6 * * *', { name: 'GameTasteService_aggregateGameVectors' })
  async aggregateGameVectorsCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'GameTasteService_aggregateGameVectors',
      () => this.aggregateGameVectors(),
    );
  }

  aggregateGameVectors(): Promise<void> {
    return runAggregateGameVectors(this.db);
  }

  findSimilar(
    input: SimilarGamesRequestDto,
    minConfidence?: number,
  ): Promise<SimilarGameDto[]> {
    return findSimilarGames(this.db, input, minConfidence);
  }

  getTasteProfile(gameId: number): Promise<GameTasteProfileResponseDto | null> {
    return getGameTasteProfile(this.db, gameId);
  }

  getVectorWithDerivation(
    gameId: number,
  ): Promise<GameTasteVectorResponseDto | null> {
    return getVectorWithDerivation(this.db, gameId);
  }

  async enqueueRecompute(gameId: number): Promise<void> {
    await this.queue.add(
      'recompute',
      { gameId },
      { jobId: `game-taste-recompute-${gameId}` },
    );
  }
}
