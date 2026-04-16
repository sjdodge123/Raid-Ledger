import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../../events/events.module';
import { UsersModule } from '../../users/users.module';
import { AiModule } from '../../ai/ai.module';
import { SettingsModule } from '../../settings/settings.module';
import { IgdbModule } from '../../igdb/igdb.module';
import { LineupsModule } from '../../lineups/lineups.module';
import { AiChatService } from './ai-chat.service';

/**
 * AI Chat module — provides the AiChatService orchestrator.
 *
 * The AiChatListener (Discord DM/button handler) is NOT registered
 * here to avoid circular file-level imports with DiscordBotModule.
 * It will be wired up separately when live Discord DM support is enabled.
 * Smoke tests use the /admin/test/ai-chat-simulate endpoint instead.
 */
@Module({
  imports: [
    forwardRef(() => EventsModule),
    forwardRef(() => UsersModule),
    AiModule,
    SettingsModule,
    IgdbModule,
    forwardRef(() => LineupsModule),
  ],
  providers: [AiChatService],
  exports: [AiChatService],
})
export class AiChatModule {}
