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
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { LineupNotificationService } from '../lineup-notification.service';
import { LineupsGateway } from '../lineups.gateway';
import { dispatchTiebreakerOpen } from './tiebreaker-dispatch.helpers';
import { detectTies } from './tiebreaker-detect.helpers';
import { pickDismissWinner } from './tiebreaker-dismiss.helpers';
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
import { decideLineupFromTiebreaker } from './tiebreaker-decide.helpers';
import {
  submitVeto,
  revealVetoes,
  findSurvivor,
} from './tiebreaker-veto.helpers';
import { buildTiebreakerDetail } from './tiebreaker-response.helpers';
import { findVetoes } from './tiebreaker-query.helpers';
import {
  assertCanPickTiebreaker,
  pickTieGame,
  undoTiePick,
  type TiePickActor,
  type TiePickDeps,
} from './tie-pick.helpers';
import type { TieHoldState } from './tie-hold.helpers';
import { findLineupById } from '../lineups-query.helpers';
import { SettingsService } from '../../settings/settings.service';
import { LineupPhaseQueueService } from '../queue/lineup-phase.queue';
import {
  assertNoActiveTiebreaker,
  clearActiveTiebreaker,
  findAndValidateLineup,
  insertTiebreaker,
  linkTiebreakerToLineup,
  resolveTiebreaker,
  updateTiebreakerStatus,
} from './tiebreaker-lifecycle.helpers';

type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class TiebreakerService {
  private readonly logger = new Logger(TiebreakerService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: Db,
    @Inject(forwardRef(() => LineupNotificationService))
    private readonly notificationService: LineupNotificationService,
    @Inject(forwardRef(() => LineupsGateway))
    private readonly lineupsGateway: LineupsGateway,
    /** ROK-1473: carries the entered-scheduling hook (poll card post). */
    private readonly eventEmitter: EventEmitter2,
    /** ROK-1374: the tie pick claims the same grace window auto-advance does. */
    @Inject(forwardRef(() => LineupPhaseQueueService))
    private readonly phaseQueue: LineupPhaseQueueService,
    /** ROK-1374: reads `LINEUP_AUTO_ADVANCE_GRACE_MS` for that window. */
    private readonly settings: SettingsService,
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

  /**
   * Start a tiebreaker mode (D15: the lineup CREATOR or an operator/admin —
   * the route's `@Roles('operator')` decorator moved in here because "creator"
   * is a row fact a role decorator cannot express). `/dismiss` and `/resolve`
   * keep their operator-only decorators: those two DECIDE, and widening them
   * would smuggle in an automatic resolver through the back door.
   */
  async start(
    lineupId: number,
    dto: StartTiebreakerDto,
    user: TiePickActor,
  ): Promise<TiebreakerDetailDto> {
    const lineup = await findAndValidateLineup(this.db, lineupId);
    assertCanPickTiebreaker(lineup, user);
    assertNoActiveTiebreaker(lineup);

    const ties = await detectTies(this.db, lineupId);
    if (!ties) {
      throw new BadRequestException('No ties detected in this lineup');
    }

    const [tiebreaker] = await insertTiebreaker(
      this.db,
      lineupId,
      dto,
      ties.tiedGameIds,
      ties.voteCount,
    );
    await linkTiebreakerToLineup(this.db, lineupId, tiebreaker.id);

    if (dto.mode === 'bracket') {
      await buildBracket(this.db, tiebreaker.id, ties.tiedGameIds);
    }

    await updateTiebreakerStatus(this.db, tiebreaker.id, 'active');
    this.logger.log(
      `Tiebreaker ${tiebreaker.id} started (${dto.mode}) for lineup ${lineupId}`,
    );

    await this.dispatchOpen(
      lineupId,
      tiebreaker.id,
      dto.mode,
      tiebreaker.roundDeadline,
    );
    return buildTiebreakerDetail(this.db, { ...tiebreaker, status: 'active' });
  }

  private async dispatchOpen(
    lineupId: number,
    tiebreakerId: number,
    mode: 'bracket' | 'veto',
    roundDeadline: Date | null,
  ): Promise<void> {
    await dispatchTiebreakerOpen(
      this.notificationService,
      this.lineupsGateway,
      this.logger,
      this.db,
      { lineupId, tiebreakerId, mode, roundDeadline },
    );
  }

  /**
   * Dismiss tiebreaker — proceed to decided. Idempotent (ROK-1262): when
   * the modal is shown but no tiebreaker row exists yet, fall back to the
   * lowest-gameId tied entry — see `pickDismissWinner`.
   */
  async dismiss(lineupId: number): Promise<void> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (tb) await updateTiebreakerStatus(this.db, tb.id, 'dismissed');
    await clearActiveTiebreaker(this.db, lineupId);
    if (tb) return this.transitionToDecided(lineupId);
    const winnerId = await pickDismissWinner(this.db, lineupId);
    await this.transitionToDecided(lineupId, winnerId);
  }

  /** Reset/clear any active tiebreaker without changing lineup phase. */
  async reset(lineupId: number): Promise<void> {
    const [tb] = await findPendingOrActiveTiebreaker(this.db, lineupId);
    if (!tb) return; // no-op if nothing to reset
    await updateTiebreakerStatus(this.db, tb.id, 'dismissed');
    await clearActiveTiebreaker(this.db, lineupId);
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
    await resolveTiebreaker(this.db, tb.id, winnerId);
    await clearActiveTiebreaker(this.db, lineupId);
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
      await resolveTiebreaker(this.db, tb.id, winner);
      await clearActiveTiebreaker(this.db, lineupId);
      await this.transitionToDecided(lineupId, winner);
      this.logger.log(
        `Bracket tiebreaker ${tb.id} resolved, winner: ${winner}`,
      );
    }
  }

  /**
   * ROK-1374: pick one of the tied GAMES (not a mode). Reversible until the
   * grace window it claims elapses.
   */
  async pickGame(
    lineupId: number,
    user: TiePickActor,
    gameId: number,
  ): Promise<TieHoldState | null> {
    const lineup = await this.loadLineupOr404(lineupId);
    return pickTieGame(this.tiePickDeps(), lineup, user, gameId);
  }

  /** ROK-1374: reverse a pick while its grace window is still pending. */
  async undoPick(
    lineupId: number,
    user: TiePickActor,
  ): Promise<TieHoldState | null> {
    const lineup = await this.loadLineupOr404(lineupId);
    return undoTiePick(this.tiePickDeps(), lineup, user);
  }

  /**
   * Deliberately NOT `findAndValidateLineup`: undoing after the advance fired
   * must answer 409 TIE_PICK_FINAL, and that helper would 400 on the
   * no-longer-`voting` status first.
   */
  private async loadLineupOr404(lineupId: number) {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    return lineup;
  }

  private tiePickDeps(): TiePickDeps {
    return {
      db: this.db,
      settings: this.settings,
      phaseQueue: this.phaseQueue,
      lineupsGateway: this.lineupsGateway,
      logger: this.logger,
    };
  }

  // -- private helpers --

  /** Flip to decided + rebuild match groups (ROK-1473: extracted). */
  private transitionToDecided(
    lineupId: number,
    decidedGameId?: number,
  ): Promise<void> {
    return decideLineupFromTiebreaker(
      { db: this.db, logger: this.logger, events: this.eventEmitter },
      lineupId,
      decidedGameId,
    );
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
}
