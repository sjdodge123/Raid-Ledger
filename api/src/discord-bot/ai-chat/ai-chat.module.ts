import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../../events/events.module';
import { UsersModule } from '../../users/users.module';
import { AiModule } from '../../ai/ai.module';
import { SettingsModule } from '../../settings/settings.module';
import { IgdbModule } from '../../igdb/igdb.module';
import { LineupsModule } from '../../lineups/lineups.module';
import { SchedulingModule } from '../../lineups/scheduling/scheduling.module';
import { AiChatService } from './ai-chat.service';

/**
 * AI Chat module — provides the orchestrator service.
 * The AiChatListener is registered in DiscordBotModule
 * because it needs DiscordBotClientService.
 */
@Module({
  imports: [
    forwardRef(() => EventsModule),
    forwardRef(() => UsersModule),
    AiModule,
    SettingsModule,
    IgdbModule,
    forwardRef(() => LineupsModule),
    forwardRef(() => SchedulingModule),
  ],
  providers: [AiChatService],
  exports: [AiChatService],
})
export class AiChatModule {}
