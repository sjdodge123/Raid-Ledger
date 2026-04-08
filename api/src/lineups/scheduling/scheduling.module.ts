/**
 * Scheduling sub-module (ROK-965).
 * Handles schedule poll page, slot suggestions, voting, and event creation.
 */
import { Module, forwardRef } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { EventsModule } from '../../events/events.module';
import { DiscordBotModule } from '../../discord-bot/discord-bot.module';
import { SettingsModule } from '../../settings/settings.module';
import { LineupsModule } from '../lineups.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';

@Module({
  imports: [
    DrizzleModule,
    EventsModule,
    DiscordBotModule,
    SettingsModule,
    forwardRef(() => LineupsModule),
  ],
  controllers: [SchedulingController],
  providers: [SchedulingService, SchedulingPollEmbedService],
  exports: [SchedulingService, SchedulingPollEmbedService],
})
export class SchedulingModule {}
