import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, sql, asc, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  AvailabilityDto,
  AvailabilityListResponseDto,
  AvailabilityWithConflicts,
  AvailabilityConflict,
  CreateAvailabilityInput,
  UpdateAvailabilityDto,
} from '@raid-ledger/contract';
import {
  mapAvailabilityToDto,
  buildRangeStr,
  mapConflicts,
  buildUpdateData,
} from './availability.helpers';

/**
 * Service for managing user availability windows (ROK-112).
 * Supports CRUD operations and cross-game conflict detection.
 */
@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Get all availability windows for a user with optional filters. */
  async findAllForUser(
    userId: number,
    options?: { from?: string; to?: string; gameId?: number; status?: string },
  ): Promise<AvailabilityListResponseDto> {
    const conditions = [eq(schema.availability.userId, userId)];
    if (options?.from && options?.to) {
      const rangeStr = buildRangeStr(options.from, options.to);
      conditions.push(
        sql`${schema.availability.timeRange} && ${rangeStr}::tsrange`,
      );
    }
    if (options?.gameId) {
      conditions.push(eq(schema.availability.gameId, options.gameId));
    }
    if (options?.status) {
      conditions.push(sql`${schema.availability.status} = ${options.status}`);
    }
    const windows = await this.db
      .select()
      .from(schema.availability)
      .where(and(...conditions))
      .orderBy(asc(schema.availability.createdAt));
    return {
      data: windows.map((row) => mapAvailabilityToDto(row)),
      meta: { total: windows.length },
    };
  }

  /** Get a single availability window by ID with ownership check. */
  async findOne(
    userId: number,
    availabilityId: string,
  ): Promise<AvailabilityDto> {
    const [window] = await this.db
      .select()
      .from(schema.availability)
      .where(eq(schema.availability.id, availabilityId))
      .limit(1);
    if (!window) {
      throw new NotFoundException(
        `Availability window ${availabilityId} not found`,
      );
    }
    if (window.userId !== userId) {
      throw new ForbiddenException('You do not own this availability window');
    }
    return mapAvailabilityToDto(window);
  }

  /** Create a new availability window with conflict detection. */
  async create(
    userId: number,
    dto: CreateAvailabilityInput,
  ): Promise<AvailabilityWithConflicts> {
    const timeRange: [Date, Date] = [
      new Date(dto.startTime),
      new Date(dto.endTime),
    ];
    const conflicts = await this.checkConflicts(
      userId,
      dto.startTime,
      dto.endTime,
      dto.gameId,
    );
    const [created] = await this.db
      .insert(schema.availability)
      .values({
        userId,
        timeRange,
        status: dto.status ?? 'available',
        gameId: dto.gameId ?? null,
      })
      .returning();
    this.logger.log(`User ${userId} created availability window ${created.id}`);
    return {
      ...mapAvailabilityToDto(created),
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /** Update an existing availability window with conflict detection. */
  async update(
    userId: number,
    availabilityId: string,
    dto: UpdateAvailabilityDto,
  ): Promise<AvailabilityWithConflicts> {
    const existing = await this.findOne(userId, availabilityId);
    const { updateData, newStartTime, newEndTime } = buildUpdateData(
      existing,
      dto,
    );
    const conflicts = await this.checkConflicts(
      userId,
      newStartTime,
      newEndTime,
      dto.gameId ?? existing.gameId ?? undefined,
      availabilityId,
    );
    const [updated] = await this.db
      .update(schema.availability)
      .set(updateData)
      .where(eq(schema.availability.id, availabilityId))
      .returning();
    this.logger.log(
      `User ${userId} updated availability window ${availabilityId}`,
    );
    return {
      ...mapAvailabilityToDto(updated),
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /** Delete an availability window after ownership check. */
  async delete(userId: number, availabilityId: string): Promise<void> {
    await this.findOne(userId, availabilityId);
    await this.db
      .delete(schema.availability)
      .where(eq(schema.availability.id, availabilityId));
    this.logger.log(
      `User ${userId} deleted availability window ${availabilityId}`,
    );
  }

  /** Check for overlapping committed/blocked availability windows. */
  async checkConflicts(
    userId: number,
    startTime: string,
    endTime: string,
    excludeGameId?: number,
    excludeId?: string,
  ): Promise<AvailabilityConflict[]> {
    const rangeStr = buildRangeStr(startTime, endTime);
    const conflicts = await this.db
      .select()
      .from(schema.availability)
      .where(
        and(
          eq(schema.availability.userId, userId),
          sql`${schema.availability.timeRange} && ${rangeStr}::tsrange`,
          sql`${schema.availability.status} IN ('committed', 'blocked')`,
        ),
      );
    return mapConflicts(conflicts, excludeId, excludeGameId);
  }

  /** Find availability windows for multiple users in a time range. */
  async findForUsersInRange(
    userIds: number[],
    startTime: string,
    endTime: string,
  ): Promise<Map<number, AvailabilityDto[]>> {
    if (userIds.length === 0) return new Map();
    const rangeStr = buildRangeStr(startTime, endTime);
    const windows = await this.db
      .select()
      .from(schema.availability)
      .where(
        and(
          inArray(schema.availability.userId, userIds),
          sql`${schema.availability.timeRange} && ${rangeStr}::tsrange`,
        ),
      );
    const result = new Map<number, AvailabilityDto[]>();
    for (const window of windows) {
      const existing = result.get(window.userId) || [];
      existing.push(mapAvailabilityToDto(window));
      result.set(window.userId, existing);
    }
    return result;
  }
}
