import {
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { eq, and, sql, asc } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
    AvailabilityDto,
    AvailabilityListResponseDto,
    AvailabilityWithConflicts,
    AvailabilityConflict,
    CreateAvailabilityInput,
    UpdateAvailabilityDto,
} from '@raid-ledger/contract';

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
    ) { }

    /**
     * Get all availability windows for a user.
     * @param userId - User ID
     * @param options - Optional filters (from, to, gameId, status)
     * @returns List of availability windows
     */
    async findAllForUser(
        userId: number,
        options?: {
            from?: string;
            to?: string;
            gameId?: string;
            status?: string;
        },
    ): Promise<AvailabilityListResponseDto> {
        let query = this.db
            .select()
            .from(schema.availability)
            .where(eq(schema.availability.userId, userId))
            .orderBy(asc(schema.availability.createdAt));

        // Apply time range filter if provided
        if (options?.from && options?.to) {
            const fromDate = new Date(options.from);
            const toDate = new Date(options.to);
            const rangeStr = `[${fromDate.toISOString()},${toDate.toISOString()})`;

            query = this.db
                .select()
                .from(schema.availability)
                .where(
                    and(
                        eq(schema.availability.userId, userId),
                        sql`${schema.availability.timeRange} && ${rangeStr}::tsrange`,
                    ),
                )
                .orderBy(asc(schema.availability.createdAt));
        }

        const windows = await query;

        return {
            data: windows.map(this.mapToDto),
            meta: { total: windows.length },
        };
    }

    /**
     * Get a single availability window by ID.
     * @param userId - User ID (for ownership check)
     * @param availabilityId - Availability window ID
     * @returns Availability DTO
     * @throws NotFoundException if not found
     * @throws ForbiddenException if not owned by user
     */
    async findOne(userId: number, availabilityId: string): Promise<AvailabilityDto> {
        const [window] = await this.db
            .select()
            .from(schema.availability)
            .where(eq(schema.availability.id, availabilityId))
            .limit(1);

        if (!window) {
            throw new NotFoundException(`Availability window ${availabilityId} not found`);
        }

        if (window.userId !== userId) {
            throw new ForbiddenException('You do not own this availability window');
        }

        return this.mapToDto(window);
    }

    /**
     * Create a new availability window.
     * Checks for conflicts with existing committed/blocked slots.
     * @param userId - User ID
     * @param dto - Creation data
     * @returns Created availability with any detected conflicts
     */
    async create(
        userId: number,
        dto: CreateAvailabilityInput,
    ): Promise<AvailabilityWithConflicts> {
        const startTime = new Date(dto.startTime);
        const endTime = new Date(dto.endTime);
        const timeRange: [Date, Date] = [startTime, endTime];

        // Check for conflicts before creating
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

        this.logger.log(
            `User ${userId} created availability window ${created.id} (${dto.status ?? 'available'})`,
        );

        const result = this.mapToDto(created);
        return {
            ...result,
            conflicts: conflicts.length > 0 ? conflicts : undefined,
        };
    }

    /**
     * Update an existing availability window.
     * @param userId - User ID (for ownership check)
     * @param availabilityId - Availability window ID
     * @param dto - Update data
     * @returns Updated availability with any new conflicts
     */
    async update(
        userId: number,
        availabilityId: string,
        dto: UpdateAvailabilityDto,
    ): Promise<AvailabilityWithConflicts> {
        // Verify ownership
        const existing = await this.findOne(userId, availabilityId);

        // Build update object
        const updateData: Partial<typeof schema.availability.$inferInsert> = {
            updatedAt: new Date(),
        };

        // Handle time range update
        let newStartTime = existing.timeRange.start;
        let newEndTime = existing.timeRange.end;

        if (dto.startTime) {
            newStartTime = dto.startTime;
        }
        if (dto.endTime) {
            newEndTime = dto.endTime;
        }

        if (dto.startTime || dto.endTime) {
            updateData.timeRange = [new Date(newStartTime), new Date(newEndTime)];
        }

        if (dto.status) {
            updateData.status = dto.status;
        }

        if (dto.gameId !== undefined) {
            updateData.gameId = dto.gameId;
        }

        // Check for conflicts with new time range
        const conflicts = await this.checkConflicts(
            userId,
            newStartTime,
            newEndTime,
            dto.gameId ?? existing.gameId ?? undefined,
            availabilityId, // Exclude self from conflict check
        );

        const [updated] = await this.db
            .update(schema.availability)
            .set(updateData)
            .where(eq(schema.availability.id, availabilityId))
            .returning();

        this.logger.log(`User ${userId} updated availability window ${availabilityId}`);

        const result = this.mapToDto(updated);
        return {
            ...result,
            conflicts: conflicts.length > 0 ? conflicts : undefined,
        };
    }

    /**
     * Delete an availability window.
     * @param userId - User ID (for ownership check)
     * @param availabilityId - Availability window ID
     */
    async delete(userId: number, availabilityId: string): Promise<void> {
        // Verify ownership
        await this.findOne(userId, availabilityId);

        await this.db
            .delete(schema.availability)
            .where(eq(schema.availability.id, availabilityId));

        this.logger.log(`User ${userId} deleted availability window ${availabilityId}`);
    }

    /**
     * Check for overlapping availability windows with committed/blocked status.
     * @param userId - User ID
     * @param startTime - Start of time range to check
     * @param endTime - End of time range to check
     * @param excludeGameId - Optional: exclude conflicts for a specific game
     * @param excludeId - Optional: exclude a specific window (for updates)
     * @returns List of conflicting windows
     */
    async checkConflicts(
        userId: number,
        startTime: string,
        endTime: string,
        excludeGameId?: string,
        excludeId?: string,
    ): Promise<AvailabilityConflict[]> {
        const rangeStr = `[${new Date(startTime).toISOString()},${new Date(endTime).toISOString()})`;

        // Find overlapping windows that are committed or blocked
        let conflictQuery = this.db
            .select()
            .from(schema.availability)
            .where(
                and(
                    eq(schema.availability.userId, userId),
                    sql`${schema.availability.timeRange} && ${rangeStr}::tsrange`,
                    sql`${schema.availability.status} IN ('committed', 'blocked')`,
                ),
            );

        const conflicts = await conflictQuery;

        // Filter out excluded window and game-specific conflicts
        return conflicts
            .filter((c) => {
                if (excludeId && c.id === excludeId) return false;
                // If excludeGameId is set, exclude conflicts for that specific game
                // (allows game-specific availability to overlap with other games)
                if (excludeGameId && c.gameId === excludeGameId) return false;
                return true;
            })
            .map((c) => ({
                conflictingId: c.id,
                timeRange: {
                    start: c.timeRange[0].toISOString(),
                    end: c.timeRange[1].toISOString(),
                },
                status: c.status as 'available' | 'committed' | 'blocked' | 'freed',
                gameId: c.gameId,
            }));
    }

    /**
     * Find availability windows for multiple users in a time range.
     * Used by heatmap component (ROK-113).
     * @param userIds - List of user IDs
     * @param startTime - Start of time range
     * @param endTime - End of time range
     * @returns Map of userId to their availability windows
     */
    async findForUsersInRange(
        userIds: number[],
        startTime: string,
        endTime: string,
    ): Promise<Map<number, AvailabilityDto[]>> {
        if (userIds.length === 0) {
            return new Map();
        }

        const rangeStr = `[${new Date(startTime).toISOString()},${new Date(endTime).toISOString()})`;

        const windows = await this.db
            .select()
            .from(schema.availability)
            .where(
                and(
                    sql`${schema.availability.userId} = ANY(${userIds})`,
                    sql`${schema.availability.timeRange} && ${rangeStr}::tsrange`,
                ),
            );

        const result = new Map<number, AvailabilityDto[]>();
        for (const window of windows) {
            const existing = result.get(window.userId) || [];
            existing.push(this.mapToDto(window));
            result.set(window.userId, existing);
        }

        return result;
    }

    /**
     * Map database row to DTO.
     */
    private mapToDto(row: typeof schema.availability.$inferSelect): AvailabilityDto {
        return {
            id: row.id,
            userId: row.userId,
            timeRange: {
                start: row.timeRange[0].toISOString(),
                end: row.timeRange[1].toISOString(),
            },
            status: row.status as 'available' | 'committed' | 'blocked' | 'freed',
            gameId: row.gameId,
            sourceEventId: row.sourceEventId,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }
}
