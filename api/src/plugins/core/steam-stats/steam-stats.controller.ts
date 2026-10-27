import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { SteamHubStatsResponse } from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import { SteamStatsReadService } from './steam-stats-read.service';

/**
 * ROK-1953 §4.4 — the Core Achievement race + Playtime cards' read route.
 * Members + staff only (anyone else gets the hub 404, D8); a hub whose game
 * is not enabled answers `200 { available: false }` (D9).
 */
@Controller('hubs/:guildId/steam-stats')
@UseGuards(AuthGuard('jwt'))
export class SteamStatsController {
  constructor(private readonly stats: SteamStatsReadService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  read(
    @Param('guildId', ParseIntPipe) guildId: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<SteamHubStatsResponse> {
    return this.stats.read(req.user, guildId);
  }
}
