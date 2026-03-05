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

function getSlotContext(event: EventRow): SlotContext {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  return { slotConfig, isMMO: slotConfig?.type === 'mmo' };
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
  const { slotConfig, isMMO } = getSlotContext(event);
  const hasPreferredRoles =
    dto?.preferredRoles && dto.preferredRoles.length > 0;
  const hasSingleSlotRole = !hasPreferredRoles && dto?.slotRole && !autoBench;

  if (
    shouldAutoAllocate(
      isMMO,
      hasPreferredRoles,
      hasSingleSlotRole,
      autoBench,
      dto?.slotRole,
    )
  ) {
    await runAutoAllocation(
      tx,
      eventId,
      inserted.id,
      dto?.slotRole,
      hasSingleSlotRole,
      slotConfig,
      benchPromo,
    );
    await syncConfirmationStatus(tx, inserted);
    return;
  }

  const slotRole = autoBench
    ? 'bench'
    : (dto?.slotRole ?? (await resolveGenericSlotRole(tx, event, eventId)));
  if (slotRole) {
    await assignWithPosition(
      tx,
      eventId,
      inserted.id,
      slotRole,
      dto?.slotPosition,
      autoBench,
      benchPromo,
    );
    if (slotRole !== 'bench') inserted.confirmationStatus = 'confirmed';
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
  const { slotConfig, isMMO } = getSlotContext(event);
  const hasPreferredRoles =
    existing.preferredRoles && existing.preferredRoles.length > 0;
  const hasSingleSlotRole = !hasPreferredRoles && dto?.slotRole && !autoBench;

  if (
    shouldAutoAllocate(
      isMMO,
      hasPreferredRoles,
      hasSingleSlotRole,
      autoBench,
      dto?.slotRole,
    )
  ) {
    await runAutoAllocation(
      tx,
      eventId,
      existing.id,
      dto?.slotRole,
      hasSingleSlotRole,
      slotConfig,
      benchPromo,
    );
    await syncConfirmationStatus(tx, existing);
    return;
  }

  const slotRole = autoBench
    ? 'bench'
    : (dto?.slotRole ?? (await resolveGenericSlotRole(tx, event, eventId)));
  if (slotRole) {
    await assignWithPosition(
      tx,
      eventId,
      existing.id,
      slotRole,
      dto?.slotPosition,
      autoBench,
      benchPromo,
    );
    if (slotRole !== 'bench') existing.confirmationStatus = 'confirmed';
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

function shouldAutoAllocate(
  isMMO: boolean,
  hasPreferredRoles: boolean | 0 | null | undefined,
  hasSingleSlotRole: boolean | string | null | undefined,
  autoBench: boolean,
  slotRole: string | undefined,
): boolean {
  return (
    isMMO &&
    !!(hasPreferredRoles || hasSingleSlotRole) &&
    !autoBench &&
    slotRole !== 'bench'
  );
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
