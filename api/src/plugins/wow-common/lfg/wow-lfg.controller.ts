/**
 * ROK-2352 §3.3 / §5 — the WoW LFG plugin routes, `plugins/wow/lfg`, behind
 * the `blizzard` plugin-active guard and JWT: the caller's last hand detail
 * on a game (raise-hand pre-fill) and an edit of one of their hands.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequest } from '../../../auth/types';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import {
  readWowLastDetail,
  type WowLfgDb,
  type WowLfgStoredDetail,
} from './wow-lfg-detail.helpers';
import { WowLfgGroupingAdapter } from './wow-lfg-grouping.adapter';
import { loadOwnWowIntent } from './wow-lfg-intent.helpers';

@Controller('plugins/wow/lfg')
@UseGuards(PluginActiveGuard, AuthGuard('jwt'))
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class WowLfgController {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: WowLfgDb,
    private readonly adapter: WowLfgGroupingAdapter,
  ) {}

  /** GET /plugins/wow/lfg/:gameId/last-detail → `{ detail }` (null if none). */
  @Get(':gameId/last-detail')
  async lastDetail(
    @Request() req: AuthenticatedRequest,
    @Param('gameId', ParseIntPipe) gameId: number,
  ): Promise<{ detail: WowLfgStoredDetail | null }> {
    const detail = await readWowLastDetail(this.db, {
      userId: req.user.id,
      gameId,
    });
    return { detail };
  }

  /** PUT /plugins/wow/lfg/hands/:intentId/detail — own active WoW hand only. */
  @Put('hands/:intentId/detail')
  @HttpCode(204)
  async putDetail(
    @Request() req: AuthenticatedRequest,
    @Param('intentId', ParseIntPipe) intentId: number,
    @Body() body: unknown,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ctx = await loadOwnWowIntent(tx, { userId: req.user.id, intentId });
      await this.adapter.saveHandDetail(tx, ctx, body);
    });
  }
}
