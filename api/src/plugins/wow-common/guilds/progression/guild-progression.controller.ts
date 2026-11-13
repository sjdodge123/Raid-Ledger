import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { WowGuildProgressionPageDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../../auth/types';
import { HubVisibleGuard } from '../../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { GuildProgressionService } from './guild-progression.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1789 Part B (B-3) — `/plugins/wow/guilds/:id/progression` (GET only).
 * Same guard stack as Part A's `GuildRecruitmentController`; the members +
 * staff check (B10) runs in the service.
 */
@Controller('plugins/wow/guilds/:id/progression')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildProgressionController {
  constructor(private readonly progression: GuildProgressionService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WowGuildProgressionPageDto> {
    return this.progression.page(req.user, id);
  }
}
