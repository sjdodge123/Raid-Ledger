import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import { AiSuggestionsService } from './ai-suggestions.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string };
}

/**
 * GET /lineups/:id/suggestions — AI-generated nomination suggestions.
 *
 * `?personalize=me` narrows the voter set to the requesting user so
 * the LLM tailors suggestions to their individual taste vector.
 * Otherwise the server uses the lineup's invitee/nominator set (private
 * lineup → invitees, public → distinct nominators, fallback → recent
 * active community per architect Decision A).
 *
 * Response statuses:
 *   200 — fresh or cached suggestions (see `cached` flag)
 *   404 — lineup missing
 *   409 — lineup not in `building` status
 *   503 — no LLM provider configured (or circuit breaker open)
 */
@Controller('lineups/:id/suggestions')
@UseGuards(AuthGuard('jwt'))
export class AiSuggestionsController {
  constructor(
    private readonly aiSuggestions: AiSuggestionsService,
  ) {}

  @Get()
  async getSuggestions(
    @Param('id', ParseIntPipe) id: number,
    @Query('personalize') personalize: string | undefined,
    @Req() req: AuthRequest,
  ): Promise<AiSuggestionsResponseDto> {
    const personalizeUserId =
      personalize === 'me' ? req.user.id : undefined;
    try {
      return await this.aiSuggestions.getSuggestions(id, {
        personalizeUserId,
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
  if (
    err instanceof Error &&
    err.name === 'CircuitBreakerOpenError'
  ) {
    return new ServiceUnavailableException({
      error: 'AI_PROVIDER_UNAVAILABLE',
    });
  }
  return err;
}
