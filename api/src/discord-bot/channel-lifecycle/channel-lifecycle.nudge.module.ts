import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../../settings/settings.module';
import {
  CHANNEL_LIFECYCLE_NUDGE_QUEUE,
  GameActivityNudge,
} from './channel-lifecycle.nudge';

/**
 * ROK-1431 D12 — the nudge producer, global so the events / lineups / poll
 * services can `@Optional()` inject it without importing the Discord graph.
 * Imported once by `ChannelLifecycleModule`, which also hosts the processor.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: CHANNEL_LIFECYCLE_NUDGE_QUEUE }),
    SettingsModule,
  ],
  providers: [GameActivityNudge],
  exports: [GameActivityNudge, BullModule],
})
export class ChannelLifecycleNudgeModule {}
