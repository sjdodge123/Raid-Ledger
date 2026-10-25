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
import type { AuthenticatedRequest } from '../auth/types';
import { GuildLeaderGuard } from './guild-leader.guard';
import { HubKindActiveGuard } from './hub-kind-active.guard';
import {
  HubMediaChannelService,
  type HubMediaChannelState,
} from './hub-media-channel.service';
import { HubVisibleGuard } from './hub-visible.guard';

const jwt = AuthGuard('jwt');

/**
 * ROK-1941 D2 — `guilds/:id/media-channel`, Leader/staff only (as the
 * ROK-1788 Discord binding). The picker reuses `GET guilds/:id/discord/channels`.
 * L3 adds `POST …/backfill` + `GET …/backfill` here.
 */
@Controller('guilds/:id/media-channel')
@UseGuards(HubKindActiveGuard)
export class HubMediaChannelController {
  constructor(private readonly channels: HubMediaChannelService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  get(@Param('id', ParseIntPipe) id: number): Promise<HubMediaChannelState> {
    return this.channels.get(id);
  }

  @Put()
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  set(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<HubMediaChannelState> {
    return this.channels.set(req.user, id, body);
  }

  @Delete()
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  @HttpCode(204)
  async clear(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.channels.clear(id);
  }
}
