import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { GameTasteService } from './game-taste.service';
import { GameTasteController } from './game-taste.controller';
import { GameTastePublicController } from './game-taste-public.controller';
import { GameTasteRecomputeProcessor } from './processors/game-taste-recompute.processor';
import { GAME_TASTE_RECOMPUTE_QUEUE } from './game-taste.constants';

@Module({
  imports: [
    DrizzleModule,
    CronJobModule,
    BullModule.registerQueue({ name: GAME_TASTE_RECOMPUTE_QUEUE }),
  ],
  controllers: [GameTasteController, GameTastePublicController],
  providers: [GameTasteService, GameTasteRecomputeProcessor],
  exports: [GameTasteService],
})
export class GameTasteModule {}
