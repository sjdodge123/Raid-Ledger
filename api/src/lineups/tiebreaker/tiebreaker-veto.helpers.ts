/**
 * Veto tiebreaker helpers (ROK-938).
 * Submit vetoes, check completion, reveal, find survivor.
 */
import { eq } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { findVetoes, findUserVeto } from './tiebreaker-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;

/**
 * Submit a blind veto. Cap: tiedGameIds.length - 1 total vetoes.
 * First N-1 to submit get theirs.
 */
export async function submitVeto(
  db: Db,
  tiebreaker: TiebreakerRow,
  userId: number,
  gameId: number,
): Promise<void> {
  const tiedGameIds = tiebreaker.tiedGameIds;
  if (!tiedGameIds.includes(gameId)) {
    throw new BadRequestException('Game is not in the tiebreaker');
  }

  await db.transaction(async (tx) => {
    const existing = await findUserVeto(tx, tiebreaker.id, userId);
    if (existing.length > 0) {
      throw new BadRequestException('You have already submitted a veto');
    }

    const vetoes = await findVetoes(tx, tiebreaker.id);
    const cap = tiedGameIds.length - 1;
    if (vetoes.length >= cap) {
      throw new BadRequestException('Veto cap reached');
    }

    await tx
      .insert(schema.communityLineupTiebreakerVetoes)
      .values({ tiebreakerId: tiebreaker.id, userId, gameId });
  });
}

/** Reveal all vetoes (set revealed=true). */
export async function revealVetoes(
  db: Db,
  tiebreakerId: number,
): Promise<void> {
  await db
    .update(schema.communityLineupTiebreakerVetoes)
    .set({ revealed: true })
    .where(
      eq(schema.communityLineupTiebreakerVetoes.tiebreakerId, tiebreakerId),
    );
}

/**
 * Find the surviving game after veto reveal.
 * Eliminates most-vetoed games. Tiebreak by original vote count.
 * Returns the gameId of the survivor.
 */
export function findSurvivor(
  tiedGameIds: number[],
  vetoes: { gameId: number }[],
): number {
  const vetoCounts = new Map<number, number>();
  for (const gid of tiedGameIds) vetoCounts.set(gid, 0);
  for (const v of vetoes) {
    vetoCounts.set(v.gameId, (vetoCounts.get(v.gameId) ?? 0) + 1);
  }

  // Sort by veto count ascending (fewest vetoes = survivor)
  const sorted = [...vetoCounts.entries()].sort((a, b) => a[1] - b[1]);
  return sorted[0][0];
}

/** Build veto status for the response. */
export async function buildVetoStatus(
  db: Db,
  tiebreaker: TiebreakerRow,
  userId?: number,
  gameNames?: Map<number, { name: string; coverUrl: string | null }>,
) {
  const tiedGameIds = tiebreaker.tiedGameIds;
  const vetoes = await findVetoes(db, tiebreaker.id);
  const isResolved = tiebreaker.status === 'resolved';
  const isRevealed = isResolved || vetoes.some((v) => v.revealed);
  const vetoCap = tiedGameIds.length - 1;

  const userVeto = userId ? vetoes.find((v) => v.userId === userId) : undefined;

  const survivorId = isRevealed ? findSurvivor(tiedGameIds, vetoes) : null;

  const vetoCountMap = new Map<number, number>();
  for (const gid of tiedGameIds) vetoCountMap.set(gid, 0);
  for (const v of vetoes) {
    vetoCountMap.set(v.gameId, (vetoCountMap.get(v.gameId) ?? 0) + 1);
  }

  const games = tiedGameIds.map((gid) => ({
    gameId: gid,
    gameName: gameNames?.get(gid)?.name ?? `Game ${gid}`,
    gameCoverUrl: gameNames?.get(gid)?.coverUrl ?? null,
    vetoCount: isRevealed ? (vetoCountMap.get(gid) ?? 0) : 0,
    isEliminated: isRevealed ? gid !== survivorId : false,
    isWinner: isRevealed ? gid === survivorId : false,
  }));

  return {
    games,
    totalVetoes: vetoes.length,
    vetoCap,
    revealed: isRevealed,
    myVetoGameId: userVeto?.gameId ?? null,
    survivorGameId: survivorId,
  };
}
