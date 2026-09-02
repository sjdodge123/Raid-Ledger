/**
 * LFG intents module (ROK-1451) — "I want to play this game".
 */
import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { LfgController } from './lfg.controller';
import { LfgService } from './lfg.service';
import { LfgSignupListener } from './lfg-signup.listener';
import { LfgExpiryService } from './lfg-expiry.service';
import { LfgQuickPlayListener } from './lfg-quickplay.listener';

@Module({
  imports: [DrizzleModule, CronJobModule],
  controllers: [LfgController],
  providers: [
    LfgService,
    LfgSignupListener,
    LfgQuickPlayListener,
    LfgExpiryService,
  ],
  exports: [LfgService],
})
export class LfgModule {}
