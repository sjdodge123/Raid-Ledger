import { Module, forwardRef } from '@nestjs/common';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { SettingsModule } from '../../settings/settings.module';
import { DiscordBotModule } from '../discord-bot.module';
import { ChannelLifecycleAdminController } from './channel-lifecycle-admin.controller';
import { ChannelLifecycleAdminService } from './channel-lifecycle-admin.service';
import { ChannelLifecycleNudgeModule } from './channel-lifecycle.nudge.module';
import { ChannelLifecycleNudgeProcessor } from './channel-lifecycle.nudge.processor';
import { ChannelLifecycleScheduler } from './channel-lifecycle.scheduler';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import { CHANNEL_LIFECYCLE_HUB_LINKER } from './channel-lifecycle.types';
import { HubChannelLinkService } from './hub-channel-link.service';

/**
 * ROK-1428 — channel lifecycle automation: the reconciler + its daily cron
 * (L5), the per-game nudge processor (L5b), the hub auto-linker (L8) and the
 * admin routes (L6).
 */
@Module({
  imports: [
    forwardRef(() => DiscordBotModule),
    SettingsModule,
    CronJobModule,
    ChannelLifecycleNudgeModule,
  ],
  controllers: [ChannelLifecycleAdminController],
  providers: [
    ChannelLifecycleService,
    ChannelLifecycleAdminService,
    ChannelLifecycleScheduler,
    ChannelLifecycleNudgeProcessor,
    HubChannelLinkService,
    {
      provide: CHANNEL_LIFECYCLE_HUB_LINKER,
      useExisting: HubChannelLinkService,
    },
  ],
  exports: [ChannelLifecycleService, ChannelLifecycleScheduler],
})
export class ChannelLifecycleModule {}
