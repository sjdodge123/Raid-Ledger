import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { GuildContributionsDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildContributionsService } from './guild-contributions.service';

/**
 * ROK-2148 — `GET /plugins/wow/guilds/:id/contributions`: the Guild
 * contributions card (Mailworthy masters, top givers, users). Same guard
 * stack as `GuildIngameTextController`'s read; 403 for visitors (service).
 */
@Controller('plugins/wow/guilds/:id/contributions')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildContributionsController {
  constructor(private readonly contributions: GuildContributionsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'), HubVisibleGuard)
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildContributionsDto> {
    return this.contributions.get(req.user, id);
  }
}
