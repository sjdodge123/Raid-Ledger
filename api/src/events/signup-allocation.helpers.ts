import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { findRearrangementChain } from './signup-chain.helpers';
import { executeChainMoves } from './signup-chain-exec.helpers';
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
  if (!newSignup?.preferredRoles || newSignup.preferredRoles.length === 0)
    return null;
  const rolePriority: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
  return [...newSignup.preferredRoles].sort(
    (a, b) => (rolePriority[a] ?? 99) - (rolePriority[b] ?? 99),
  );
}

/** Builds role capacity from slot config. */
function buildRoleCapacity(
  slotConfig: Record<string, unknown> | null,
): Record<string, number> {
  return {
    tank: (slotConfig?.tank as number) ?? 2,
    healer: (slotConfig?.healer as number) ?? 4,
    dps: (slotConfig?.dps as number) ?? 14,
  };
}

/** Fetches signups and assignments for an event. */
async function fetchAllocationData(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  return Promise.all([
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
}

async function buildAllocationContext(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  slotConfig: Record<string, unknown> | null,
): Promise<AllocationContext | null> {
  const roleCapacity = buildRoleCapacity(slotConfig);
  const [allSignups, currentAssignments] = await fetchAllocationData(
    tx,
    eventId,
  );
  const { filledPerRole, occupied } = initRoleCounters();
  tallyAssignments(currentAssignments, filledPerRole, occupied);
  const newPrefs = resolveNewPrefs(allSignups, newSignupId);
  if (!newPrefs) return null;
  return {
    newPrefs,
    roleCapacity,
    filledPerRole,
    occupied,
    currentAssignments,
    allSignups,
  };
}

/** Tries to place the signup directly into an open preferred-role slot. */
async function tryDirectSlot(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  ctx: AllocationContext,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): Promise<boolean> {
  for (const role of ctx.newPrefs) {
    if (
      role in ctx.roleCapacity &&
      ctx.filledPerRole[role] < ctx.roleCapacity[role]
    ) {
      const position = findPos(role);
      await insertAssignment(tx, eventId, signupId, role, position);
      await confirmSignup(tx, signupId);
      logger.log(
        `Auto-allocated signup ${signupId} to ${role} slot ${position} (direct match)`,
      );
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
    tx,
    eventId,
    newSignupId,
    ctx.newPrefs,
    ctx.currentAssignments,
    ctx.allSignups,
    ctx.roleCapacity,
    ctx.occupied,
    findPos,
    benchPromo,
  );
}

/** Attempts chain rearrangement to free a slot for the new signup. */
async function tryChainRearrangement(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  ctx: AllocationContext,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): Promise<boolean> {
  const chain = findRearrangementChain(
    ctx.newPrefs,
    ctx.currentAssignments,
    ctx.allSignups,
    ctx.roleCapacity,
    ctx.filledPerRole,
  );
  if (!chain) return false;
  await executeChainMoves(
    tx,
    eventId,
    newSignupId,
    chain,
    ctx.occupied,
    ctx.filledPerRole,
    findPos,
    benchPromo,
  );
  return true;
}

/** Runs allocation strategies in priority order. Returns true if placed. */
async function runStrategies(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  ctx: AllocationContext,
  benchPromo: BenchPromotionService,
): Promise<boolean> {
  const findPos = (role: string) =>
    findFirstAvailablePosition(ctx.occupied, role);
  if (await tryDirectSlot(tx, eventId, signupId, ctx, findPos, benchPromo))
    return true;
  if (
    await tryChainRearrangement(tx, eventId, signupId, ctx, findPos, benchPromo)
  )
    return true;
  if (
    await tryTentativeDisplacement(
      tx,
      ctx,
      eventId,
      signupId,
      findPos,
      benchPromo,
    )
  )
    return true;
  return false;
}

/** Orchestrates auto-allocation strategies in priority order. */
export async function autoAllocateSignup(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  slotConfig: Record<string, unknown> | null,
  benchPromo: BenchPromotionService,
): Promise<void> {
  const ctx = await buildAllocationContext(
    tx,
    eventId,
    newSignupId,
    slotConfig,
  );
  if (!ctx) return;
  const placed = await runStrategies(tx, eventId, newSignupId, ctx, benchPromo);
  if (!placed)
    logger.log(`Auto-allocation: signup ${newSignupId} could not be placed`);
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
