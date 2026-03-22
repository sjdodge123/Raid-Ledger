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
  CreateLineupDto,
  LineupDetailResponseDto,
  LineupEntryResponseDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import {
  findActiveLineup,
  findLineupById,
  findEntriesWithGames,
  countVotesPerGame,
  countDistinctVoters,
  findUserById,
  findGameName,
  VALID_TRANSITIONS,
} from './lineups-query.helpers';

@Injectable()
export class LineupsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
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

    return this.buildDetailResponse(row.id);
  }

  /** Get the currently active lineup (building or voting). */
  async findActive(): Promise<LineupDetailResponseDto> {
    const [row] = await findActiveLineup(this.db);
    if (!row) {
      throw new NotFoundException('No active lineup');
    }
    return this.buildDetailResponse(row.id);
  }

  /** Get a lineup by ID with full detail. */
  async findById(id: number): Promise<LineupDetailResponseDto> {
    return this.buildDetailResponse(id);
  }

  /** Transition a lineup to a new status. */
  async transitionStatus(
    id: number,
    dto: UpdateLineupStatusDto,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, id);
    if (!lineup) {
      throw new NotFoundException('Lineup not found');
    }

    const currentStatus = lineup.status as LineupStatus;
    this.validateTransition(currentStatus, dto);

    if (dto.status === 'decided' && dto.decidedGameId) {
      await this.validateDecidedGame(id, dto.decidedGameId);
    }

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

    return this.buildDetailResponse(id);
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

  /** Assemble the full detail response for a lineup. */
  private async buildDetailResponse(
    lineupId: number,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');

    const [entries, voteCounts, voterCount, creator, decidedGame] =
      await Promise.all([
        findEntriesWithGames(this.db, lineupId),
        countVotesPerGame(this.db, lineupId),
        countDistinctVoters(this.db, lineupId),
        findUserById(this.db, lineup.createdBy),
        lineup.decidedGameId
          ? findGameName(this.db, lineup.decidedGameId)
          : Promise.resolve([]),
      ]);

    return this.mapToDetailResponse(
      lineup,
      entries,
      voteCounts,
      voterCount,
      creator,
      decidedGame,
    );
  }

  /** Map raw query results to the detail response shape. */
  private mapToDetailResponse(
    lineup: typeof schema.communityLineups.$inferSelect,
    entries: Awaited<ReturnType<typeof findEntriesWithGames>>,
    voteCounts: Awaited<ReturnType<typeof countVotesPerGame>>,
    voterCount: Awaited<ReturnType<typeof countDistinctVoters>>,
    creator: Awaited<ReturnType<typeof findUserById>>,
    decidedGame: Awaited<ReturnType<typeof findGameName>>,
  ): LineupDetailResponseDto {
    const voteMap = new Map(voteCounts.map((v) => [v.gameId, v.voteCount]));
    return {
      id: lineup.id,
      status: lineup.status,
      targetDate: lineup.targetDate?.toISOString() ?? null,
      decidedGameId: lineup.decidedGameId,
      decidedGameName: decidedGame[0]?.name ?? null,
      linkedEventId: lineup.linkedEventId,
      createdBy: creator[0] ?? { id: lineup.createdBy, displayName: 'Unknown' },
      votingDeadline: lineup.votingDeadline?.toISOString() ?? null,
      entries: entries.map((e) => this.mapEntry(e, voteMap)),
      totalVoters: voterCount[0]?.total ?? 0,
      createdAt: lineup.createdAt.toISOString(),
      updatedAt: lineup.updatedAt.toISOString(),
    };
  }

  /** Map a single entry row to the response shape. */
  private mapEntry(
    e: Awaited<ReturnType<typeof findEntriesWithGames>>[0],
    voteMap: Map<number, number>,
  ): LineupEntryResponseDto {
    return {
      id: e.id,
      gameId: e.gameId,
      gameName: e.gameName,
      gameCoverUrl: e.gameCoverUrl,
      nominatedBy: { id: e.nominatedById, displayName: e.nominatedByName },
      note: e.note,
      carriedOver: e.carriedOverFrom !== null,
      voteCount: voteMap.get(e.gameId) ?? 0,
      createdAt: e.createdAt.toISOString(),
    };
  }
}
