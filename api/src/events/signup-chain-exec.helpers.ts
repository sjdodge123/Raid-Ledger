/**
 * Chain move execution helpers for signup auto-allocation.
 * Applies BFS chain rearrangement moves to the database.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { type ChainResult } from './signup-chain.helpers';
import { insertAssignment, confirmSignup } from './signup-allocation.helpers';

const logger = new Logger('SignupAllocation');

/** Computes the new position for a chain move. */
function applyChainMove(
  move: { fromRole: string; toRole: string; position: number },
  nextMove: { fromRole: string; position: number } | null,
  occupied: Record<string, Set<number>>,
  filledPerRole: Record<string, number>,
  findPos: (role: string) => number,
): number {
  const newPos =
    nextMove?.fromRole === move.toRole
      ? nextMove.position
      : findPos(move.toRole);
  occupied[move.fromRole]?.delete(move.position);
  occupied[move.toRole]?.add(newPos);
  if (!nextMove || nextMove.fromRole !== move.toRole) {
    filledPerRole[move.toRole]++;
  }
  return newPos;
}

/** Persists chain rearrangement moves in reverse order. */
async function persistChainMoves(
  tx: PostgresJsDatabase<typeof schema>,
  chain: ChainResult,
  occupied: Record<string, Set<number>>,
  filledPerRole: Record<string, number>,
  findPos: (role: string) => number,
): Promise<void> {
  for (let i = chain.moves.length - 1; i >= 0; i--) {
    const move = chain.moves[i];
    const nextMove = i < chain.moves.length - 1 ? chain.moves[i + 1] : null;
    const newPos = applyChainMove(
      move,
      nextMove,
      occupied,
      filledPerRole,
      findPos,
    );
    await tx
      .update(schema.rosterAssignments)
      .set({ role: move.toRole, position: newPos })
      .where(eq(schema.rosterAssignments.id, move.assignmentId));
    logger.log(
      `Chain rearrange: signup ${move.signupId} moved from ${move.fromRole} to ${move.toRole} slot ${newPos}`,
    );
  }
}

/** Finalizes chain allocation by inserting the new signup into the freed slot. */
async function finalizeChainAllocation(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  chain: ChainResult,
  benchPromo: BenchPromotionService,
): Promise<void> {
  const { freedRole } = chain;
  const freedPosition = chain.moves[0].position;
  await insertAssignment(tx, eventId, newSignupId, freedRole, freedPosition);
  await confirmSignup(tx, newSignupId);
  logger.log(
    `Auto-allocated signup ${newSignupId} to ${freedRole} slot ${freedPosition} (chain rearrangement)`,
  );
  await benchPromo.cancelPromotion(eventId, freedRole, freedPosition);
}

/** Executes chain rearrangement moves and places the new signup. */
export async function executeChainMoves(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  chain: ChainResult,
  occupied: Record<string, Set<number>>,
  filledPerRole: Record<string, number>,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): Promise<void> {
  await persistChainMoves(tx, chain, occupied, filledPerRole, findPos);
  await finalizeChainAllocation(tx, eventId, newSignupId, chain, benchPromo);
}
