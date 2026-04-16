import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../../events/events.module';
import { UsersModule } from '../../users/users.module';
import { AiModule } from '../../ai/ai.module';
import { SettingsModule } from '../../settings/settings.module';
import { IgdbModule } from '../../igdb/igdb.module';
import { LineupsModule } from '../../lineups/lineups.module';
import { SchedulingModule } from '../../lineups/scheduling/scheduling.module';
import { DiscordBotModule } from '../discord-bot.module';
import { AiChatService } from './ai-chat.service';
import { AiChatListener } from './ai-chat.listener';

/**
 * AI Chat module — registered in AppModule (NOT DiscordBotModule)
 * to avoid file-level circular imports.
 *
 * Imports DiscordBotModule via forwardRef to access
 * DiscordBotClientService for the listener.
 */
@Module({
  imports: [
    forwardRef(() => EventsModule),
    forwardRef(() => UsersModule),
    forwardRef(() => DiscordBotModule),
    AiModule,
    SettingsModule,
    IgdbModule,
    forwardRef(() => LineupsModule),
    forwardRef(() => SchedulingModule),
  ],
  providers: [AiChatService, AiChatListener],
  exports: [AiChatService],
})
export class AiChatModule {}
