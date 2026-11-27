/**
 * Metadata update helpers for community lineups (ROK-1063, ROK-1710).
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
import { applyNominationTargetEdit } from './quorum/nomination-target.helpers';
import type { CallerIdentity } from './lineups.service';

type Db = PostgresJsDatabase<typeof schema>;

type LineupRow = typeof schema.communityLineups.$inferSelect;

/**
 * Guards in the canonical order — existence, then authorisation, then state
 * (ROK-1077 item 3). Checking `archived` first told a non-creator that a
 * lineup was archived (409) before telling them they may not edit it (403),
 * leaking state to a caller who has no write claim on the row.
 *
 * - NotFoundException when the lineup does not exist.
 * - ForbiddenException (403) when the caller is not admin/operator and is not
 *   the original creator.
 * - ConflictException (409) when the lineup is archived.
 * - ConflictException (409) when the body changes the nomination target and
 *   the lineup is not `building` (ROK-1710). Checked before ANY write so a
 *   mixed title + target body fails as a whole.
 */
function assertMetadataEditable(
  lineup: LineupRow | undefined,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): asserts lineup is LineupRow {
  if (!lineup) throw new NotFoundException('Lineup not found');
  const isPrivileged = caller.role === 'admin' || caller.role === 'operator';
  if (!isPrivileged && lineup.createdBy !== caller.id) {
    throw new ForbiddenException('Not allowed to edit this lineup');
  }
  if (lineup.status === 'archived') {
    throw new ConflictException('Cannot edit an archived lineup');
  }
  if (dto.nominationTargetPct !== undefined && lineup.status !== 'building') {
    throw new ConflictException(
      'Nomination target can only be changed while nominating',
    );
  }
}

/**
 * Authorise a metadata update and persist the change (ROK-1063, ROK-1710).
 *
 * See `assertMetadataEditable` for the guard order. A target edit goes through
 * `applyNominationTargetEdit`, which owns the re-arm rule. Always bumps
 * `updated_at` to match other lineup updates.
 */
export async function authorizeAndPersistMetadata(
  db: Db,
  id: number,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): Promise<void> {
  const [lineup] = await findLineupById(db, id);
  assertMetadataEditable(lineup, dto, caller);

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.title !== undefined) values.title = dto.title;
  if (dto.description !== undefined) values.description = dto.description;
  await db
    .update(schema.communityLineups)
    .set(values)
    .where(eq(schema.communityLineups.id, id));
  if (dto.nominationTargetPct !== undefined) {
    await applyNominationTargetEdit(db, lineup, dto.nominationTargetPct);
  }
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
