import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { GuildIngameText } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import { GuildEditorGuard } from '../../../guilds/guild-editor.guard';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildIngameTextService } from './guild-ingame-text.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-2136 — `/plugins/wow/guilds/:id/ingame-text`: the guild Message of the
 * Day + Guild Information, ready to paste in game. Same guard stack as
 * `GuildContentController`; the write adds `GuildEditorGuard` (`canEdit`).
 */
@Controller('plugins/wow/guilds/:id/ingame-text')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildIngameTextController {
  constructor(private readonly ingameText: GuildIngameTextService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildIngameText> {
    return this.ingameText.get(req.user, id);
  }

  @Put()
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  save(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildIngameText> {
    return this.ingameText.save(req.user, id, body);
  }
}
