/**
 * Pure helper functions for availability service.
 */
import { BadRequestException } from '@nestjs/common';
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

/** Longest window the create schema allows (`CreateAvailabilityInputSchema`). */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Enforce the create path's rules on a merged update range: end after start
 * and at most 24 hours. A PATCH carrying one bound skips the schema refine.
 * @throws BadRequestException when the merged range is inverted or too long.
 */
function assertValidWindow(startTime: string, endTime: string): void {
  const spanMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (!(spanMs > 0)) {
    throw new BadRequestException('End time must be after start time');
  }
  if (spanMs > MAX_WINDOW_MS) {
    throw new BadRequestException('Availability window cannot exceed 24 hours');
  }
}

/**
 * Build update data from existing availability and DTO.
 * @throws BadRequestException when a sent bound leaves an invalid window.
 */
export function buildUpdateData(
  existing: AvailabilityDto,
  dto: {
    startTime?: string | undefined;
    endTime?: string | undefined;
    status?: string | undefined;
    gameId?: number | null | undefined;
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
    assertValidWindow(newStartTime, newEndTime);
    updateData.timeRange = [new Date(newStartTime), new Date(newEndTime)];
  }
  if (dto.status) updateData.status = dto.status;
  if (dto.gameId !== undefined) updateData.gameId = dto.gameId;
  return { updateData, newStartTime, newEndTime };
}
