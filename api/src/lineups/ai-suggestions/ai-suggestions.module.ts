import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { AiModule } from '../../ai/ai.module';
import { GameTasteModule } from '../../game-taste/game-taste.module';
import { SettingsModule } from '../../settings/settings.module';
import { AiSuggestionsService } from './ai-suggestions.service';
import { AiSuggestionsController } from './ai-suggestions.controller';
import { AiSuggestionsCacheInvalidator } from './cache.helpers';

/**
 * AI nomination suggestions for Community Lineup (ROK-931).
 *
 * Mounted under `LineupsModule`. Exports `AiSuggestionsCacheInvalidator`
 * so `LineupsService` can drop stale cache rows after nominate /
 * invitee changes without pulling in the full orchestration service.
 */
@Module({
  imports: [DrizzleModule, AiModule, GameTasteModule, SettingsModule],
  controllers: [AiSuggestionsController],
  providers: [AiSuggestionsService, AiSuggestionsCacheInvalidator],
  exports: [AiSuggestionsCacheInvalidator],
})
export class AiSuggestionsModule {}
