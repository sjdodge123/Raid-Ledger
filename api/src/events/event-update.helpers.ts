/**
 * Helpers for event update operations.
 */
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { UpdateEventDto } from '@raid-ledger/contract';

type EventSelect = typeof schema.events.$inferSelect;

/** Finds an existing event or throws NotFoundException. */
export async function findExistingEvent(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<EventSelect> {
  const [existing] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .limit(1);
  if (!existing) {
    throw new NotFoundException(`Event with ID ${id} not found`);
  }
  return existing;
}

/** Asserts the user is the creator or an admin. */
export function assertCanUpdate(
  event: EventSelect,
  userId: number,
  isAdmin: boolean,
): void {
  if (event.creatorId !== userId && !isAdmin) {
    throw new ForbiddenException('You can only update your own events');
  }
}

/** Builds the update data record from the DTO. */
export function buildUpdateData(
  dto: UpdateEventDto,
  existing: EventSelect,
): Record<string, unknown> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.title !== undefined) updateData.title = dto.title;
  if (dto.description !== undefined) updateData.description = dto.description;
  if (dto.gameId !== undefined) updateData.gameId = dto.gameId ?? null;
  if (dto.slotConfig !== undefined) updateData.slotConfig = dto.slotConfig;
  if (dto.maxAttendees !== undefined)
    updateData.maxAttendees = dto.maxAttendees;
  if (dto.autoUnbench !== undefined) updateData.autoUnbench = dto.autoUnbench;
  if (dto.contentInstances !== undefined)
    updateData.contentInstances = dto.contentInstances;
  if (dto.reminder15min !== undefined)
    updateData.reminder15min = dto.reminder15min;
  if (dto.reminder1hour !== undefined)
    updateData.reminder1hour = dto.reminder1hour;
  if (dto.reminder24hour !== undefined)
    updateData.reminder24hour = dto.reminder24hour;
  if (dto.startTime || dto.endTime) {
    updateData.duration = resolveDuration(dto, existing);
  }
  return updateData;
}

/** Resolves the new duration from DTO and existing event. */
function resolveDuration(
  dto: UpdateEventDto,
  existing: EventSelect,
): [Date, Date] {
  const currentDuration = existing.duration;
  const startTime = dto.startTime
    ? new Date(dto.startTime)
    : currentDuration[0];
  const endTime = dto.endTime ? new Date(dto.endTime) : currentDuration[1];
  if (startTime >= endTime) {
    throw new BadRequestException('Start time must be before end time');
  }
  return [startTime, endTime];
}
