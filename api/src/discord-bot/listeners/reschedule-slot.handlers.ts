import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { findFirstAvailableSlot } from '../../events/roster-slot.utils';
import type {
  EventRow,
  RescheduleDeps,
  ReconfirmOptions,
} from './reschedule-response.helpers';

/**
 * Ensure a roster assignment exists for a signup; create one in the
 * first available slot if missing.
 */
export async function ensureRosterAssignment(
  deps: RescheduleDeps,
  event: EventRow,
  signupId: number,
  options?: ReconfirmOptions,
): Promise<void> {
  const [existing] = await deps.db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);
  if (existing) return;

  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (!slotConfig) return;

  const occupied = await getOccupiedSlots(deps, event.id);

  if (slotConfig.type === 'mmo') {
    await slotMmoRole(deps, event.id, signupId, slotConfig, occupied, options);
  } else {
    await slotGenericRole(deps, event.id, signupId, slotConfig, occupied);
  }
}

/** Get the set of occupied slot keys for an event. */
async function getOccupiedSlots(
  deps: RescheduleDeps,
  eventId: number,
): Promise<Set<string>> {
  const assignments = await deps.db
    .select({
      role: schema.rosterAssignments.role,
      position: schema.rosterAssignments.position,
    })
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId))
    .limit(200);

  return new Set(assignments.map((a) => `${a.role}:${a.position}`));
}

/** Slot into an MMO role based on preferred roles. */
async function slotMmoRole(
  deps: RescheduleDeps,
  eventId: number,
  signupId: number,
  slotConfig: Record<string, unknown>,
  occupied: Set<string>,
  options?: ReconfirmOptions,
): Promise<void> {
  const preferredRoles =
    options?.preferredRoles ?? (options?.slotRole ? [options.slotRole] : []);
  if (preferredRoles.length === 0) return;

  const capacity: Record<string, number> = {
    tank: (slotConfig.tank as number) ?? 0,
    healer: (slotConfig.healer as number) ?? 0,
    dps: (slotConfig.dps as number) ?? 0,
  };

  for (const role of preferredRoles) {
    if (!(role in capacity)) continue;
    for (let pos = 1; pos <= capacity[role]; pos++) {
      if (!occupied.has(`${role}:${pos}`)) {
        await insertAssignment(deps, eventId, signupId, role, pos);
        return;
      }
    }
  }
}

/** Slot into a generic event's first available position. */
async function slotGenericRole(
  deps: RescheduleDeps,
  eventId: number,
  signupId: number,
  slotConfig: Record<string, unknown>,
  occupied: Set<string>,
): Promise<void> {
  const slot = findFirstAvailableSlot(slotConfig, occupied);
  if (slot) {
    await insertAssignment(deps, eventId, signupId, slot.role, slot.position);
  }
}

/** Insert a single roster assignment row. */
async function insertAssignment(
  deps: RescheduleDeps,
  eventId: number,
  signupId: number,
  role: string,
  position: number,
): Promise<void> {
  await deps.db.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role,
    position,
    isOverride: 0,
  });
  deps.logger.log(
    'Auto-slotted signup %d into %s:%d for event %d (reschedule confirm)',
    signupId,
    role,
    position,
    eventId,
  );
}
