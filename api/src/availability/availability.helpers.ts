/**
 * Pure helper functions for availability service.
 */
import type {
  AvailabilityDto,
  AvailabilityConflict,
} from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';

type AvailRow = typeof schema.availability.$inferSelect;

/** Map database row to AvailabilityDto. */
export function mapAvailabilityToDto(row: AvailRow): AvailabilityDto {
  return {
    id: row.id,
    userId: row.userId,
    timeRange: {
      start: row.timeRange[0].toISOString(),
      end: row.timeRange[1].toISOString(),
    },
    status: row.status,
    gameId: row.gameId,
    sourceEventId: row.sourceEventId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Build a tsrange string from ISO date strings. */
export function buildRangeStr(startTime: string, endTime: string): string {
  return `[${new Date(startTime).toISOString()},${new Date(endTime).toISOString()})`;
}

/** Filter and map conflict rows to AvailabilityConflict DTOs. */
export function mapConflicts(
  conflicts: AvailRow[],
  excludeId?: string,
  excludeGameId?: number,
): AvailabilityConflict[] {
  return conflicts
    .filter((c) => {
      if (excludeId && c.id === excludeId) return false;
      if (excludeGameId && c.gameId === excludeGameId) return false;
      return true;
    })
    .map((c) => ({
      conflictingId: c.id,
      timeRange: {
        start: c.timeRange[0].toISOString(),
        end: c.timeRange[1].toISOString(),
      },
      status: c.status,
      gameId: c.gameId,
    }));
}

/** Build update data from existing availability and DTO. */
export function buildUpdateData(
  existing: AvailabilityDto,
  dto: {
    startTime?: string;
    endTime?: string;
    status?: string;
    gameId?: number | null;
  },
): {
  updateData: Record<string, unknown>;
  newStartTime: string;
  newEndTime: string;
} {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  const newStartTime = dto.startTime ?? existing.timeRange.start;
  const newEndTime = dto.endTime ?? existing.timeRange.end;
  if (dto.startTime || dto.endTime) {
    updateData.timeRange = [new Date(newStartTime), new Date(newEndTime)];
  }
  if (dto.status) updateData.status = dto.status;
  if (dto.gameId !== undefined) updateData.gameId = dto.gameId;
  return { updateData, newStartTime, newEndTime };
}
