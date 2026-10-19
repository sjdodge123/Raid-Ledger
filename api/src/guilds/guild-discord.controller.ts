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
import type { AuthenticatedRequest } from '../auth/types';
import { GuildDiscordService } from './guild-discord.service';
import { GuildLeaderGuard } from './guild-leader.guard';
import { HubKindActiveGuard } from './hub-kind-active.guard';
import { HubVisibleGuard } from './hub-visible.guard';

const jwt = AuthGuard('jwt');

/**
 * ROK-1788 (S4) — the guild's read-only Discord channel mirror under
 * `/plugins/wow/guilds/:id/discord` and its core alias `guilds/:id/discord`. The mirror read needs `canView` (in the
 * service); the channel list and the binding writes are Leader-only
 * (ROK-1830 D5-A, `GuildLeaderGuard`) — an Officer may edit page content but
 * not rebind the guild's Discord channel.
 */
@Controller(['plugins/wow/guilds/:id/discord', 'guilds/:id/discord'])
@UseGuards(HubKindActiveGuard)
export class GuildDiscordController {
  constructor(private readonly discord: GuildDiscordService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  getMirror(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildDiscordMirrorDto> {
    return this.discord.getMirror(req.user, id);
  }

  @Get('channels')
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  listChannels(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildDiscordChannelListDto> {
    return this.discord.listChannels(id);
  }

  @Put('channel')
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  setChannel(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildDiscordMirrorDto> {
    return this.discord.setChannel(req.user, id, body);
  }

  @Delete('channel')
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  @HttpCode(204)
  async clearChannel(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.discord.clearChannel(id);
  }
}
