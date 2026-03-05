import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { insertAssignment, confirmSignup } from './signup-allocation.helpers';

const logger = new Logger('SignupTentative');

type AssignmentEntry = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};

type SignupEntry = {
  id: number;
  preferredRoles: string[] | null;
  status: string;
  signedUpAt: Date | null;
};

type DisplaceContext = {
  tx: PostgresJsDatabase<typeof schema>;
  eventId: number;
  newSignupId: number;
  currentAssignments: AssignmentEntry[];
  roleCapacity: Record<string, number>;
  occupied: Record<string, Set<number>>;
  findPos: (role: string) => number;
  benchPromo: BenchPromotionService;
  signupById: Map<number, SignupEntry>;
};

function buildContext(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  currentAssignments: AssignmentEntry[],
  allSignups: SignupEntry[],
  roleCapacity: Record<string, number>,
  occupied: Record<string, Set<number>>,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): DisplaceContext {
  return {
    tx,
    eventId,
    newSignupId,
    currentAssignments,
    roleCapacity,
    occupied,
    findPos,
    benchPromo,
    signupById: new Map(allSignups.map((s) => [s.id, s])),
  };
}

export async function displaceTentativeForSlot(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  newSignupId: number,
  newPrefs: string[],
  currentAssignments: AssignmentEntry[],
  allSignups: SignupEntry[],
  roleCapacity: Record<string, number>,
  occupied: Record<string, Set<number>>,
  findPos: (role: string) => number,
  benchPromo: BenchPromotionService,
): Promise<boolean> {
  const ctx = buildContext(
    tx,
    eventId,
    newSignupId,
    currentAssignments,
    allSignups,
    roleCapacity,
    occupied,
    findPos,
    benchPromo,
  );
  for (const role of newPrefs) {
    if (!(role in roleCapacity)) continue;
    if (await tryDisplaceRole(ctx, role)) return true;
  }
  return false;
}

async function tryDisplaceRole(
  ctx: DisplaceContext,
  role: string,
): Promise<boolean> {
  const victim = findTentativeVictim(
    role,
    ctx.currentAssignments,
    ctx.signupById,
  );
  if (!victim) return false;

  const victimPrefs =
    (ctx.signupById.get(victim.signupId)?.preferredRoles as string[] | null) ??
    [];
  const rearranged = await tryRearrangeVictim(
    ctx.tx,
    victim,
    role,
    victimPrefs,
    ctx.currentAssignments,
    ctx.roleCapacity,
    ctx.occupied,
    ctx.findPos,
  );
  if (!rearranged) await evictVictim(ctx.tx, victim, role, ctx.occupied);

  const freedPosition = rearranged ? ctx.findPos(role) : victim.position;
  await assignDisplacedSlot(ctx, role, freedPosition);
  return true;
}

async function evictVictim(
  tx: PostgresJsDatabase<typeof schema>,
  victim: { id: number; signupId: number; position: number },
  role: string,
  occupied: Record<string, Set<number>>,
): Promise<void> {
  await removeAssignment(tx, victim.id);
  occupied[role]?.delete(victim.position);
  logger.log(
    `ROK-459: Displaced tentative signup ${victim.signupId} from ${role} slot ${victim.position} to unassigned pool`,
  );
}

async function assignDisplacedSlot(
  ctx: DisplaceContext,
  role: string,
  position: number,
): Promise<void> {
  await insertAssignment(ctx.tx, ctx.eventId, ctx.newSignupId, role, position);
  ctx.occupied[role]?.add(position);
  await confirmSignup(ctx.tx, ctx.newSignupId);
  logger.log(
    `ROK-459: Auto-allocated confirmed signup ${ctx.newSignupId} to ${role} slot ${position} (tentative displacement)`,
  );
  await ctx.benchPromo.cancelPromotion(ctx.eventId, role, position);
}

function findTentativeVictim(
  role: string,
  currentAssignments: AssignmentEntry[],
  signupById: Map<number, { status: string; signedUpAt: Date | null }>,
): { id: number; signupId: number; position: number } | null {
  const tentatives = currentAssignments
    .filter((a) => {
      if (a.role !== role) return false;
      return signupById.get(a.signupId)?.status === 'tentative';
    })
    .sort((a, b) => {
      const aTime = signupById.get(a.signupId)?.signedUpAt?.getTime() ?? 0;
      const bTime = signupById.get(b.signupId)?.signedUpAt?.getTime() ?? 0;
      return aTime - bTime;
    });

  return tentatives[0] ?? null;
}

async function tryRearrangeVictim(
  tx: PostgresJsDatabase<typeof schema>,
  victim: { id: number; signupId: number; position: number },
  currentRole: string,
  victimPrefs: string[],
  currentAssignments: Array<{ id: number; role: string | null }>,
  roleCapacity: Record<string, number>,
  occupied: Record<string, Set<number>>,
  findPos: (role: string) => number,
): Promise<boolean> {
  const alternatives = victimPrefs.filter(
    (r) => r !== currentRole && r in roleCapacity,
  );

  for (const altRole of alternatives) {
    const filled = currentAssignments.filter((a) => a.role === altRole).length;
    if (filled >= roleCapacity[altRole]) continue;

    const newPos = findPos(altRole);
    await tx
      .update(schema.rosterAssignments)
      .set({ role: altRole, position: newPos })
      .where(eq(schema.rosterAssignments.id, victim.id));
    occupied[currentRole]?.delete(victim.position);
    occupied[altRole]?.add(newPos);
    logger.log(
      `ROK-459: Rearranged tentative signup ${victim.signupId} from ${currentRole} to ${altRole} slot ${newPos}`,
    );
    return true;
  }
  return false;
}

async function removeAssignment(
  tx: PostgresJsDatabase<typeof schema>,
  assignmentId: number,
): Promise<void> {
  await tx
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.id, assignmentId));
}
