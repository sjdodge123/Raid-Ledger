/**
 * Backfill script for game_taste_vectors (ROK-1082).
 *
 * Bootstraps the full AppModule context, resolves GameTasteService, and
 * invokes aggregateGameVectors() to upsert one row per eligible game.
 * Run once after the migration ships, then rely on the daily cron
 * (GameTasteService_aggregateGameVectors at 06:00 UTC) plus event-driven
 * recomputes via the game-taste-recompute BullMQ queue.
 *
 * Usage:
 *   npm run backfill:game-vectors -w api
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { GameTasteService } from '../src/game-taste/game-taste.service';

dotenv.config();

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const service = app.get(GameTasteService);
    const started = Date.now();
    await service.aggregateGameVectors();
    const elapsed = Date.now() - started;
    console.log(`[backfill-game-vectors] completed in ${elapsed}ms`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-game-vectors] failed:', err);
    process.exit(1);
  });
