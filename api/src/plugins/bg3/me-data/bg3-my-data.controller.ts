import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  Bg3RemoveSavesBodySchema,
  type Bg3RemoveSavesResult,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import { HubMediaService } from '../../../hub-media/hub-media.service';
import { parseOr400 } from '../campaigns/bg3-campaigns.controller';
import {
  Bg3MyDataRepository,
  type Bg3MyDataDeleted,
} from './bg3-my-data.repository';
import { Bg3RemoveSavesRepository } from './bg3-remove-saves.repository';

/**
 * ROK-1957 D-18 — `DELETE plugins/bg3/me/data`, the caller only. Deliberately
 * WITHOUT `PluginActiveGuard`: removing data a user withdrew runs whether or
 * not `bg3` is active (CLAUDE.md hub-plugin rule), so this cannot live on
 * `Bg3MeController`, whose class-level guard 403s when the plugin is off.
 * ROK-1959 D-9: after the bg3 tx commits, the caller's save pictures in hub
 * Galleries are tombstoned and their files unlinked too.
 * ROK-2068: `POST saves/remove` does the same for chosen campaign keys only,
 * tombstoning the pictures inside the bg3 tx (a failure leaves a retryable
 * state); only the file unlinks run after commit.
 */
@Controller('plugins/bg3/me')
@UseGuards(AuthGuard('jwt'))
export class Bg3MyDataController {
  constructor(
    private readonly repo: Bg3MyDataRepository,
    private readonly hubMedia: HubMediaService,
    private readonly removeRepo: Bg3RemoveSavesRepository,
  ) {}

  @Delete('data')
  @HttpCode(200)
  async deleteMine(
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<{ deleted: Bg3MyDataDeleted }> {
    const deleted = await this.repo.deleteAllFor(req.user.id);
    await this.hubMedia.removeSourceRowsOf('bg3-save', req.user.id);
    await this.hubMedia.removeSourceRowsOf('bg3-screenshot', req.user.id);
    return { deleted };
  }

  @Post('saves/remove')
  @HttpCode(200)
  async removeSaves(
    @Req() req: AuthenticatedExpressRequest,
    @Body() body: unknown,
  ): Promise<Bg3RemoveSavesResult> {
    const { campaignKeys } = parseOr400(
      Bg3RemoveSavesBodySchema,
      body,
      'Invalid remove-saves body',
    );
    const keys = [...new Set(campaignKeys)];
    const { galleryFiles, ...counts } = await this.removeRepo.removeKeysFor(
      req.user.id,
      keys,
    );
    // The tombstones committed with the saves; the files go after commit.
    await this.hubMedia.unlinkRemovedFiles(galleryFiles);
    return { removed: { ...counts, galleryPictures: galleryFiles.length } };
  }
}
