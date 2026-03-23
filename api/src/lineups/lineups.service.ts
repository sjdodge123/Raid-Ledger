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
import {
  findActiveLineup,
  findLineupById,
  findGameName,
  findBuildingLineup,
  findNominatedGameIds,
  findEntriesWithGames,
  countVotesPerGame,
  countDistinctVoters,
  VALID_TRANSITIONS,
} from './lineups-query.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import {
  queryCommonGround,
  mapCommonGroundRow,
} from './common-ground-query.helpers';
import {
  SCORING_WEIGHTS,
  MAX_LINEUP_ENTRIES,
} from './common-ground-scoring.constants';
import {
  countOwnersPerGame,
  countTotalMembers,
} from './lineups-enrichment.helpers';
import {
  findBannerLineup,
  buildBannerResponse,
} from './lineups-banner.helpers';
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
  ) {}

  /** Create a new lineup. Throws 409 if an active lineup already exists. */
  async create(
    dto: CreateLineupDto,
    userId: number,
  ): Promise<LineupDetailResponseDto> {
    const [row] = await this.db.transaction(async (tx) => {
      const [existing] = await findActiveLineup(tx);
      if (existing) {
        throw new ConflictException('A lineup is already active');
      }
      return tx
        .insert(schema.communityLineups)
        .values({
          createdBy: userId,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        })
        .returning();
    });

    void this.activityLog.log('lineup', row.id, 'lineup_created', userId);
    return buildDetailResponse(this.db, row.id);
  }

  /** Get the currently active lineup (building or voting). */
  async findActive(): Promise<LineupDetailResponseDto> {
    const [row] = await findActiveLineup(this.db);
    if (!row) {
      throw new NotFoundException('No active lineup');
    }
    return buildDetailResponse(this.db, row.id);
  }

  /** Get a lineup by ID with full detail. */
  async findById(id: number): Promise<LineupDetailResponseDto> {
    return buildDetailResponse(this.db, id);
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

    await this.applyStatusUpdate(id, dto);
    await this.logTransition(id, dto);
    return buildDetailResponse(this.db, id);
  }

  /** Get Common Ground games — ownership overlap. */
  async getCommonGround(
    filters: CommonGroundQueryDto,
  ): Promise<CommonGroundResponseDto> {
    const [lineup] = await findBuildingLineup(this.db);
    if (!lineup) {
      throw new NotFoundException('No active lineup in building status');
    }

    const nominated = await findNominatedGameIds(this.db, lineup.id);
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
        maxNominations: MAX_LINEUP_ENTRIES,
      },
    };
  }

  /** Nominate a game into a lineup. */
  async nominate(
    lineupId: number,
    dto: NominateGameDto,
    userId: number,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'building') {
      throw new BadRequestException('Lineup is not in building status');
    }

    await validateNominationCap(this.db, lineupId);
    await validateGameExists(this.db, dto.gameId);
    await insertNomination(this.db, lineupId, dto, userId);
    await this.logNomination(lineupId, dto, userId);
    return buildDetailResponse(this.db, lineupId);
  }

  /** Remove a nomination. Members can remove own; operators/admins can remove any. */
  async removeNomination(
    lineupId: number,
    gameId: number,
    caller: CallerIdentity,
  ): Promise<void> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'building') {
      throw new BadRequestException('Can only remove during building');
    }

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

    const entries = await findEntriesWithGames(this.db, lineup.id);
    const gameIds = entries.map((e) => e.gameId);
    const [ownerMap, voteMap, voterCount, totalMembers, decidedGame] =
      await Promise.all([
        countOwnersPerGame(this.db, gameIds),
        countVotesPerGame(this.db, lineup.id),
        countDistinctVoters(this.db, lineup.id),
        countTotalMembers(this.db),
        lineup.decidedGameId
          ? findGameName(this.db, lineup.decidedGameId)
          : Promise.resolve([]),
      ]);

    const vMap = new Map(voteMap.map((v) => [v.gameId, v.voteCount]));
    const bannerEntries = entries.map((e) => ({
      gameId: e.gameId,
      gameName: e.gameName,
      gameCoverUrl: e.gameCoverUrl,
    }));

    return buildBannerResponse(
      { ...lineup, decidedGameName: decidedGame[0]?.name ?? null },
      bannerEntries,
      ownerMap,
      vMap,
      voterCount[0]?.total ?? 0,
      totalMembers,
    );
  }

  /** Apply the status update to the database. */
  private async applyStatusUpdate(id: number, dto: UpdateLineupStatusDto) {
    const values: Partial<typeof schema.communityLineups.$inferInsert> = {
      status: dto.status,
      updatedAt: new Date(),
    };
    if (dto.status === 'voting' && dto.votingDeadline) {
      values.votingDeadline = new Date(dto.votingDeadline);
    }
    if (dto.status === 'decided' && dto.decidedGameId) {
      values.decidedGameId = dto.decidedGameId;
    }
    await this.db
      .update(schema.communityLineups)
      .set(values)
      .where(eq(schema.communityLineups.id, id));
  }

  /** Log activity for a status transition. */
  private async logTransition(id: number, dto: UpdateLineupStatusDto) {
    if (dto.status === 'voting') {
      void this.activityLog.log('lineup', id, 'voting_started', null, {
        votingDeadline: dto.votingDeadline ?? null,
      });
    } else if (dto.status === 'decided' && dto.decidedGameId) {
      const [game] = await findGameName(this.db, dto.decidedGameId);
      void this.activityLog.log('lineup', id, 'lineup_decided', null, {
        gameId: dto.decidedGameId,
        gameName: game?.name ?? 'Unknown',
      });
    }
  }

  /** Log a nomination event. */
  private async logNomination(
    lineupId: number,
    dto: NominateGameDto,
    userId: number,
  ) {
    const [game] = await findGameName(this.db, dto.gameId);
    void this.activityLog.log('lineup', lineupId, 'game_nominated', userId, {
      gameId: dto.gameId,
      gameName: game?.name ?? 'Unknown',
      note: dto.note ?? null,
    });
  }

  /** Validate a status transition is legal. */
  private validateTransition(
    current: LineupStatus,
    dto: UpdateLineupStatusDto,
  ) {
    if (VALID_TRANSITIONS[current] !== dto.status) {
      throw new BadRequestException(
        `Cannot transition from '${current}' to '${dto.status}'`,
      );
    }
    if (dto.status === 'decided' && !dto.decidedGameId) {
      throw new BadRequestException(
        'decidedGameId is required when transitioning to decided',
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
