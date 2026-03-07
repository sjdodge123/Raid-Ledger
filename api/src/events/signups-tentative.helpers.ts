/**
 * Tentative displacement helpers for SignupsService.
 * Contains tentative displacement, reslotting, and displacement notification logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq, and, isNull } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';
import type {
  DisplaceTentativeParams,
  ExecuteDisplacementParams,
  RearrangeVictimParams,
  DisplacedNotificationParams,
} from './signups.service.types';
import { findOldestTentativeOccupant } from './signups-allocation.helpers';
import type { NotificationService } from '../notifications/notification.service';

export async function reslotTentativeTx(
  tx: Tx,
  eventId: number,
  vacatedRole: string,
  vacatedPosition: number,
): Promise<number | null> {
  const candidate = await findTentativeCandidate(tx, eventId, vacatedRole);
  if (!candidate) return null;
  if (await isSlotOccupied(tx, eventId, vacatedRole, vacatedPosition))
    return null;
  await tx.insert(schema.rosterAssignments).values({
    eventId,
    signupId: candidate.id,
    role: vacatedRole,
    position: vacatedPosition,
    isOverride: 0,
  });
  return candidate.id;
}

async function findTentativeCandidate(
  tx: Tx,
  eventId: number,
  vacatedRole: string,
) {
  const candidates = await tx
    .select({
      id: schema.eventSignups.id,
      preferredRoles: schema.eventSignups.preferredRoles,
      signedUpAt: schema.eventSignups.signedUpAt,
    })
    .from(schema.eventSignups)
    .leftJoin(
      schema.rosterAssignments,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.status, 'tentative'),
        isNull(schema.rosterAssignments.id),
      ),
    )
    .orderBy(schema.eventSignups.signedUpAt);
  return (
    candidates.find((c) => (c.preferredRoles ?? []).includes(vacatedRole)) ??
    null
  );
}

async function isSlotOccupied(
  tx: Tx,
  eventId: number,
  role: string,
  position: number,
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: schema.rosterAssignments.id })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, role),
        eq(schema.rosterAssignments.position, position),
      ),
    )
    .limit(1);
  return !!existing;
}

export async function getTentativeAssignmentRole(
  db: Tx,
  eventId: number,
  signupId: number,
): Promise<string | null> {
  const [assignment] = await db
    .select({ role: schema.rosterAssignments.role })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.signupId, signupId),
      ),
    )
    .limit(1);
  return assignment?.role ?? null;
}

export async function findConfirmedCandidateForRole(
  db: Tx,
  eventId: number,
  role: string,
) {
  const unassigned = await db
    .select({
      id: schema.eventSignups.id,
      preferredRoles: schema.eventSignups.preferredRoles,
    })
    .from(schema.eventSignups)
    .leftJoin(
      schema.rosterAssignments,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.status, 'signed_up'),
        isNull(schema.rosterAssignments.id),
      ),
    );
  return (
    unassigned.find((s) => (s.preferredRoles ?? []).includes(role)) ?? null
  );
}

export async function fetchMmoSlotConfig(
  db: Tx,
  eventId: number,
): Promise<Record<string, unknown> | null> {
  const [event] = await db
    .select({ slotConfig: schema.events.slotConfig })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const config = event?.slotConfig as Record<string, unknown> | null;
  return config?.type === 'mmo' ? config : null;
}

export async function displaceTentativeForSlot(
  p: DisplaceTentativeParams,
  executeDisplacementFn: (p: ExecuteDisplacementParams) => Promise<boolean>,
): Promise<boolean> {
  const signupById = new Map(p.allSignups.map((s) => [s.id, s]));
  for (const role of p.newPrefs) {
    if (!(role in p.roleCapacity)) continue;
    const victim = findOldestTentativeOccupant(
      p.currentAssignments,
      role,
      signupById,
    );
    if (!victim) continue;
    const displaced = await executeDisplacementFn({
      ...p,
      role,
      victim,
      signupById,
    });
    if (displaced) return true;
  }
  return false;
}

export async function tryRearrangeVictim(
  p: RearrangeVictimParams,
  logger: { log: (msg: string) => void },
): Promise<string | undefined> {
  const prefs = p.signupById.get(p.victim.signupId)?.preferredRoles ?? [];
  const altRoles = prefs.filter(
    (r) => r !== p.displacedRole && r in p.roleCapacity,
  );
  for (const altRole of altRoles) {
    const filled = p.currentAssignments.filter(
      (a) => a.role === altRole,
    ).length;
    if (filled >= p.roleCapacity[altRole]) continue;
    const newPos = p.findPos(altRole);
    await p.tx
      .update(schema.rosterAssignments)
      .set({ role: altRole, position: newPos })
      .where(eq(schema.rosterAssignments.id, p.victim.id));
    p.occupiedPositions[p.displacedRole]?.delete(p.victim.position);
    p.occupiedPositions[altRole]?.add(newPos);
    logger.log(
      `ROK-459: Rearranged tentative signup ${p.victim.signupId} from ${p.displacedRole} slot ${p.victim.position} to ${altRole} slot ${newPos}`,
    );
    return altRole;
  }
  return undefined;
}

export async function removeVictimAssignment(
  tx: Tx,
  victim: { id: number; signupId: number; position: number },
  role: string,
  occupiedPositions: Record<string, Set<number>>,
  logger: { log: (msg: string) => void },
) {
  await tx
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.id, victim.id));
  occupiedPositions[role]?.delete(victim.position);
  logger.log(
    `ROK-459: Displaced tentative signup ${victim.signupId} from ${role} slot ${victim.position} to unassigned pool`,
  );
}

export async function sendDisplacedNotification(
  p: DisplacedNotificationParams,
  notificationService: NotificationService,
  fetchNotificationCtx: (eventId: number) => Promise<Record<string, string>>,
) {
  const { tx, eventId, victimSignupId, role, rearrangedToRole } = p;
  const [signup] = await tx
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.id, victimSignupId))
    .limit(1);
  if (!signup?.userId) return;
  const [event] = await tx
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const eventTitle = event?.title ?? `Event #${eventId}`;
  const action = rearrangedToRole
    ? `moved to ${rearrangedToRole}`
    : 'moved to the unassigned pool';
  const extraPayload = await fetchNotificationCtx(eventId);
  await notificationService.create({
    userId: signup.userId,
    type: 'tentative_displaced',
    title: 'Roster update',
    message: `A confirmed player took your ${role} slot in "${eventTitle}". You've been ${action}.`,
    payload: { eventId, ...extraPayload },
  });
}
