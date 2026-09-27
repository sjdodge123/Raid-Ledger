import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  LinkStartRequestSchema,
  type LinkStartRequestDto,
  type LinkStartResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { validateSteamReturnTo } from '../steam/steam-link-returnto.helpers';
import { LinkNonceService } from './link-nonce.service';
import type { AuthenticatedExpressRequest } from './types';

/**
 * Parse the start body with the strict contract schema. The start endpoints
 * authenticate ONLY via the Authorization header (AC12), so a body carrying
 * `token` (or anything unknown) is a 400, never a fallback credential.
 */
function parseStartBody(body: unknown): LinkStartRequestDto {
  const parsed = LinkStartRequestSchema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestException('Invalid request body');
  return parsed.data;
}

/**
 * ROK-1630: mint the single-use nonce the browser carries to
 * GET /auth/{provider}/link?nonce=, replacing `?token=<access JWT>`.
 */
@Controller('auth')
export class LinkStartController {
  constructor(private readonly linkNonceService: LinkNonceService) {}

  /** POST /auth/discord/link/start — body `{}`. */
  @RateLimit('auth')
  @Post('discord/link/start')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  startDiscordLink(
    @Req() req: AuthenticatedExpressRequest,
    @Body() body: unknown,
  ): LinkStartResponseDto {
    parseStartBody(body);
    return this.linkNonceService.mint('discord', req.user.id);
  }

  /** POST /auth/steam/link/start — body `{returnTo?}`, allowlisted here. */
  @RateLimit('auth')
  @Post('steam/link/start')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  startSteamLink(
    @Req() req: AuthenticatedExpressRequest,
    @Body() body: unknown,
  ): LinkStartResponseDto {
    const { returnTo } = parseStartBody(body);
    return this.linkNonceService.mint(
      'steam',
      req.user.id,
      validateSteamReturnTo(returnTo),
    );
  }
}
