import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { z } from 'zod';
import {
  Bg3HubSettingsBodySchema,
  type Bg3HubCampaignsResponse,
  type Bg3HubSettings,
  type Bg3SessionsResponse,
  type Bg3SnapshotResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import { decodeHubMediaCursor } from '../../../hub-media/hub-media.cursor';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { BG3_NO_STORE, BG3_PLUGIN_ID } from '../bg3.constants';
import { parseOr400 } from '../campaigns/bg3-campaigns.controller';
import { bg3IdPipe } from '../campaigns/bg3-id.pipe';
import { Bg3ReadService } from './bg3-read.service';
import { parseThumbnailSize } from './bg3-thumbnail.encode';

const OptionalId = z.coerce.number().int().positive().optional();
const Limit = z.coerce.number().int().min(1).max(20).default(20);

/** `image/webp` response, never cached (D-12: the toggle applies at once). */
export function webp(res: Response, bytes: Buffer): StreamableFile {
  res.set({ 'X-Content-Type-Options': 'nosniff' });
  return new StreamableFile(bytes, {
    type: 'image/webp',
    length: bytes.length,
  });
}

/** ROK-1957 §5.6 — hub-scoped BG3 reads + the settings write. */
@Controller('plugins/bg3/hubs/:hubId')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(BG3_PLUGIN_ID)
export class Bg3ReadController {
  constructor(private readonly reads: Bg3ReadService) {}

  @Get('campaigns')
  @Header('Cache-Control', BG3_NO_STORE)
  campaigns(
    @Param('hubId', bg3IdPipe) hubId: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<Bg3HubCampaignsResponse> {
    return this.reads.campaigns(hubId, req.user);
  }

  @Get('snapshot')
  @Header('Cache-Control', BG3_NO_STORE)
  snapshot(
    @Param('hubId', bg3IdPipe) hubId: number,
    @Query('campaignId') raw: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<Bg3SnapshotResponse> {
    const campaignId = parseOr400(OptionalId, raw, 'Invalid campaignId');
    return this.reads.snapshot(hubId, req.user, campaignId);
  }

  @Get('campaigns/:campaignId/sessions')
  @Header('Cache-Control', BG3_NO_STORE)
  sessions(
    @Param('hubId', bg3IdPipe) hubId: number,
    @Param('campaignId', bg3IdPipe) campaignId: number,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') rawLimit: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<Bg3SessionsResponse> {
    const limit = parseOr400(Limit, rawLimit, 'Invalid limit');
    return this.reads.sessions(hubId, campaignId, req.user, {
      cursor: cursor ? decodeHubMediaCursor(cursor) : null,
      limit,
    });
  }

  @Get('saves/:saveId/thumbnail')
  @Header('Cache-Control', BG3_NO_STORE)
  async thumbnail(
    @Param('hubId', bg3IdPipe) hubId: number,
    @Param('saveId', bg3IdPipe) saveId: number,
    @Query('size') size: unknown,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const s = parseThumbnailSize(size);
    return webp(res, await this.reads.thumbnail(hubId, saveId, req.user, s));
  }

  @Put('settings')
  @Header('Cache-Control', BG3_NO_STORE)
  settings(
    @Param('hubId', bg3IdPipe) hubId: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<Bg3HubSettings> {
    const parsed = parseOr400(Bg3HubSettingsBodySchema, body, 'Invalid body');
    return this.reads.updateSettings(hubId, req.user, parsed);
  }
}
