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
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { fireLineupMetadataRefresh } from './lineups-notify-hooks.helpers';
import { applyNominationTargetEdit } from './quorum/nomination-target.helpers';
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

/**
 * Title/description write plus the target edit, on the locked row. True when
 * the target edit wrote (and so retired any grace claim).
 */
async function persistMetadata(
  tx: Tx,
  lineup: LineupRow,
  dto: UpdateLineupMetadataDto,
): Promise<boolean> {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.title !== undefined) values.title = dto.title;
  if (dto.description !== undefined) values.description = dto.description;
  await tx
    .update(schema.communityLineups)
    .set(values)
    .where(eq(schema.communityLineups.id, lineup.id));
  if (dto.nominationTargetPct === undefined) return false;
  return applyNominationTargetEdit(tx, lineup, dto.nominationTargetPct);
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
 * Resolves true when the target edit wrote (the grace claim is retired).
 */
export async function authorizeAndPersistMetadata(
  db: Db,
  id: number,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [lineup] = await lockLineupForEdit(tx, id);
    assertMetadataEditable(lineup, dto, caller);
    return persistMetadata(tx, lineup, dto);
  });
}

/**
 * High-level metadata update: authorise, persist, fire notification refresh,
 * and return the fresh detail payload. A target edit retired the grace claim
 * in its transaction; the queued grace job is removed only AFTER commit (a
 * queue call cannot roll back), and `cancelGraceAdvance` swallows its own
 * failure — the surviving job then finds no claim and does nothing.
 */
export async function runMetadataUpdate(
  db: Db,
  lineupNotifications: LineupNotificationService,
  phaseQueue: Pick<LineupPhaseQueueService, 'cancelGraceAdvance'>,
  logger: Logger,
  id: number,
  dto: UpdateLineupMetadataDto,
  caller: CallerIdentity,
): Promise<LineupDetailResponseDto> {
  const targetEdited = await authorizeAndPersistMetadata(db, id, dto, caller);
  if (targetEdited) await phaseQueue.cancelGraceAdvance(id);
  const detail = await buildDetailResponse(db, id, caller.id);
  fireLineupMetadataRefresh(lineupNotifications, logger, {
    id: detail.id,
    title: detail.title,
    description: detail.description,
  });
  return detail;
}
