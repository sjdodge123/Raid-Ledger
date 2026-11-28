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
import { buildDetailResponse } from './lineups-response.helpers';
import type { LineupNotificationService } from './lineup-notification.service';
import { fireLineupMetadataRefresh } from './lineups-notify-hooks.helpers';
import {
  applyNominationTargetEdit,
  isNominationTargetEditNoop,
  PENDING_ADVANCE_EDIT_MESSAGE,
} from './quorum/nomination-target.helpers';
import type { CallerIdentity } from './lineups.service';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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
 * - ConflictException (409) when the body changes the target while an early
 *   advance is pending (`pendingAdvanceAt` set; ROK-1710 Codex round 3).
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
  if (dto.nominationTargetPct !== undefined) assertTargetEditable(lineup, dto);
}

/**
 * Target-only state gates. The row is read under the edit's lock, and a grace
 * claim is itself an UPDATE of that row, so `pendingAdvanceAt` cannot change
 * between this check and the target write.
 */
function assertTargetEditable(
  lineup: LineupRow,
  dto: UpdateLineupMetadataDto,
): void {
  if (lineup.status !== 'building') {
    throw new ConflictException(
      'Nomination target can only be changed while nominating',
    );
  }
  const nextPct = dto.nominationTargetPct ?? null;
  if (
    lineup.pendingAdvanceAt !== null &&
    !isNominationTargetEditNoop(lineup, nextPct)
  ) {
    throw new ConflictException(PENDING_ADVANCE_EDIT_MESSAGE);
  }
}

/**
 * Read the lineup under a row lock for the rest of the edit transaction.
 * `NO KEY UPDATE` conflicts with a status transition's UPDATE, so the status
 * the guards judge cannot change before the writes commit, but it does not
 * block nominations (their FK insert only takes `KEY SHARE`).
 */
function lockLineupForEdit(tx: Tx, id: number) {
  return tx
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, id))
    .for('no key update');
}

/** Title/description write plus the target edit, on the locked row. */
async function persistMetadata(
  tx: Tx,
  lineup: LineupRow,
  dto: UpdateLineupMetadataDto,
): Promise<void> {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.title !== undefined) values.title = dto.title;
  if (dto.description !== undefined) values.description = dto.description;
  await tx
    .update(schema.communityLineups)
    .set(values)
    .where(eq(schema.communityLineups.id, lineup.id));
  if (dto.nominationTargetPct === undefined) return;
  await applyNominationTargetEdit(tx, lineup, dto.nominationTargetPct);
}

/**
 * Authorise a metadata update and persist the change (ROK-1063, ROK-1710).
 *
 * See `assertMetadataEditable` for the guard order. One transaction holds the
 * row lock from the read to the last write (ROK-1710 review), so:
 * - a `building -> voting` advance cannot slip between the status check and
 *   the target write — it waits, then sees the new state;
 * - the body succeeds or fails as a whole: a 409 or a failed target write
 *   rolls the title back too.
 * A target edit goes through `applyNominationTargetEdit`, which owns the
 * re-arm rule. Always bumps `updated_at` to match other lineup updates.
 */
export async function authorizeAndPersistMetadata(
  db: Db,
  id: number,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [lineup] = await lockLineupForEdit(tx, id);
    assertMetadataEditable(lineup, dto, caller);
    await persistMetadata(tx, lineup, dto);
  });
}

/** What `runMetadataUpdate` needs; the service's auto-advance deps fit. */
export interface MetadataUpdateDeps {
  db: Db;
  lineupNotifications: LineupNotificationService;
  logger: Logger;
}

/**
 * High-level metadata update: authorise, persist, fire notification refresh,
 * and return the fresh detail payload. A target edit never touches a grace
 * claim (it is refused while one is pending), so no queue work follows.
 */
export async function runMetadataUpdate(
  deps: MetadataUpdateDeps,
  id: number,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): Promise<LineupDetailResponseDto> {
  const { db, lineupNotifications, logger } = deps;
  await authorizeAndPersistMetadata(db, id, dto, caller);
  const detail = await buildDetailResponse(db, id, caller.id);
  fireLineupMetadataRefresh(lineupNotifications, logger, {
    id: detail.id,
    title: detail.title,
    description: detail.description,
  });
  return detail;
}
