import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequest } from '../auth/types';
import { HubMediaBackfillService } from '../discord-bot/hub-media-channel/hub-media-backfill.service';
import type { HubMediaBackfillStatus } from '../discord-bot/hub-media-channel/hub-media-backfill.types';
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
 * `POST …/backfill` starts the D12 "import last 3 weeks" job (202, 409 while
 * one runs); `GET …/backfill` reads its status + summary.
 */
@Controller('guilds/:id/media-channel')
@UseGuards(HubKindActiveGuard)
export class HubMediaChannelController {
  constructor(
    private readonly channels: HubMediaChannelService,
    private readonly backfill: HubMediaBackfillService,
  ) {}

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

  @Post('backfill')
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  @HttpCode(202)
  startBackfill(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HubMediaBackfillStatus> {
    return this.backfill.start(id);
  }

  @Get('backfill')
  @UseGuards(jwt, HubVisibleGuard, GuildLeaderGuard)
  backfillStatus(
    @Param('id', ParseIntPipe) id: number,
  ): HubMediaBackfillStatus {
    return this.backfill.status(id);
  }
}
