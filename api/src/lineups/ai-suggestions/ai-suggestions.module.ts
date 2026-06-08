import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { AiModule } from '../../ai/ai.module';
import { GameTasteModule } from '../../game-taste/game-taste.module';
import { SettingsModule } from '../../settings/settings.module';
import { AiSuggestionsService } from './ai-suggestions.service';
import { AiSuggestionsController } from './ai-suggestions.controller';
import { AiSuggestionsCacheInvalidator } from './cache.helpers';
import {
  AI_SUGGESTIONS_PREGEN_QUEUE,
  AiSuggestionsPreGenQueueService,
} from './pre-gen.queue';
import { AiSuggestionsPreGenProcessor } from './pre-gen.processor';

/**
 * AI nomination suggestions for Community Lineup (ROK-931).
 *
 * Mounted under `LineupsModule`. ROK-1316: serve-stale-while-revalidate —
 * the request thread never blocks on the LLM. A debounced BullMQ pre-gen
 * queue warms the cache in the background; `AiSuggestionsCacheInvalidator`
 * (exported) lets `LineupsService` enqueue that job after voter-set
 * mutations without pulling in the full orchestration service.
 */
@Module({
  imports: [
    DrizzleModule,
    AiModule,
    GameTasteModule,
    SettingsModule,
    BullModule.registerQueue({ name: AI_SUGGESTIONS_PREGEN_QUEUE }),
  ],
  controllers: [AiSuggestionsController],
  providers: [
    AiSuggestionsService,
    AiSuggestionsCacheInvalidator,
    AiSuggestionsPreGenQueueService,
    AiSuggestionsPreGenProcessor,
  ],
  exports: [AiSuggestionsCacheInvalidator],
})
export class AiSuggestionsModule {}
