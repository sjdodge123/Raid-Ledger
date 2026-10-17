import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import {
  LinkStartRequestSchema,
  type LinkStartRequestDto,
  type LinkStartResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { validateSteamReturnTo } from '../steam/steam-link-returnto.helpers';
import { setNoStoreLinkHeaders } from '../steam/steam-link-headers.helpers';
import { LinkNonceService } from './link-nonce.service';
import { setLinkNonceCookie } from './link-nonce-cookie.helpers';
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
 * GET /auth/{provider}/link?nonce=, replacing `?token=<access JWT>`. The
 * response also sets the `rl_link_<provider>` cookie that binds the nonce to
 * this browser (see link-nonce-cookie.helpers.ts), so the web POST must send
 * `credentials: 'include'`.
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
    @Res({ passthrough: true }) res: Response,
  ): LinkStartResponseDto {
    parseStartBody(body);
    const minted = this.linkNonceService.mint('discord', req.user.id);
    setLinkNonceCookie(res, 'discord', minted.nonce);
    return minted;
  }

  /** POST /auth/steam/link/start — body `{returnTo?}`, allowlisted here. */
  @RateLimit('auth')
  @Post('steam/link/start')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  startSteamLink(
    @Req() req: AuthenticatedExpressRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): LinkStartResponseDto {
    setNoStoreLinkHeaders(res); // ROK-1731 OQ6: the body carries the nonce
    const { returnTo } = parseStartBody(body);
    const minted = this.linkNonceService.mint(
      'steam',
      req.user.id,
      validateSteamReturnTo(returnTo),
    );
    setLinkNonceCookie(res, 'steam', minted.nonce);
    return minted;
  }
}
