import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { TasteProfileService } from './taste-profile.service';
import { TasteProfileController } from './taste-profile.controller';

@Module({
  imports: [DrizzleModule, CronJobModule],
  controllers: [TasteProfileController],
  providers: [TasteProfileService],
  exports: [TasteProfileService],
})
export class TasteProfileModule {}
