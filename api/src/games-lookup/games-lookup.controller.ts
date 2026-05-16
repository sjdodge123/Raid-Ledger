import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  LookupGameByNameInputSchema,
  type GameDetailDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { GamesLookupService } from './games-lookup.service';

/**
 * ROK-1295 — POST /games/lookup-by-name.
 * Free-text → name-dedup → ITAD → IGDB cascade; persists on first miss.
 * JWT-guarded, throttled at the 'search' tier (30 req/min/IP).
 */
@Controller('games')
export class GamesLookupController {
  constructor(private readonly service: GamesLookupService) {}

  @Post('lookup-by-name')
  @UseGuards(AuthGuard('jwt'))
  @RateLimit('search')
  @HttpCode(HttpStatus.OK)
  async lookupByName(@Body() body: unknown): Promise<GameDetailDto> {
    const parsed = LookupGameByNameInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.service.lookupByName(parsed.data.q);
  }
}
