/**
 * Tiebreaker orchestrator service (ROK-938).
 * Coordinates start, dismiss, bracket vote, veto, and resolve flows.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  StartTiebreakerDto,
  CastBracketVoteDto,
  CastVetoDto,
  TiebreakerDetailDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { detectTies } from './tiebreaker-detect.helpers';
import { runMatchingAlgorithm } from '../lineups-lifecycle.helpers';
import {
  findPendingOrActiveTiebreaker,
  findMatchups,
  countDistinctMatchupVoters,
} from './tiebreaker-query.helpers';
import {
  buildBracket,
  advanceBracket,
  getCurrentRound,
} from './tiebreaker-bracket.helpers';
import { countDistinctVoters } from '../lineups-query.helpers';
import {
  submitVeto,
  revealVetoes,
  findSurvivor,
} from './tiebreaker-veto.helpers';
import { buildTiebreakerDetail } from './tiebreaker-response.helpers';
import { findVetoes } from './tiebreaker-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class TiebreakerService {
  private readonly logger = new Logger(TiebreakerService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: Db,
  ) {}

  /** Get tiebreaker detail for a lineup. */
  async getDetail(
    lineupId: number,
    userId?: number,
  ): Promise<TiebreakerDetailDto | null> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (!tb) return null;
    return buildTiebreakerDetail(this.db, tb, userId);
  }

  /** Start a tiebreaker (operator action). */
  async start(
    lineupId: number,
    dto: StartTiebreakerDto,
  ): Promise<TiebreakerDetailDto> {
    const lineup = await this.findAndValidateLineup(lineupId);
    this.assertNoActiveTiebreaker(lineup);

    const ties = await detectTies(this.db, lineupId);
    if (!ties) {
      throw new BadRequestException('No ties detected in this lineup');
    }

    const [tiebreaker] = await this.insertTiebreaker(
      lineupId,
      dto,
      ties.tiedGameIds,
      ties.voteCount,
    );
    await this.linkTiebreakerToLineup(lineupId, tiebreaker.id);

    if (dto.mode === 'bracket') {
      await buildBracket(this.db, tiebreaker.id, ties.tiedGameIds);
    }

    await this.activateTiebreaker(tiebreaker.id);
    this.logger.log(
      `Tiebreaker ${tiebreaker.id} started (${dto.mode}) for lineup ${lineupId}`,
    );

    return buildTiebreakerDetail(this.db, {
      ...tiebreaker,
      status: 'active',
    });
  }

  /** Dismiss tiebreaker — proceed to decided without resolution. */
  async dismiss(lineupId: number): Promise<void> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (!tb) throw new NotFoundException('No tiebreaker found');

    await this.updateTiebreakerStatus(tb.id, 'dismissed');
    await this.clearActiveTiebreaker(lineupId);
    await this.transitionToDecided(lineupId);
  }

  /** Reset/clear any active tiebreaker without changing lineup phase. */
  async reset(lineupId: number): Promise<void> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (!tb) return; // no-op if nothing to reset
    await this.updateTiebreakerStatus(tb.id, 'dismissed');
    await this.clearActiveTiebreaker(lineupId);
  }

  /** Cast a bracket vote. */
  async castBracketVote(
    lineupId: number,
    dto: CastBracketVoteDto,
    userId: number,
  ): Promise<TiebreakerDetailDto> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (!tb || tb.status !== 'active') {
      throw new BadRequestException('No active tiebreaker');
    }

    await this.db
      .insert(schema.communityLineupTiebreakerBracketVotes)
      .values({ matchupId: dto.matchupId, userId, gameId: dto.gameId })
      .onConflictDoNothing();

    // Check if current round is complete and auto-advance
    await this.checkAndAdvanceRound(tb, lineupId);

    const [updated] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    return buildTiebreakerDetail(this.db, updated ?? tb, userId);
  }

  /** Submit a veto. */
  async castVeto(
    lineupId: number,
    dto: CastVetoDto,
    userId: number,
  ): Promise<TiebreakerDetailDto> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (!tb || tb.status !== 'active') {
      throw new BadRequestException('No active tiebreaker');
    }

    await submitVeto(this.db, tb, userId, dto.gameId);
    return buildTiebreakerDetail(this.db, tb, userId);
  }

  /** Force-resolve an active tiebreaker (operator). */
  async forceResolve(lineupId: number): Promise<void> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (!tb) throw new NotFoundException('No tiebreaker found');

    const winnerId = await this.determineWinner(tb);
    await this.resolveTiebreaker(tb.id, winnerId);
    await this.clearActiveTiebreaker(lineupId);
    await this.transitionToDecided(lineupId, winnerId);
  }

  /**
   * Check if all community members have voted on every non-bye matchup
   * in the current round. If so, advance the bracket.
   * If the bracket completes, resolve the tiebreaker and transition lineup.
   */
  private async checkAndAdvanceRound(
    tb: typeof schema.communityLineupTiebreakers.$inferSelect,
    lineupId: number,
  ): Promise<void> {
    const round = await getCurrentRound(this.db, tb.id);
    const matchups = await findMatchups(this.db, tb.id);
    const active = matchups.filter(
      (m) => m.round === round && !m.isBye && !m.winnerGameId,
    );
    if (active.length === 0) return;

    // Use lineup voter count — only people who voted in the lineup need to vote
    const [tb2] = await this.db
      .select()
      .from(schema.communityLineupTiebreakers)
      .where(eq(schema.communityLineupTiebreakers.id, tb.id))
      .limit(1);
    const lineupVoters = await countDistinctVoters(
      this.db,
      tb2?.lineupId ?? lineupId,
    );
    const requiredVotes = lineupVoters[0]?.total ?? 1;

    for (const m of active) {
      const voterCount = await countDistinctMatchupVoters(this.db, m.id);
      if (voterCount < requiredVotes) return; // still waiting for votes
    }

    // All members voted on all matchups — advance
    const winner = await advanceBracket(this.db, tb.id);
    if (winner) {
      await this.resolveTiebreaker(tb.id, winner);
      await this.clearActiveTiebreaker(lineupId);
      await this.transitionToDecided(lineupId, winner);
      this.logger.log(
        `Bracket tiebreaker ${tb.id} resolved, winner: ${winner}`,
      );
    }
  }

  // -- private helpers --

  private async findAndValidateLineup(lineupId: number) {
    const [lineup] = await this.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'voting') {
      throw new BadRequestException('Lineup must be in voting status');
    }
    return lineup;
  }

  private assertNoActiveTiebreaker(
    lineup: typeof schema.communityLineups.$inferSelect,
  ) {
    if (lineup.activeTiebreakerId) {
      throw new BadRequestException('A tiebreaker is already active');
    }
  }

  private insertTiebreaker(
    lineupId: number,
    dto: StartTiebreakerDto,
    tiedGameIds: number[],
    voteCount: number,
  ) {
    const deadline = dto.roundDurationHours
      ? new Date(Date.now() + dto.roundDurationHours * 3_600_000)
      : null;

    return this.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId,
        mode: dto.mode,
        status: 'pending',
        tiedGameIds,
        originalVoteCount: voteCount,
        roundDeadline: deadline,
      })
      .returning();
  }

  private async linkTiebreakerToLineup(lineupId: number, tiebreakerId: number) {
    await this.db
      .update(schema.communityLineups)
      .set({ activeTiebreakerId: tiebreakerId, updatedAt: new Date() })
      .where(eq(schema.communityLineups.id, lineupId));
  }

  private async activateTiebreaker(tiebreakerId: number) {
    await this.updateTiebreakerStatus(tiebreakerId, 'active');
  }

  private async updateTiebreakerStatus(
    tiebreakerId: number,
    status: 'pending' | 'active' | 'resolved' | 'dismissed',
  ) {
    await this.db
      .update(schema.communityLineupTiebreakers)
      .set({
        status,
        updatedAt: new Date(),
        ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
      })
      .where(eq(schema.communityLineupTiebreakers.id, tiebreakerId));
  }

  private async clearActiveTiebreaker(lineupId: number) {
    await this.db
      .update(schema.communityLineups)
      .set({ activeTiebreakerId: null, updatedAt: new Date() })
      .where(eq(schema.communityLineups.id, lineupId));
  }

  private async transitionToDecided(lineupId: number, decidedGameId?: number) {
    const update: Partial<typeof schema.communityLineups.$inferInsert> = {
      status: 'decided',
      updatedAt: new Date(),
    };
    if (decidedGameId) update.decidedGameId = decidedGameId;
    await this.db
      .update(schema.communityLineups)
      .set(update)
      .where(eq(schema.communityLineups.id, lineupId));
    // Run matching algorithm so decided view has match groups
    await runMatchingAlgorithm(this.db, lineupId, this.logger);
  }

  private async determineWinner(
    tb: typeof schema.communityLineupTiebreakers.$inferSelect,
  ): Promise<number> {
    const tiedGameIds = tb.tiedGameIds;

    if (tb.mode === 'bracket') {
      const winner = await advanceBracket(this.db, tb.id);
      if (winner) return winner;
      // If bracket isn't done, pick highest-seeded remaining
      const matchups = await findMatchups(this.db, tb.id);
      const final = matchups.find((m) => m.winnerGameId);
      return final?.winnerGameId ?? tiedGameIds[0];
    }

    // Veto mode: reveal and find survivor
    await revealVetoes(this.db, tb.id);
    const vetoes = await findVetoes(this.db, tb.id);
    return findSurvivor(tiedGameIds, vetoes);
  }

  private async resolveTiebreaker(tiebreakerId: number, winnerId: number) {
    await this.db
      .update(schema.communityLineupTiebreakers)
      .set({
        status: 'resolved',
        winnerGameId: winnerId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.communityLineupTiebreakers.id, tiebreakerId));
  }
}
