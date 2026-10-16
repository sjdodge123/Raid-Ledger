import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  GuildDiscordChannelListDto,
  GuildDiscordMirrorDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildDiscordService } from './guild-discord.service';
import { GuildEditorGuard } from './guild-editor.guard';

const jwt = AuthGuard('jwt');

/**
 * ROK-1788 (S4) — the guild's read-only Discord channel mirror under
 * `/plugins/wow/guilds/:id/discord`. The mirror read needs `canView` (in the
 * service); the channel list and the binding writes need `GuildEditorGuard`.
 */
@Controller('plugins/wow/guilds/:id/discord')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildDiscordController {
  constructor(private readonly discord: GuildDiscordService) {}

  @Get()
  @UseGuards(jwt)
  getMirror(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildDiscordMirrorDto> {
    return this.discord.getMirror(req.user, id);
  }

  @Get('channels')
  @UseGuards(jwt, GuildEditorGuard)
  listChannels(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildDiscordChannelListDto> {
    return this.discord.listChannels(id);
  }

  @Put('channel')
  @UseGuards(jwt, GuildEditorGuard)
  setChannel(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildDiscordMirrorDto> {
    return this.discord.setChannel(req.user, id, body);
  }

  @Delete('channel')
  @UseGuards(jwt, GuildEditorGuard)
  @HttpCode(204)
  async clearChannel(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.discord.clearChannel(id);
  }
}
