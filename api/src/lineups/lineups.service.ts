import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CommonGroundQueryDto,
  CommonGroundResponseDto,
  CreateLineupDto,
  LineupBannerResponseDto,
  LineupDetailResponseDto,
  NominateGameDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import {
  findActiveLineup,
  findLineupById,
  findBuildingLineup,
  findNominatedGameIds,
  countDistinctNominators,
  VALID_TRANSITIONS,
  VALID_REVERSIONS,
} from './lineups-query.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import {
  queryCommonGround,
  mapCommonGroundRow,
} from './common-ground-query.helpers';
import {
  SCORING_WEIGHTS,
  nominationCap,
} from './common-ground-scoring.constants';
import { findBannerLineup, buildBannerData } from './lineups-banner.helpers';
import {
  findEntry,
  validateRemoval,
  deleteEntry,
} from './lineups-removal.helpers';
import {
  validateNominationCap,
  validateGameExists,
  insertNomination,
} from './lineups-nomination.helpers';
import {
  hasDurationParams,
  buildOverrides,
  computeInitialDeadline,
  computeTransitionDeadline,
  getNextPhase,
  buildTransitionValues,
} from './lineups-phase.helpers';
import { logTransition, logNomination } from './lineups-activity.helpers';
import { toggleVote as toggleVoteHelper } from './lineups-voting.helpers';
import { buildMatchesForLineup } from './lineups-matching.helpers';

/** Caller identity for authorization checks. */
export interface CallerIdentity {
  id: number;
  role: string;
}

@Injectable()
export class LineupsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly activityLog: ActivityLogService,
    private readonly settings: SettingsService,
    private readonly phaseQueue: LineupPhaseQueueService,
  ) {}

  /** Create a new lineup. Throws 409 if an active lineup already exists. */
  async create(
    dto: CreateLineupDto,
    userId: number,
  ): Promise<LineupDetailResponseDto> {
    const overrides = hasDurationParams(dto) ? buildOverrides(dto) : null;
    const phaseDeadline = await computeInitialDeadline(dto, this.settings);

    const [row] = await this.insertLineup(
      dto,
      userId,
      phaseDeadline,
      overrides,
    );
    void this.activityLog.log('lineup', row.id, 'lineup_created', userId);

    const delayMs = phaseDeadline.getTime() - Date.now();
    await this.phaseQueue.scheduleTransition(row.id, 'voting', delayMs);

    return buildDetailResponse(this.db, row.id);
  }

  /** Get the currently active lineup (building or voting). */
  async findActive(userId?: number): Promise<LineupDetailResponseDto> {
    const [row] = await findActiveLineup(this.db);
    if (!row) throw new NotFoundException('No active lineup');
    return buildDetailResponse(this.db, row.id, userId);
  }

  /** Get a lineup by ID with full detail. */
  async findById(
    id: number,
    userId?: number,
  ): Promise<LineupDetailResponseDto> {
    return buildDetailResponse(this.db, id, userId);
  }

  /** Toggle a vote for a game in a lineup (ROK-936). */
  async toggleVote(
    lineupId: number,
    gameId: number,
    userId: number,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'voting') {
      throw new BadRequestException('Voting is only allowed in voting status');
    }
    const action = await toggleVoteHelper(
      this.db,
      lineupId,
      userId,
      gameId,
      lineup.maxVotesPerPlayer ?? 3,
    );
    void this.activityLog.log('lineup', lineupId, 'vote_cast', userId, {
      gameId,
      action,
    });
    return buildDetailResponse(this.db, lineupId, userId);
  }

  /** Transition a lineup to a new status. */
  async transitionStatus(
    id: number,
    dto: UpdateLineupStatusDto,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, id);
    if (!lineup) throw new NotFoundException('Lineup not found');

    this.validateTransition(lineup.status as LineupStatus, dto);
    if (dto.status === 'decided' && dto.decidedGameId) {
      await this.validateDecidedGame(id, dto.decidedGameId);
    }

    await this.applyStatusUpdate(id, dto, lineup);
    if (dto.status === 'decided') {
      await this.runMatchingAlgorithm(id);
    }
    await logTransition(this.db, this.activityLog, id, dto);
    return buildDetailResponse(this.db, id);
  }

  /** Get Common Ground games — ownership overlap. */
  async getCommonGround(
    filters: CommonGroundQueryDto,
  ): Promise<CommonGroundResponseDto> {
    const [lineup] = await findBuildingLineup(this.db);
    if (!lineup)
      throw new NotFoundException('No active lineup in building status');

    const nominated = await findNominatedGameIds(this.db, lineup.id);
    const [nominators] = await countDistinctNominators(this.db, lineup.id);
    const rows = await queryCommonGround(this.db, filters, nominated);
    const scored = rows.map(mapCommonGroundRow);
    scored.sort((a, b) => b.score - a.score);

    return {
      data: scored,
      meta: {
        total: scored.length,
        appliedWeights: { ...SCORING_WEIGHTS },
        activeLineupId: lineup.id,
        nominatedCount: nominated.length,
        maxNominations: nominationCap(nominators?.count ?? 0),
      },
    };
  }

  /** Nominate a game into a lineup. */
  async nominate(lineupId: number, dto: NominateGameDto, userId: number) {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'building')
      throw new BadRequestException('Lineup is not in building status');

    await validateNominationCap(this.db, lineupId);
    await validateGameExists(this.db, dto.gameId);
    await insertNomination(this.db, lineupId, dto, userId);
    await logNomination(this.db, this.activityLog, lineupId, dto, userId);
    return buildDetailResponse(this.db, lineupId);
  }

  /** Remove a nomination. */
  async removeNomination(
    lineupId: number,
    gameId: number,
    caller: CallerIdentity,
  ) {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'building')
      throw new BadRequestException('Can only remove during building');

    const entry = await findEntry(this.db, lineupId, gameId);
    validateRemoval(entry, caller);
    await deleteEntry(this.db, lineupId, gameId);
    void this.activityLog.log(
      'lineup',
      lineupId,
      'nomination_removed',
      caller.id,
      { gameId },
    );
  }

  /** Get banner data for the Games page. Returns null if no eligible lineup. */
  async findBanner(): Promise<LineupBannerResponseDto | null> {
    const [lineup] = await findBannerLineup(this.db);
    if (!lineup) return null;
    return buildBannerData(this.db, lineup);
  }

  /** Insert a new lineup row with phase scheduling fields. */
  private insertLineup(
    dto: CreateLineupDto,
    userId: number,
    phaseDeadline: Date | null,
    overrides: Record<string, number | undefined> | null,
  ) {
    return this.db.transaction(async (tx) => {
      const [existing] = await findActiveLineup(tx);
      if (existing) throw new ConflictException('A lineup is already active');
      return tx
        .insert(schema.communityLineups)
        .values({
          createdBy: userId,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
          phaseDeadline,
          phaseDurationOverride: overrides,
          matchThreshold: dto.matchThreshold ?? undefined,
          maxVotesPerPlayer: dto.votesPerPlayer ?? undefined,
        })
        .returning();
    });
  }

  /** Apply the status update with phase scheduling. */
  private async applyStatusUpdate(
    id: number,
    dto: UpdateLineupStatusDto,
    lineup: typeof schema.communityLineups.$inferSelect,
  ) {
    const phaseDeadline = await computeTransitionDeadline(
      dto.status,
      lineup,
      this.settings,
    );
    const values = buildTransitionValues(dto, phaseDeadline);
    await this.db
      .update(schema.communityLineups)
      .set(values)
      .where(eq(schema.communityLineups.id, id));

    const nextPhase = getNextPhase(dto.status);
    if (nextPhase && phaseDeadline) {
      await this.phaseQueue.scheduleTransition(
        id,
        nextPhase,
        phaseDeadline.getTime() - Date.now(),
      );
    }
  }

  /** Run the matching algorithm (wrapped in try/catch so it never blocks). */
  private async runMatchingAlgorithm(lineupId: number): Promise<void> {
    try {
      await buildMatchesForLineup(this.db, lineupId);
    } catch (err: unknown) {
      // Log error but don't block the phase transition
      const msg = err instanceof Error ? err.message : String(err);

      console.error(`Matching failed for lineup ${lineupId}: ${msg}`);
    }
  }

  /** Validate a status transition is legal. */
  private validateTransition(
    current: LineupStatus,
    dto: UpdateLineupStatusDto,
  ) {
    const isForward = VALID_TRANSITIONS[current] === dto.status;
    const isReverse = VALID_REVERSIONS[current] === dto.status;
    if (!isForward && !isReverse) {
      throw new BadRequestException(
        `Cannot transition from '${current}' to '${dto.status}'`,
      );
    }
  }

  /** Validate the decided game exists in the lineup entries. */
  private async validateDecidedGame(lineupId: number, gameId: number) {
    const entries = await this.db
      .select({ gameId: schema.communityLineupEntries.gameId })
      .from(schema.communityLineupEntries)
      .where(eq(schema.communityLineupEntries.lineupId, lineupId));
    if (!entries.some((e) => e.gameId === gameId)) {
      throw new BadRequestException('Game must be in lineup entries');
    }
  }
}
