/**
 * Signup flow helpers for SignupsService.
 * Contains insert, duplicate handling, auto-bench, and new signup logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { CreateSignupDto } from '@raid-ledger/contract';
import type { Tx, EventRow, SignupRow } from './signups.service.types';

/** Shared MMO slot defaults used across capacity and roster-query helpers. */
export const MMO_SLOT_DEFAULTS = {
  tank: 2,
  healer: 4,
  dps: 14,
  flex: 5,
  bench: 0,
} as const;

/** Compute the total non-bench capacity from a slotConfig object. */
export function computeSlotCapacity(
  slotConfig: Record<string, unknown>,
): number | null {
  const type = slotConfig.type as string;
  if (type === 'mmo') {
    const tank = (slotConfig.tank as number) ?? MMO_SLOT_DEFAULTS.tank;
    const healer = (slotConfig.healer as number) ?? MMO_SLOT_DEFAULTS.healer;
    const dps = (slotConfig.dps as number) ?? MMO_SLOT_DEFAULTS.dps;
    const flex = (slotConfig.flex as number) ?? MMO_SLOT_DEFAULTS.flex;
    return tank + healer + dps + flex;
  }
  if (type === 'generic') {
    return (slotConfig.player as number) ?? null;
  }
  return null;
}

export async function checkAutoBench(
  tx: Tx,
  eventRow: EventRow,
  eventId: number,
  dto?: CreateSignupDto,
): Promise<boolean> {
  if (dto?.slotRole === 'bench') return false;
  const capacity = resolveRosterCapacity(eventRow);
  if (capacity === null) return false;
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
  return Number(count) >= capacity;
}

/** Resolve the total non-bench roster capacity for an event. */
function resolveRosterCapacity(eventRow: EventRow): number | null {
  const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
  if (slotConfig) return computeSlotCapacity(slotConfig);
  return eventRow.maxAttendees ?? null;
}

export async function insertSignupRow(
  tx: Tx,
  eventId: number,
  userId: number,
  dto?: CreateSignupDto,
) {
  const hasCharacter = !!dto?.characterId;
  return tx
    .insert(schema.eventSignups)
    .values({
      eventId,
      userId,
      note: dto?.note ?? null,
      characterId: dto?.characterId ?? null,
      confirmationStatus: hasCharacter ? 'confirmed' : 'pending',
      status: 'signed_up',
      preferredRoles: dto?.preferredRoles ?? null,
    })
    .onConflictDoNothing({
      target: [schema.eventSignups.eventId, schema.eventSignups.userId],
    })
    .returning();
}

export async function fetchExistingSignup(
  tx: Tx,
  eventId: number,
  userId: number,
) {
  const [existing] = await tx
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return existing;
}

export function isCancelledStatus(status: string): boolean {
  return (
    status === 'roached_out' || status === 'declined' || status === 'departed'
  );
}

export function buildReactivationFields(
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
  hasCharacter: boolean,
) {
  return {
    status: 'signed_up' as const,
    confirmationStatus: hasCharacter
      ? ('confirmed' as const)
      : ('pending' as const),
    note: dto?.note ?? existing.note,
    characterId: dto?.characterId ?? null,
    preferredRoles: dto?.preferredRoles ?? null,
    attendanceStatus: null,
    attendanceRecordedAt: null,
    roachedOutAt: null,
  };
}

export async function reactivateIfCancelled(
  tx: Tx,
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
  hasCharacter: boolean,
) {
  if (!isCancelledStatus(existing.status)) return;
  const fields = buildReactivationFields(existing, dto, hasCharacter);
  await tx
    .update(schema.eventSignups)
    .set(fields)
    .where(eq(schema.eventSignups.id, existing.id));
  Object.assign(existing, fields);
}

export async function updatePreferredRolesIfNeeded(
  tx: Tx,
  existing: SignupRow,
  dto?: CreateSignupDto,
) {
  if (isCancelledStatus(existing.status)) return;
  if (!dto?.preferredRoles || dto.preferredRoles.length === 0) return;
  await tx
    .update(schema.eventSignups)
    .set({ preferredRoles: dto.preferredRoles })
    .where(eq(schema.eventSignups.id, existing.id));
  existing.preferredRoles = dto.preferredRoles;
}

export function shouldUseAutoAllocation(
  eventRow: EventRow,
  signup: SignupRow,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
): boolean {
  const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type !== 'mmo' || autoBench || dto?.slotRole === 'bench')
    return false;
  const hasPrefs = signup.preferredRoles && signup.preferredRoles.length > 0;
  const hasSingleRole = !hasPrefs && !!dto?.slotRole;
  return hasPrefs || hasSingleRole;
}

export function shouldUseAutoAllocationNew(
  eventRow: EventRow,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
): boolean {
  const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type !== 'mmo' || autoBench || dto?.slotRole === 'bench')
    return false;
  const hasPrefs = dto?.preferredRoles && dto.preferredRoles.length > 0;
  const hasSingleRole = !hasPrefs && !!dto?.slotRole;
  return hasPrefs || hasSingleRole;
}

export async function autoConfirmCreator(
  tx: Tx,
  eventRow: EventRow,
  userId: number,
  inserted: SignupRow,
) {
  if (
    eventRow.creatorId !== userId ||
    inserted.confirmationStatus === 'confirmed'
  )
    return;
  await tx
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'confirmed' })
    .where(eq(schema.eventSignups.id, inserted.id));
  inserted.confirmationStatus = 'confirmed';
}

export async function syncConfirmationStatus(tx: Tx, signup: SignupRow) {
  const [refreshed] = await tx
    .select({ confirmationStatus: schema.eventSignups.confirmationStatus })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.id, signup.id))
    .limit(1);
  if (refreshed) signup.confirmationStatus = refreshed.confirmationStatus;
}
