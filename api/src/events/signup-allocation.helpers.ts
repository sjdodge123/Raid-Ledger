import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import {
  findRearrangementChain,
  type ChainResult,
} from './signup-chain.helpers';
import { displaceTentativeForSlot } from './signup-tentative.helpers';

const logger = new Logger('SignupAllocation');

export { findRearrangementChain } from './signup-chain.helpers';

export function findFirstAvailablePosition(
  occupied: Record<string, Set<number>>,
  role: string,
): number {
  const set = occupied[role] ?? new Set();
  for (let pos = 1; ; pos++) {
    if (!set.has(pos)) return pos;
  }
}

interface AllocationContext {
  newPrefs: string[];
  roleCapacity: Record<string, number>;
  filledPerRole: Record<string, number>;
  occupied: Record<string, Set<number>>;
  currentAssignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  }>;
  allSignups: Array<{
    id: number;
    preferredRoles: string[] | null;
    status: string;
    signedUpAt: Date | null;
  }>;
}

function initRoleCounters(): {
  filledPerRole: Record<string, number>;
  occupied: Record<string, Set<number>>;
} {
  return {
    filledPerRole: { tank: 0, healer: 0, dps: 0 },
    occupied: { tank: new Set(), healer: new Set(), dps: new Set() },
  };
}

function tallyAssignments(
  assignments: Array<{ role: string | null; position: number }>,
  filledPerRole: Record<string, number>,
  occupied: Record<string, Set<number>>,
): void {
  for (const a of assignments) {
    if (a.role && a.role in filledPerRole) {
      filledPerRole[a.role]++;
      occupied[a.role].add(a.position);
    }
  }
}

function resolveNewPrefs(
  allSignups: AllocationContext['allSignups'],
  newSignupId: number,
): string[] | null {
  const newSignup = allSignups.find((s) => s.id === newSignupId);
  if (!newSignup?.preferredRoles || newSignup.preferredRoles.length === 0) return null;
  const rolePriority: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
  return [...newSignup.preferredRoles].sort(
    (a, b) => (rolePriority[a] ?? 99) - (rolePriority[b] ?? 99),
  );
}

async function buildAllocationContext(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  slotConfig: Record<string, unknown> | null,
): Promise<AllocationContext | null> {
  const roleCapacity: Record<string, number> = {
    tank: (slotConfig?.tank as number) ?? 2,
    healer: (slotConfig?.healer as number) ?? 4,
    dps: (slotConfig?.dps as number) ?? 14,
  };

  const [allSignups, currentAssignments] = await Promise.all([
    tx
      .select({
        id: schema.eventSignups.id,
        preferredRoles: schema.eventSignups.preferredRoles,
        status: schema.eventSignups.status,
        signedUpAt: schema.eventSignups.signedUpAt,
      })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId)),
    tx
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId)),
  ]);

  const { filledPerRole, occupied } = initRoleCounters();
  tallyAssignments(currentAssignments, filledPerRole, occupied);

  const newPrefs = resolveNewPrefs(allSignups, newSignupId);
  if (!newPrefs) return null;

  return { newPrefs, roleCapacity, filledPerRole, occupied, currentAssignments, allSignups };
}

async function tryDirectSlot(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  prefs: string[],
  capacity: Record<string, number>,
  filled: Record<string, number>,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): Promise<boolean> {
  for (const role of prefs) {
    if (role in capacity && filled[role] < capacity[role]) {
      const position = findPos(role);
      await insertAssignment(tx, eventId, signupId, role, position);
      await confirmSignup(tx, signupId);
      logger.log(`Auto-allocated signup ${signupId} to ${role} slot ${position} (direct match)`);
      await benchPromo.cancelPromotion(eventId, role, position);
      return true;
    }
  }
  return false;
}

async function tryTentativeDisplacement(
  tx: PostgresJsDatabase<typeof schema>,
  ctx: AllocationContext,
  eventId: number,
  newSignupId: number,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): Promise<boolean> {
  const status = ctx.allSignups.find((s) => s.id === newSignupId)?.status;
  if (status === 'tentative') return false;
  return displaceTentativeForSlot(
    tx, eventId, newSignupId, ctx.newPrefs, ctx.currentAssignments,
    ctx.allSignups, ctx.roleCapacity, ctx.occupied, findPos, benchPromo,
  );
}

export async function autoAllocateSignup(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  slotConfig: Record<string, unknown> | null,
  benchPromo: BenchPromotionService,
): Promise<void> {
  const ctx = await buildAllocationContext(tx, eventId, newSignupId, slotConfig);
  if (!ctx) return;

  const findPos = (role: string) => findFirstAvailablePosition(ctx.occupied, role);

  if (await tryDirectSlot(tx, eventId, newSignupId, ctx.newPrefs, ctx.roleCapacity, ctx.filledPerRole, findPos, benchPromo)) return;

  const chain = findRearrangementChain(ctx.newPrefs, ctx.currentAssignments, ctx.allSignups, ctx.roleCapacity, ctx.filledPerRole);
  if (chain) {
    await executeChainMoves(tx, eventId, newSignupId, chain, ctx.occupied, ctx.filledPerRole, findPos, benchPromo);
    return;
  }

  if (await tryTentativeDisplacement(tx, ctx, eventId, newSignupId, findPos, benchPromo)) return;
  logger.log(`Auto-allocation: signup ${newSignupId} could not be placed`);
}

function applyChainMove(
  move: { fromRole: string; toRole: string; position: number },
  nextMove: { fromRole: string; position: number } | null,
  occupied: Record<string, Set<number>>,
  filledPerRole: Record<string, number>,
  findPos: (role: string) => number,
): number {
  const newPos = nextMove?.fromRole === move.toRole ? nextMove.position : findPos(move.toRole);
  occupied[move.fromRole]?.delete(move.position);
  occupied[move.toRole]?.add(newPos);
  if (!nextMove || nextMove.fromRole !== move.toRole) {
    filledPerRole[move.toRole]++;
  }
  return newPos;
}

async function executeChainMoves(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  chain: ChainResult,
  occupied: Record<string, Set<number>>,
  filledPerRole: Record<string, number>,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): Promise<void> {
  for (let i = chain.moves.length - 1; i >= 0; i--) {
    const move = chain.moves[i];
    const nextMove = i < chain.moves.length - 1 ? chain.moves[i + 1] : null;
    const newPos = applyChainMove(move, nextMove, occupied, filledPerRole, findPos);
    await tx.update(schema.rosterAssignments).set({ role: move.toRole, position: newPos }).where(eq(schema.rosterAssignments.id, move.assignmentId));
    logger.log(`Chain rearrange: signup ${move.signupId} moved from ${move.fromRole} to ${move.toRole} slot ${newPos}`);
  }

  const { freedRole } = chain;
  const freedPosition = chain.moves[0].position;
  await insertAssignment(tx, eventId, newSignupId, freedRole, freedPosition);
  await confirmSignup(tx, newSignupId);
  logger.log(`Auto-allocated signup ${newSignupId} to ${freedRole} slot ${freedPosition} (chain rearrangement)`);
  await benchPromo.cancelPromotion(eventId, freedRole, freedPosition);
}

export async function insertAssignment(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  role: string,
  position: number,
): Promise<void> {
  await tx.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role,
    position,
    isOverride: 0,
  });
}

export async function confirmSignup(
  tx: PostgresJsDatabase<typeof schema>,
  signupId: number,
): Promise<void> {
  await tx
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'confirmed' })
    .where(eq(schema.eventSignups.id, signupId));
}

// Re-exports for convenience
export {
  detectChainMoves,
  promoteGenericSlot,
  resolveGenericSlotRole,
} from './signup-promote.helpers';
