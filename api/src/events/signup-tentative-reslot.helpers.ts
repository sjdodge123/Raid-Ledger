import { Logger } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { insertAssignment } from './signup-allocation.helpers';

const logger = new Logger('SignupTentativeReslot');

export async function reslotTentativePlayer(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  vacatedRole: string,
  vacatedPosition: number,
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const candidate = await findTentativeCandidate(tx, eventId, vacatedRole);
    if (!candidate) return null;

    const slotFilled = await isSlotOccupied(
      tx,
      eventId,
      vacatedRole,
      vacatedPosition,
    );
    if (slotFilled) return null;

    await insertAssignment(
      tx,
      eventId,
      candidate.id,
      vacatedRole,
      vacatedPosition,
    );
    return candidate.id;
  });
}

async function findTentativeCandidate(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  role: string,
): Promise<{ id: number } | null> {
  const candidates = await tx
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
        eq(schema.eventSignups.status, 'tentative'),
        isNull(schema.rosterAssignments.id),
      ),
    )
    .orderBy(schema.eventSignups.signedUpAt);

  return (
    candidates.find((c) => {
      const prefs = c.preferredRoles ?? [];
      return prefs.includes(role);
    }) ?? null
  );
}

async function isSlotOccupied(
  tx: PostgresJsDatabase<typeof schema>,
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

type AutoAllocateFn = (
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  slotConfig: Record<string, unknown> | null,
  benchPromo: BenchPromotionService,
) => Promise<void>;

export async function checkTentativeDisplacement(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  tentativeSignupId: number,
  benchPromo: BenchPromotionService,
  autoAllocateFn?: AutoAllocateFn,
): Promise<void> {
  const role = await findTentativeAssignmentRole(
    db,
    eventId,
    tentativeSignupId,
  );
  if (!role) return;

  const candidate = await findConfirmedCandidate(db, eventId, role);
  if (!candidate) return;

  const slotConfig = await getMmoSlotConfig(db, eventId);
  if (!slotConfig || !autoAllocateFn) return;

  await db.transaction(async (tx) => {
    await autoAllocateFn(tx, eventId, candidate.id, slotConfig, benchPromo);
  });

  logger.log(
    `ROK-459: Triggered displacement check after signup ${tentativeSignupId} went tentative — candidate ${candidate.id}`,
  );
}

async function findTentativeAssignmentRole(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<string | null> {
  const [assignment] = await db
    .select()
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

async function getMmoSlotConfig(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<Record<string, unknown> | null> {
  const [event] = await db
    .select({ slotConfig: schema.events.slotConfig })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const slotConfig = event?.slotConfig as Record<string, unknown> | null;
  return slotConfig?.type === 'mmo' ? slotConfig : null;
}

async function findConfirmedCandidate(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  role: string,
): Promise<{ id: number } | null> {
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
    unassigned.find((s) => {
      const prefs = s.preferredRoles ?? [];
      return prefs.includes(role);
    }) ?? null
  );
}
