/**
 * Metadata update helpers for community lineups (ROK-1063).
 * Keeps lineups.service.ts under the 300-line file limit.
 */
import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  LineupDetailResponseDto,
  UpdateLineupMetadataDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { findLineupById } from './lineups-query.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import type { LineupNotificationService } from './lineup-notification.service';
import { fireLineupMetadataRefresh } from './lineups-notify-hooks.helpers';
import type { CallerIdentity } from './lineups.service';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Authorise a metadata update and persist the change (ROK-1063).
 *
 * - Throws NotFoundException when the lineup does not exist.
 * - Throws ConflictException (409) when the lineup is archived.
 * - Throws ForbiddenException (403) when the caller is not admin/operator
 *   and is not the original creator.
 *
 * Always bumps `updated_at` to match other lineup updates.
 */
export async function authorizeAndPersistMetadata(
  db: Db,
  id: number,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): Promise<void> {
  const [lineup] = await findLineupById(db, id);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status === 'archived') {
    throw new ConflictException('Cannot edit an archived lineup');
  }
  const isPrivileged = caller.role === 'admin' || caller.role === 'operator';
  if (!isPrivileged && lineup.createdBy !== caller.id) {
    throw new ForbiddenException('Not allowed to edit this lineup');
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.title !== undefined) values.title = dto.title;
  if (dto.description !== undefined) values.description = dto.description;
  await db
    .update(schema.communityLineups)
    .set(values)
    .where(eq(schema.communityLineups.id, id));
}

/**
 * High-level metadata update: authorise, persist, fire notification refresh,
 * and return the fresh detail payload.
 */
export async function runMetadataUpdate(
  db: Db,
  lineupNotifications: LineupNotificationService,
  logger: Logger,
  id: number,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): Promise<LineupDetailResponseDto> {
  await authorizeAndPersistMetadata(db, id, dto, caller);
  const detail = await buildDetailResponse(db, id, caller.id);
  fireLineupMetadataRefresh(lineupNotifications, logger, {
    id: detail.id,
    title: detail.title,
    description: detail.description,
  });
  return detail;
}
