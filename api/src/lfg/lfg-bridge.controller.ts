/**
 * `GET /lfg/bridge/:lineupId` (ROK-1457 D9) — the caller's own open
 * lineup → LFG offers, recomputed live. Reads nothing from and writes nothing
 * to the dedup guard: the push is one-shot, the page is not.
 *
 * Its own controller so `lfg.controller.ts` stays off the diff; the route is
 * two segments deep and cannot shadow `@Get(':gameId')`.
 */
import {
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LfgBridgeOfferDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { findBridgeCandidates } from './lfg-bridge.helpers';

@Controller('lfg')
@UseGuards(AuthGuard('jwt'))
export class LfgBridgeController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Losing nominations of the caller on this lineup with no live intent. */
  @Get('bridge/:lineupId')
  async listOffers(
    @Param('lineupId', ParseIntPipe) lineupId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgBridgeOfferDto[]> {
    const rows = await findBridgeCandidates(this.db, lineupId, new Date(), {
      userId: req.user.id,
    });
    return rows.map((r) => ({
      gameId: r.gameId,
      gameName: r.gameName,
      gameSlug: r.gameSlug,
      gameCoverUrl: r.gameCoverUrl,
      lineupId: r.lineupId,
      lineupTitle: r.lineupTitle,
    }));
  }
}
