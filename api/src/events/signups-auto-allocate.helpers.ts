/**
 * Auto-allocation orchestration helpers for SignupsService.
 * Contains direct allocation, chain rearrangement execution, and tentative displacement.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ExecuteDisplacementParams } from './signups.service.types';
import {
  type AllocationContext,
  type RearrangementChainResult,
  extractRoleCapacity,
  countFilledPerRole,
  buildOccupiedPositions,
  sortByRolePriority,
  findFirstAvailableInSet,
  findOldestTentativeOccupant,
  bfsRearrangementChain,
} from './signups-allocation.helpers';
import * as tentH from './signups-tentative.helpers';

type Tx = PostgresJsDatabase<typeof schema>;

export async function buildAllocationContext(
  tx: Tx,
  eventId: number,
  slotConfig: Record<string, unknown> | null,
): Promise<AllocationContext> {
  const roleCapacity = extractRoleCapacity(slotConfig);
  const allSignups = await tx
    .select({
      id: schema.eventSignups.id,
      preferredRoles: schema.eventSignups.preferredRoles,
      status: schema.eventSignups.status,
      signedUpAt: schema.eventSignups.signedUpAt,
    })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  const currentAssignments = await tx
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
  return {
    roleCapacity,
    allSignups,
    currentAssignments,
    filledPerRole: countFilledPerRole(currentAssignments),
    occupiedPositions: buildOccupiedPositions(currentAssignments),
  };
}

export async function insertAndConfirmSlot(
  tx: Tx,
  eventId: number,
  signupId: number,
  role: string,
  position: number,
) {
  await tx
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId, role, position, isOverride: 0 });
  await tx
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'confirmed' })
    .where(eq(schema.eventSignups.id, signupId));
}

export async function tryDirectAllocation(
  tx: Tx,
  eventId: number,
  newSignupId: number,
  newPrefs: string[],
  status: string,
  ctx: AllocationContext,
  logger: { log: (msg: string) => void },
  cancelPromotion: (e: number, r: string, p: number) => Promise<void>,
): Promise<boolean> {
  const signupById = new Map(ctx.allSignups.map((s) => [s.id, s]));
  for (const role of newPrefs) {
    if (!(role in ctx.roleCapacity)) continue;
    if (ctx.filledPerRole[role] >= ctx.roleCapacity[role]) {
      if (shouldDeferToTentativeDisplacement(role, status, ctx, signupById))
        return false;
      continue;
    }
    const position = findFirstAvailableInSet(ctx.occupiedPositions[role]);
    await insertAndConfirmSlot(tx, eventId, newSignupId, role, position);
    logger.log(
      `Auto-allocated signup ${newSignupId} to ${role} slot ${position} (direct match)`,
    );
    await cancelPromotion(eventId, role, position);
    return true;
  }
  return false;
}

/** Returns true when a confirmed player should skip direct allocation to
 *  let tentative displacement handle a higher-priority role instead. */
function shouldDeferToTentativeDisplacement(
  fullRole: string,
  status: string,
  ctx: AllocationContext,
  signupById: Map<number, { status: string; signedUpAt: Date | null }>,
): boolean {
  if (status === 'tentative') return false;
  const victim = findOldestTentativeOccupant(
    ctx.currentAssignments,
    fullRole,
    signupById,
  );
  return !!victim;
}

export async function tryChainRearrangement(
  tx: Tx,
  eventId: number,
  newSignupId: number,
  newPrefs: string[],
  ctx: AllocationContext,
  logger: { log: (msg: string) => void },
  cancelPromotion: (e: number, r: string, p: number) => Promise<void>,
): Promise<boolean> {
  const chain = bfsRearrangementChain(
    newPrefs,
    ctx.currentAssignments,
    ctx.allSignups,
    ctx.roleCapacity,
    ctx.filledPerRole,
  );
  if (!chain) return false;
  await executeChainMoves(tx, chain, ctx, logger);
  const { freedRole } = chain;
  const pos = chain.moves[0].position;
  await insertAndConfirmSlot(tx, eventId, newSignupId, freedRole, pos);
  logger.log(
    `Auto-allocated signup ${newSignupId} to ${freedRole} slot ${pos} (${chain.moves.length}-step chain rearrangement)`,
  );
  await cancelPromotion(eventId, freedRole, pos);
  return true;
}

async function executeChainMoves(
  tx: Tx,
  chain: NonNullable<RearrangementChainResult>,
  ctx: AllocationContext,
  logger: { log: (msg: string) => void },
) {
  for (let i = chain.moves.length - 1; i >= 0; i--) {
    const move = chain.moves[i];
    const nextMove = i < chain.moves.length - 1 ? chain.moves[i + 1] : null;
    const newPos =
      nextMove && nextMove.fromRole === move.toRole
        ? nextMove.position
        : findFirstAvailableInSet(ctx.occupiedPositions[move.toRole]);
    await tx
      .update(schema.rosterAssignments)
      .set({ role: move.toRole, position: newPos })
      .where(eq(schema.rosterAssignments.id, move.assignmentId));
    ctx.occupiedPositions[move.fromRole]?.delete(move.position);
    ctx.occupiedPositions[move.toRole]?.add(newPos);
    if (!nextMove || nextMove.fromRole !== move.toRole)
      ctx.filledPerRole[move.toRole]++;
    logger.log(
      `Chain rearrange: signup ${move.signupId} moved from ${move.fromRole} to ${move.toRole} slot ${newPos}`,
    );
  }
}

export async function tryTentativeDisplacement(
  tx: Tx,
  eventId: number,
  newSignupId: number,
  newPrefs: string[],
  status: string,
  ctx: AllocationContext,
  executeDisplacementFn: (p: ExecuteDisplacementParams) => Promise<boolean>,
): Promise<boolean> {
  if (status === 'tentative') return false;
  const posFinder = (role: string) =>
    findFirstAvailableInSet(ctx.occupiedPositions[role]);
  return tentH.displaceTentativeForSlot(
    {
      tx,
      eventId,
      newSignupId,
      newPrefs,
      currentAssignments: ctx.currentAssignments,
      allSignups: ctx.allSignups,
      roleCapacity: ctx.roleCapacity,
      occupiedPositions: ctx.occupiedPositions,
      findPos: posFinder,
    },
    (p) => executeDisplacementFn(p),
  );
}

export async function runAutoAllocation(
  tx: Tx,
  eventId: number,
  newSignupId: number,
  slotConfig: Record<string, unknown> | null,
  logger: { log: (msg: string) => void },
  cancelPromotion: (e: number, r: string, p: number) => Promise<void>,
  executeDisplacementFn: (p: ExecuteDisplacementParams) => Promise<boolean>,
): Promise<void> {
  const ctx = await buildAllocationContext(tx, eventId, slotConfig);
  const newSignup = ctx.allSignups.find((s) => s.id === newSignupId);
  if (!newSignup?.preferredRoles || newSignup.preferredRoles.length === 0)
    return;
  const newPrefs = sortByRolePriority(newSignup.preferredRoles);
  const placed = await runAllocationStrategies(
    tx,
    eventId,
    newSignupId,
    newPrefs,
    newSignup.status,
    ctx,
    logger,
    cancelPromotion,
    executeDisplacementFn,
  );
  if (!placed) {
    logger.log(`Auto-allocation: signup ${newSignupId} could not be placed`);
  }
}

async function runAllocationStrategies(
  tx: Tx,
  eventId: number,
  newSignupId: number,
  newPrefs: string[],
  status: string,
  ctx: AllocationContext,
  logger: { log: (msg: string) => void },
  cancelPromotion: (e: number, r: string, p: number) => Promise<void>,
  executeDisplacementFn: (p: ExecuteDisplacementParams) => Promise<boolean>,
): Promise<boolean> {
  if (
    await tryDirectAllocation(
      tx,
      eventId,
      newSignupId,
      newPrefs,
      status,
      ctx,
      logger,
      cancelPromotion,
    )
  )
    return true;
  if (
    await tryChainRearrangement(
      tx,
      eventId,
      newSignupId,
      newPrefs,
      ctx,
      logger,
      cancelPromotion,
    )
  )
    return true;
  return tryTentativeDisplacement(
    tx,
    eventId,
    newSignupId,
    newPrefs,
    status,
    ctx,
    executeDisplacementFn,
  );
}
