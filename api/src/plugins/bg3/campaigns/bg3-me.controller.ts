import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import type { Bg3MySavesResponse } from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import { decodeHubMediaCursor } from '../../../hub-media/hub-media.cursor';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { BG3_NO_STORE, webp } from '../read/bg3-read.controller';
import { Bg3MySavesService } from '../read/bg3-my-saves.service';
import { parseThumbnailSize } from '../read/bg3-thumbnail.encode';
import { parseOr400 } from './bg3-campaigns.controller';
import { bg3IdPipe } from './bg3-id.pipe';
import { z } from 'zod';

const Unassigned = z.enum(['true', 'false']).optional();

/** ROK-1957 §5.4 — the caller's own saves (never spoiler-hidden, D-14). */
@Controller('plugins/bg3/me')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(BG3_PLUGIN_ID)
export class Bg3MeController {
  constructor(private readonly mine: Bg3MySavesService) {}

  @Get('saves')
  @Header('Cache-Control', BG3_NO_STORE)
  saves(
    @Query('unassigned') rawUnassigned: unknown,
    @Query('cursor') cursor: string | undefined,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<Bg3MySavesResponse> {
    const flag = parseOr400(Unassigned, rawUnassigned, 'Invalid unassigned');
    return this.mine.list(req.user.id, {
      unassigned: flag === 'true',
      cursor: cursor ? decodeHubMediaCursor(cursor) : null,
    });
  }

  @Get('saves/:saveId/thumbnail')
  @Header('Cache-Control', BG3_NO_STORE)
  async thumbnail(
    @Param('saveId', bg3IdPipe) saveId: number,
    @Query('size') size: unknown,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const s = parseThumbnailSize(size);
    return webp(res, await this.mine.thumbnail(req.user.id, saveId, s));
  }
}
