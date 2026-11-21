import { Module, forwardRef } from '@nestjs/common';
import { CronJobModule } from '../../../cron-jobs/cron-job.module';
import { DiscordBotModule } from '../../../discord-bot/discord-bot.module';
import { SettingsModule } from '../../../settings/settings.module';
import { SigninReminderCron } from './signin-reminder.cron';
import { SigninReminderService } from './signin-reminder.service';

/**
 * ROK-2284 — Core's sign-in reminder DMs: the hourly cron and the send pass.
 * Layer 3 adds the "Don't remind me again" listener and the DEMO trigger.
 */
@Module({
  imports: [SettingsModule, CronJobModule, forwardRef(() => DiscordBotModule)],
  providers: [SigninReminderService, SigninReminderCron],
  exports: [SigninReminderService],
})
export class SigninReminderModule {}
