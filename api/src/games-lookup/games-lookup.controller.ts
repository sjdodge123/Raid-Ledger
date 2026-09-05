import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  LookupGameByNameInputSchema,
  type GameDetailDto,
  type GameSlugLookupDto,
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

  /**
   * ROK-1464 — `GET /games/slug/:slug`, the id resolution a slug-addressed
   * page needs before it can call the id-keyed reads.
   *
   * Declared here rather than on `igdb.controller.ts` (which owns `games/:id`
   * and sits at 298/300 counted lines). The two-segment literal prefix cannot
   * collide with that controller's single-segment `:id` route.
   */
  @Get('slug/:slug')
  @UseGuards(AuthGuard('jwt'))
  @RateLimit('search')
  findBySlug(@Param('slug') slug: string): Promise<GameSlugLookupDto> {
    return this.service.findBySlug(slug);
  }
}
