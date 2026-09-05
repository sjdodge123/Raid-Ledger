/**
 * ROK-1374 — tiebreaker row lifecycle helpers, extracted from
 * `TiebreakerService` (which sat at exactly 300/300 counted lines, the ESLint
 * `max-lines` error boundary, leaving zero room for the pick endpoints).
 *
 * Pure relocation: every function below is the byte-equivalent body of the
 * private method it replaced, with `this.db` promoted to a leading `db`
 * parameter. No behaviour changed, no call site gained or lost a step.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { StartTiebreakerDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;
type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;

/** Tiebreaker row status values, mirroring the column's check constraint. */
export type TiebreakerStatus = 'pending' | 'active' | 'resolved' | 'dismissed';

/** Load a lineup and assert it is still in `voting`. Throws 404 / 400. */
export async function findAndValidateLineup(
  db: Db,
  lineupId: number,
): Promise<LineupRow> {
  const [lineup] = await db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status !== 'voting') {
    throw new BadRequestException('Lineup must be in voting status');
  }
  return lineup;
}

/** E9: one tiebreaker at a time per lineup. */
export function assertNoActiveTiebreaker(lineup: LineupRow): void {
  if (lineup.activeTiebreakerId) {
    throw new BadRequestException('A tiebreaker is already active');
  }
}

/** Insert the tiebreaker row in `pending`, returning the inserted row. */
export function insertTiebreaker(
  db: Db,
  lineupId: number,
  dto: StartTiebreakerDto,
  tiedGameIds: number[],
  voteCount: number,
): Promise<TiebreakerRow[]> {
  const deadline = dto.roundDurationHours
    ? new Date(Date.now() + dto.roundDurationHours * 3_600_000)
    : null;

  return db
    .insert(schema.communityLineupTiebreakers)
    .values({
      lineupId,
      mode: dto.mode,
      status: 'pending',
      tiedGameIds,
      originalVoteCount: voteCount,
      roundDeadline: deadline,
    })
    .returning();
}

/** Point the lineup at its active tiebreaker. */
export async function linkTiebreakerToLineup(
  db: Db,
  lineupId: number,
  tiebreakerId: number,
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({ activeTiebreakerId: tiebreakerId, updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}

/** Move a tiebreaker row between statuses, stamping `resolvedAt` on resolve. */
export async function updateTiebreakerStatus(
  db: Db,
  tiebreakerId: number,
  status: TiebreakerStatus,
): Promise<void> {
  await db
    .update(schema.communityLineupTiebreakers)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
    })
    .where(eq(schema.communityLineupTiebreakers.id, tiebreakerId));
}

/** Detach the active tiebreaker without changing the lineup phase. */
export async function clearActiveTiebreaker(
  db: Db,
  lineupId: number,
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({ activeTiebreakerId: null, updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}

/** Mark a tiebreaker resolved with its winning game. */
export async function resolveTiebreaker(
  db: Db,
  tiebreakerId: number,
  winnerId: number,
): Promise<void> {
  await db
    .update(schema.communityLineupTiebreakers)
    .set({
      status: 'resolved',
      winnerGameId: winnerId,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.communityLineupTiebreakers.id, tiebreakerId));
}
