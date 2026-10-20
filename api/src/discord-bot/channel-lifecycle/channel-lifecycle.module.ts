import { Module, forwardRef } from '@nestjs/common';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { SettingsModule } from '../../settings/settings.module';
import { DiscordBotModule } from '../discord-bot.module';
import { ChannelLifecycleAdminController } from './channel-lifecycle-admin.controller';
import { ChannelLifecycleAdminService } from './channel-lifecycle-admin.service';
import { ChannelLifecycleScheduler } from './channel-lifecycle.scheduler';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import {
  CHANNEL_LIFECYCLE_HUB_LINKER,
  NOOP_HUB_LINKER,
} from './channel-lifecycle.types';

/**
 * ROK-1431 — channel lifecycle automation: the reconciler + its daily cron.
 * The hub-link seam defaults to a no-op until L8 provides the real linker.
 */
@Module({
  imports: [forwardRef(() => DiscordBotModule), SettingsModule, CronJobModule],
  controllers: [ChannelLifecycleAdminController],
  providers: [
    ChannelLifecycleService,
    ChannelLifecycleAdminService,
    ChannelLifecycleScheduler,
    { provide: CHANNEL_LIFECYCLE_HUB_LINKER, useValue: NOOP_HUB_LINKER },
  ],
  exports: [ChannelLifecycleService, ChannelLifecycleScheduler],
})
export class ChannelLifecycleModule {}
