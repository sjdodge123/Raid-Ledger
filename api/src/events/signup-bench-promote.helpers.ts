import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { autoAllocateSignup } from './signup-allocation.helpers';
import { detectChainMoves, promoteGenericSlot } from './signup-promote.helpers';

type PromotionResult = {
  role: string;
  position: number;
  username: string;
  chainMoves?: string[];
  warning?: string;
};

type SignupInfo = { preferredRoles: string[] | null; userId: number | null };

async function fetchPromotionContext(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<{
  slotConfig: Record<string, unknown>;
  signup: SignupInfo;
  username: string;
} | null> {
  const [event] = await tx
    .select({ slotConfig: schema.events.slotConfig })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event?.slotConfig) return null;

  const [signup] = await tx
    .select({
      preferredRoles: schema.eventSignups.preferredRoles,
      userId: schema.eventSignups.userId,
    })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.id, signupId))
    .limit(1);
  if (!signup) return null;

  let username = 'Bench player';
  if (signup.userId) {
    const [user] = await tx
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, signup.userId))
      .limit(1);
    if (user) username = user.username;
  }

  return { slotConfig: event.slotConfig as Record<string, unknown>, signup, username };
}

export async function promoteFromBench(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  benchPromo: BenchPromotionService,
): Promise<PromotionResult | null> {
  return db.transaction(async (tx) => {
    const ctx = await fetchPromotionContext(tx, eventId, signupId);
    if (!ctx) return null;
    if (ctx.slotConfig.type !== 'mmo')
      return promoteGenericSlot(tx, eventId, signupId, ctx.slotConfig, ctx.username);
    return promoteMmoFromBench(tx, eventId, signupId, ctx.slotConfig, ctx.signup, ctx.username, benchPromo);
  });
}

const nonBenchSelectFields = {
  id: schema.rosterAssignments.id,
  signupId: schema.rosterAssignments.signupId,
  role: schema.rosterAssignments.role,
  position: schema.rosterAssignments.position,
};

function nonBenchFilter(eventId: number) {
  return and(
    eq(schema.rosterAssignments.eventId, eventId),
    sql`${schema.rosterAssignments.role} != 'bench'`,
  );
}

async function deleteBenchAndReallocate(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  slotConfig: Record<string, unknown>,
  benchPromo: BenchPromotionService,
): Promise<void> {
  await tx
    .delete(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.signupId, signupId),
        eq(schema.rosterAssignments.role, 'bench'),
      ),
    );
  await autoAllocateSignup(tx, eventId, signupId, slotConfig, benchPromo);
}

async function fetchNewAssignment(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<{ role: string | null; position: number } | undefined> {
  const [a] = await tx
    .select({ role: schema.rosterAssignments.role, position: schema.rosterAssignments.position })
    .from(schema.rosterAssignments)
    .where(and(eq(schema.rosterAssignments.eventId, eventId), eq(schema.rosterAssignments.signupId, signupId)))
    .limit(1);
  return a;
}

async function ensureBenchFallback(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  newAssignment: { role: string | null; position: number } | undefined,
  username: string,
): Promise<PromotionResult | null> {
  if (newAssignment && newAssignment.role !== 'bench') return null;
  if (!newAssignment) {
    await tx.insert(schema.rosterAssignments).values({ eventId, signupId, role: 'bench', position: 1 });
  }
  return {
    role: 'bench',
    position: 1,
    username,
    warning: `Could not find a suitable roster slot for ${username} based on their preferred roles.`,
  };
}

export async function promoteMmoFromBench(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  slotConfig: Record<string, unknown>,
  signup: SignupInfo,
  username: string,
  benchPromo: BenchPromotionService,
): Promise<PromotionResult> {
  const beforeAssignments = await tx
    .select(nonBenchSelectFields)
    .from(schema.rosterAssignments)
    .where(nonBenchFilter(eventId));

  await deleteBenchAndReallocate(tx, eventId, signupId, slotConfig, benchPromo);
  const newAssignment = await fetchNewAssignment(tx, eventId, signupId);

  const fallback = await ensureBenchFallback(tx, eventId, signupId, newAssignment, username);
  if (fallback) return fallback;

  const afterAssignments = await tx
    .select(nonBenchSelectFields)
    .from(schema.rosterAssignments)
    .where(nonBenchFilter(eventId));
  const chainMoves = await detectChainMoves(tx, beforeAssignments, afterAssignments, signupId);
  return buildPromotionResult(newAssignment!, signup, username, chainMoves);
}

export function buildPromotionResult(
  newAssignment: { role: string | null; position: number },
  signup: { preferredRoles: string[] | null },
  username: string,
  chainMoves: Array<{ signupId: number; username: string; fromRole: string; toRole: string }>,
): PromotionResult {
  const prefs = (signup.preferredRoles as string[]) ?? [];
  const warnings = buildPromotionWarnings(newAssignment, prefs, username, chainMoves);
  return {
    role: newAssignment.role ?? 'bench',
    position: newAssignment.position,
    username,
    chainMoves: chainMoves.map((m) => `${m.username}: ${m.fromRole} → ${m.toRole}`),
    warning: warnings.length > 0 ? warnings.join('\n') : undefined,
  };
}

function buildPromotionWarnings(
  newAssignment: { role: string | null },
  prefs: string[],
  username: string,
  chainMoves: Array<{ username: string; fromRole: string; toRole: string }>,
): string[] {
  const warnings: string[] = [];
  if (prefs.length > 0 && newAssignment.role && !prefs.includes(newAssignment.role)) {
    warnings.push(
      `${username} was placed in **${newAssignment.role}** which is not in their preferred roles (${prefs.join(', ')}).`,
    );
  }
  for (const move of chainMoves) {
    warnings.push(
      `${move.username} moved from **${move.fromRole}** to **${move.toRole}** to accommodate the promotion.`,
    );
  }
  return warnings;
}
