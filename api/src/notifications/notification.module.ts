import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { EventReminderService } from './event-reminder.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';

@Module({
  imports: [DrizzleModule, CronJobModule],
  controllers: [NotificationController],
  providers: [NotificationService, EventReminderService],
  exports: [NotificationService],
})
export class NotificationModule {}
