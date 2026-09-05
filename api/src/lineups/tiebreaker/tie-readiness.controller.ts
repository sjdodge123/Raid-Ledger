/**
 * ROK-1374 (C1) — `GET /lineups/:id/tie-readiness`.
 *
 * Its own controller rather than a method on `TiebreakerController`: that file
 * is already at 93 counted lines and Lane A2 adds two pick routes to it, so
 * the readiness read would push it toward the 300-line cap for no reason.
 *
 * D16: EVERY roster member sees the comparison — it is a group decision aid,
 * and hiding it from the people who have to live with the outcome would defeat
 * the feature. Only the Pick affordance is gated, and that gating is reported
 * in the payload (`canPick`), not enforced here.
 */
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TieReadinessResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { isOperatorOrAdmin } from '../../events/controller.helpers';
import type { AuthenticatedRequest } from '../../auth/types';
import { loadExpectedVoters } from '../quorum/quorum-voters.helpers';
import { buildTieReadiness } from './tie-readiness.helpers';

type LineupRow = typeof schema.communityLineups.$inferSelect;

@Controller('lineups/:id')
@UseGuards(AuthGuard('jwt'))
export class TieReadinessController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * The readiness comparison for a tie-held lineup.
   *
   * 404 when there is no tie hold — the card has nothing to render and the
   * absence is a fact about the lineup, not an error the client caused.
   * 403 for a non-roster viewer (E21/AC21): the payload names who owns what
   * across a private roster, which is not public information.
   */
  @Get('tie-readiness')
  async getReadiness(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<TieReadinessResponseDto> {
    const lineup = await this.loadLineup(id);
    const roster = await loadExpectedVoters(this.db, lineup);
    if (
      !roster.includes(req.user.id) &&
      !isOperatorOrAdmin(req.user.role) &&
      lineup.createdBy !== req.user.id
    ) {
      throw new ForbiddenException('NOT_ON_LINEUP_ROSTER');
    }
    return buildTieReadiness(
      this.db,
      lineup,
      { id: req.user.id, role: req.user.role },
      roster,
    );
  }

  /** A lineup with no tie hold is a 404 for this route, not an empty card. */
  private async loadLineup(id: number): Promise<LineupRow> {
    const [lineup] = await this.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, id))
      .limit(1);
    if (!lineup) throw new NotFoundException('LINEUP_NOT_FOUND');
    if (lineup.tieDetectedAt === null) {
      throw new NotFoundException('NO_TIE_HOLD');
    }
    return lineup;
  }
}
