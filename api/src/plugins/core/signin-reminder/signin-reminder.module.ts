import { Module, forwardRef } from '@nestjs/common';
import { CronJobModule } from '../../../cron-jobs/cron-job.module';
import { DiscordBotModule } from '../../../discord-bot/discord-bot.module';
import { SettingsModule } from '../../../settings/settings.module';
import { SigninReminderSettingsController } from './signin-reminder-settings.controller';
import { DemoTestSigninReminderController } from '../../../admin/demo-test-signin-reminder.controller';
import { SigninReminderCron } from './signin-reminder.cron';
import { SigninReminderInteractionListener } from './signin-reminder-interaction.listener';
import { SigninReminderService } from './signin-reminder.service';

/**
 * ROK-2284 — Core's sign-in reminder DMs: the hourly cron, the send pass,
 * the "Don't remind me again" button listener and the DEMO_MODE fixture
 * (`/admin/test/signin-reminder/*`).
 */
@Module({
  imports: [SettingsModule, CronJobModule, forwardRef(() => DiscordBotModule)],
  controllers: [SigninReminderSettingsController],
  controllers: [DemoTestSigninReminderController],
  providers: [
    SigninReminderService,
    SigninReminderCron,
    SigninReminderInteractionListener,
  ],
  exports: [SigninReminderService],
})
export class SigninReminderModule {}
