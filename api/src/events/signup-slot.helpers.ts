/**
 * Slot assignment helpers for signup creation.
 * Handles both MMO auto-allocation and generic slot assignment.
 */
import { eq, and, sql } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { autoAllocateSignup } from './signup-allocation.helpers';
import { resolveGenericSlotRole } from './signup-promote.helpers';
import type { CreateSignupDto } from '@raid-ledger/contract';

const logger = new Logger('SignupSlot');

type EventRow = typeof schema.events.$inferSelect;
type SignupRow = typeof schema.eventSignups.$inferSelect;

interface SlotContext {
  slotConfig: Record<string, unknown> | null;
  isMMO: boolean;
}

interface SlotAssignParams {
  tx: PostgresJsDatabase<typeof schema>;
  event: EventRow;
  eventId: number;
  dto: CreateSignupDto | undefined;
  autoBench: boolean;
  benchPromo: BenchPromotionService;
}

function getSlotContext(event: EventRow): SlotContext {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  return { slotConfig, isMMO: slotConfig?.type === 'mmo' };
}

/** Checks whether MMO auto-allocation should run for this signup. */
function needsAutoAllocate(
  event: EventRow,
  preferredRoles: string[] | null | undefined,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
): {
  slotConfig: Record<string, unknown> | null;
  hasSingle: boolean | string | null | undefined;
} | null {
  const { slotConfig, isMMO } = getSlotContext(event);
  if (!isMMO || autoBench || dto?.slotRole === 'bench') return null;
  const hasPreferred = preferredRoles && preferredRoles.length > 0;
  const hasSingle = !hasPreferred && dto?.slotRole && !autoBench;
  if (!hasPreferred && !hasSingle) return null;
  return { slotConfig, hasSingle };
}

/** Attempts MMO auto-allocation if applicable. Returns true if handled. */
async function tryAutoAllocateSlot(
  p: SlotAssignParams,
  signup: SignupRow,
  preferredRoles: string[] | null | undefined,
): Promise<boolean> {
  const check = needsAutoAllocate(p.event, preferredRoles, p.dto, p.autoBench);
  if (!check) return false;
  await runAutoAllocation(
    p.tx,
    p.eventId,
    signup.id,
    p.dto?.slotRole,
    check.hasSingle,
    check.slotConfig,
    p.benchPromo,
  );
  await syncConfirmationStatus(p.tx, signup);
  return true;
}

/** Resolves and assigns the manual/generic slot role. */
async function assignManualSlot(
  p: SlotAssignParams,
  signup: SignupRow,
): Promise<string | null> {
  const slotRole = p.autoBench
    ? 'bench'
    : (p.dto?.slotRole ??
      (await resolveGenericSlotRole(p.tx, p.event, p.eventId)));
  if (!slotRole) return null;
  await assignWithPosition(
    p.tx,
    p.eventId,
    signup.id,
    slotRole,
    p.dto?.slotPosition,
    p.autoBench,
    p.benchPromo,
  );
  if (slotRole !== 'bench') signup.confirmationStatus = 'confirmed';
  return slotRole;
}

export async function assignNewSignupSlot(
  tx: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  eventId: number,
  inserted: SignupRow,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
  benchPromo: BenchPromotionService,
): Promise<void> {
  const p: SlotAssignParams = {
    tx,
    event,
    eventId,
    dto,
    autoBench,
    benchPromo,
  };
  if (await tryAutoAllocateSlot(p, inserted, dto?.preferredRoles)) return;
  const slotRole = await assignManualSlot(p, inserted);
  if (slotRole) {
    logger.log(
      `Assigned user ${inserted.userId} to ${slotRole} slot${autoBench ? ' (auto-benched)' : ''}`,
    );
  }
}

export async function assignExistingSignupSlot(
  tx: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  eventId: number,
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
  benchPromo: BenchPromotionService,
): Promise<void> {
  const p: SlotAssignParams = {
    tx,
    event,
    eventId,
    dto,
    autoBench,
    benchPromo,
  };
  if (await tryAutoAllocateSlot(p, existing, existing.preferredRoles)) return;
  const slotRole = await assignManualSlot(p, existing);
  if (slotRole) {
    logger.log(
      `Re-assigned user ${existing.userId} to ${slotRole} slot (existing signup)`,
    );
  }
}

export async function assignDiscordSignupSlot(
  tx: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  eventId: number,
  signupId: number,
  role: string | undefined,
  preferredRoles: string[] | undefined,
  benchPromo: BenchPromotionService,
): Promise<void> {
  const { slotConfig, isMMO } = getSlotContext(event);
  const hasPreferredRoles = preferredRoles && preferredRoles.length > 0;
  const hasSingleRole = !hasPreferredRoles && role;

  if (isMMO && (hasPreferredRoles || hasSingleRole)) {
    if (hasSingleRole && role) {
      await tx
        .update(schema.eventSignups)
        .set({ preferredRoles: [role] })
        .where(eq(schema.eventSignups.id, signupId));
    }
    await autoAllocateSignup(tx, eventId, signupId, slotConfig, benchPromo);
  }

  const assignRole =
    !isMMO || (!hasPreferredRoles && !hasSingleRole)
      ? (role ?? (await resolveGenericSlotRole(tx, event, eventId)))
      : null;

  if (assignRole) {
    await assignNextPosition(tx, eventId, signupId, assignRole);
  }
}

async function runAutoAllocation(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  slotRole: string | undefined,
  hasSingleSlotRole: boolean | string | null | undefined,
  slotConfig: Record<string, unknown> | null,
  benchPromo: BenchPromotionService,
): Promise<void> {
  if (hasSingleSlotRole && slotRole) {
    await tx
      .update(schema.eventSignups)
      .set({ preferredRoles: [slotRole] })
      .where(eq(schema.eventSignups.id, signupId));
  }
  await autoAllocateSignup(tx, eventId, signupId, slotConfig, benchPromo);
}

async function syncConfirmationStatus(
  tx: PostgresJsDatabase<typeof schema>,
  signup: SignupRow,
): Promise<void> {
  const [refreshed] = await tx
    .select({ confirmationStatus: schema.eventSignups.confirmationStatus })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.id, signup.id))
    .limit(1);
  if (refreshed) signup.confirmationStatus = refreshed.confirmationStatus;
}

export async function assignWithPosition(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  slotRole: string,
  dtoPosition: number | undefined,
  autoBench: boolean,
  benchPromo: BenchPromotionService,
): Promise<void> {
  let position = dtoPosition ?? 0;
  if (autoBench || !position) {
    position = await getNextPosition(tx, eventId, slotRole);
  }

  await tx.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role: slotRole,
    position,
    isOverride: 0,
  });

  if (slotRole !== 'bench') {
    await tx
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(eq(schema.eventSignups.id, signupId));
    await benchPromo.cancelPromotion(eventId, slotRole, position);
  }
}

async function getNextPosition(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  role: string,
): Promise<number> {
  const positions = await tx
    .select({ position: schema.rosterAssignments.position })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, role),
      ),
    );
  return positions.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

async function assignNextPosition(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  role: string,
): Promise<void> {
  const position = await getNextPosition(tx, eventId, role);
  await tx.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role,
    position,
    isOverride: 0,
  });
}

export async function checkAutoBench(
  tx: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  eventId: number,
  dto?: CreateSignupDto,
): Promise<boolean> {
  if (!event.maxAttendees || dto?.slotRole === 'bench') return false;

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(schema.eventSignups)
    .innerJoin(
      schema.rosterAssignments,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        sql`${schema.rosterAssignments.role} != 'bench'`,
      ),
    );

  return Number(count) >= event.maxAttendees;
}
