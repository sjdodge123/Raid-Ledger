import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  HubMediaHideBody,
  HubMediaItem,
  HubMediaListQuery,
  HubMediaListResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../auth/types';
import { HubMediaReadService } from './hub-media-read.service';
import {
  HubMediaHideBodyPipe,
  HubMediaIdPipe,
  HubMediaListQueryPipe,
} from './hub-media.pipes';

const NO_STORE = 'private, no-store';

/**
 * ROK-1942 L2 — the hub Gallery: members + staff read (D7, everyone else
 * the hub 404), editors Hide / Unhide, staff Remove (D8).
 */
@Controller('hubs/:guildId/media')
@UseGuards(AuthGuard('jwt'))
export class HubMediaController {
  constructor(private readonly media: HubMediaReadService) {}

  /** Newest first; `kind=screenshot` also matches plain `image` rows. */
  @Get()
  @Header('Cache-Control', NO_STORE)
  list(
    @Param('guildId', HubMediaIdPipe) guildId: number,
    @Query(HubMediaListQueryPipe) query: HubMediaListQuery,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<HubMediaListResponse> {
    return this.media.list(req.user, guildId, query);
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  item(
    @Param('guildId', HubMediaIdPipe) guildId: number,
    @Param('id', HubMediaIdPipe) id: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<HubMediaItem> {
    return this.media.item(req.user, guildId, id);
  }

  @Patch(':id')
  @Header('Cache-Control', NO_STORE)
  hide(
    @Param('guildId', HubMediaIdPipe) guildId: number,
    @Param('id', HubMediaIdPipe) id: number,
    @Body(HubMediaHideBodyPipe) body: HubMediaHideBody,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<HubMediaItem> {
    return this.media.setHidden(req.user, guildId, id, body.hidden);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('guildId', HubMediaIdPipe) guildId: number,
    @Param('id', HubMediaIdPipe) id: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    await this.media.remove(req.user, guildId, id);
  }
}
