import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  ServiceUnavailableException,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import { AiSuggestionsService } from './ai-suggestions.service';
import { LlmUnavailableError } from './llm-output.helpers';

/**
 * GET /lineups/:id/suggestions — AI-generated nomination suggestions.
 *
 * ROK-1316: serve-stale-while-revalidate. The request thread NEVER awaits
 * the LLM — it returns the cached payload (fresh / stale / `pending` cold)
 * and warms the cache via a background pre-gen job.
 *
 * `?personalize=me` is still accepted (legacy NominateModal sends it) but
 * the per-user LLM path is DELETED — it serves identical base suggestions
 * and emits a `served-from-base` telemetry line.
 *
 * Response statuses:
 *   200 — fresh / stale / pending suggestions (see `cached` / `stale` /
 *         `pending` flags)
 *   404 — lineup missing
 *   409 — lineup not in `building` status
 *   503 — no LLM provider configured (or circuit breaker open)
 */
@Controller('lineups/:id/suggestions')
@UseGuards(AuthGuard('jwt'))
export class AiSuggestionsController {
  constructor(private readonly aiSuggestions: AiSuggestionsService) {}

  @Get()
  async getSuggestions(
    @Param('id', ParseIntPipe) id: number,
    @Query('personalize') personalize: string | undefined,
  ): Promise<AiSuggestionsResponseDto> {
    try {
      return await this.aiSuggestions.getSuggestions(id, {
        personalize: personalize === 'me',
      });
    } catch (err) {
      throw mapLlmError(err);
    }
  }
}

/**
 * Translate LLM-facade errors into 503 so the frontend can render the
 * "AI suggestions unavailable" inline state. All other errors pass
 * through to Nest's default exception filter.
 */
function mapLlmError(err: unknown): unknown {
  if (err instanceof NotFoundException) {
    const message = err.message ?? '';
    if (message.toLowerCase().includes('ai provider')) {
      return new ServiceUnavailableException({
        error: 'AI_PROVIDER_UNAVAILABLE',
      });
    }
  }
  if (err instanceof LlmUnavailableError) {
    return new ServiceUnavailableException({
      error: 'AI_PROVIDER_UNAVAILABLE',
    });
  }
  if (err instanceof Error && err.name === 'CircuitBreakerOpenError') {
    return new ServiceUnavailableException({
      error: 'AI_PROVIDER_UNAVAILABLE',
    });
  }
  return err;
}
