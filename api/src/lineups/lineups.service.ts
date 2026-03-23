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
  countLineupEntries,
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

    await this.validateNominationCap(lineupId);
    await this.validateGameExists(dto.gameId);
    await this.insertNomination(lineupId, dto, userId);
    return buildDetailResponse(this.db, lineupId);
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

  /** Insert a nomination entry, handling duplicate conflicts. */
  private async insertNomination(
    lineupId: number,
    dto: NominateGameDto,
    userId: number,
  ) {
    try {
      await this.db.insert(schema.communityLineupEntries).values({
        lineupId,
        gameId: dto.gameId,
        nominatedBy: userId,
        note: dto.note ?? null,
      });
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('Game already nominated in this lineup');
      }
      throw err;
    }
    const [game] = await findGameName(this.db, dto.gameId);
    void this.activityLog.log('lineup', lineupId, 'game_nominated', userId, {
      gameId: dto.gameId,
      gameName: game?.name ?? 'Unknown',
      note: dto.note ?? null,
    });
  }

  /** Enforce the 20-entry cap for a lineup. */
  private async validateNominationCap(lineupId: number): Promise<void> {
    const [result] = await countLineupEntries(this.db, lineupId);
    if (result && result.count >= MAX_LINEUP_ENTRIES) {
      throw new BadRequestException('Lineup has reached the 20-entry cap');
    }
  }

  /** Validate that a game exists in the database. */
  private async validateGameExists(gameId: number): Promise<void> {
    const [game] = await findGameName(this.db, gameId);
    if (!game) throw new NotFoundException('Game not found');
  }

  /** Check if a DB error is a unique constraint violation. */
  private isUniqueViolation(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as Record<string, unknown>;
    if (e.code === '23505') return true;
    if (e.cause && typeof e.cause === 'object') {
      return (e.cause as Record<string, unknown>).code === '23505';
    }
    return false;
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
