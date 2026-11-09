/**
 * Roster write helpers for PATCH /events/:id/roster (ROK-2141).
 * Every write is keyed on the signup id so anonymous Discord signups
 * (`event_signups.user_id IS NULL`, sent with userId 0) can hold a slot.
 * Moved out of signups-notification.helpers.ts.
 */
import { BadRequestException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { UpdateRosterDto } from '@raid-ledger/contract';
import type { Tx } from './signups.service.types';

type SignupRow = typeof schema.eventSignups.$inferSelect;
type Assignment = UpdateRosterDto['assignments'][number];

/** An assignment whose signup has been resolved and verified for the event. */
export type ResolvedAssignment = Assignment & { signupId: number };

/** The event's signups, indexed, plus the payload resolved to signup ids. */
export interface RosterSignups {
  /** Keyed by user id (anonymous signups share the `null` key) — notifications only. */
  signupByUserId: Map<number | null, SignupRow>;
  signupById: Map<number, SignupRow>;
  assignments: ResolvedAssignment[];
}

interface BenchPromotionCanceller {
  cancelPromotion: (
    eventId: number,
    role: string,
    position: number,
  ) => Promise<void>;
}

/**
 * Resolve each assignment to one of the event's signups: by `signupId` when
 * given (its owner must match a non-zero `userId`), else by `userId`.
 * Throws 400 on a signup outside the event, a user/signup mismatch, a signup
 * listed twice, or a character override on an anonymous signup.
 */
export async function validateRosterAssignments(
  db: Tx,
  eventId: number,
  assignments: UpdateRosterDto['assignments'],
): Promise<RosterSignups> {
  const signups = await db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  const signupById = new Map(signups.map((s) => [s.id, s]));
  const signupByUserId = new Map(signups.map((s) => [s.userId, s]));
  const resolved = assignments.map((a) =>
    resolveAssignment(a, signupById, signupByUserId),
  );
  assertHonourable(resolved, signupById);
  return { signupByUserId, signupById, assignments: resolved };
}

/**
 * Reject a payload the write could only honour partially (ROK-2141): a signup
 * listed twice, or a character override on an anonymous signup (it has no
 * user, so no character of its own). 400 instead of a 500 or a silent skip.
 */
function assertHonourable(
  assignments: ResolvedAssignment[],
  signupById: Map<number, SignupRow>,
): void {
  const seen = new Set<number>();
  for (const a of assignments) {
    if (seen.has(a.signupId)) {
      throw new BadRequestException(
        `Signup ${a.signupId} appears more than once in the roster`,
      );
    }
    seen.add(a.signupId);
    if (a.characterId && signupById.get(a.signupId)?.userId == null) {
      throw new BadRequestException(
        `Signup ${a.signupId} is anonymous and cannot be given a character`,
      );
    }
  }
}

function resolveAssignment(
  a: Assignment,
  signupById: Map<number, SignupRow>,
  signupByUserId: Map<number | null, SignupRow>,
): ResolvedAssignment {
  if (a.signupId === undefined) {
    const byUser = a.userId > 0 ? signupByUserId.get(a.userId) : undefined;
    if (!byUser) {
      throw new BadRequestException(
        `User ${a.userId} is not signed up for this event`,
      );
    }
    return { ...a, signupId: byUser.id };
  }
  const signup = signupById.get(a.signupId);
  if (!signup) {
    throw new BadRequestException(
      `Signup ${a.signupId} is not part of this event`,
    );
  }
  if (a.userId > 0 && signup.userId !== a.userId) {
    throw new BadRequestException(
      `Signup ${a.signupId} does not belong to user ${a.userId}`,
    );
  }
  return { ...a, signupId: signup.id };
}

/**
 * Replace the event's roster with `assignments`. Returns the userIds whose
 * pending signup flipped to confirmed (ROK-1269).
 */
export async function replaceRosterAssignments(
  db: Tx,
  eventId: number,
  assignments: ResolvedAssignment[],
  signupById: Map<number, SignupRow>,
  benchPromotionService: BenchPromotionCanceller,
): Promise<number[]> {
  await db
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
  await updateCharacterOverrides(db, assignments);
  if (assignments.length === 0) return [];
  return insertNewAssignments(
    db,
    eventId,
    assignments,
    signupById,
    benchPromotionService,
  );
}

async function updateCharacterOverrides(
  db: Tx,
  assignments: ResolvedAssignment[],
): Promise<void> {
  for (const a of assignments) {
    if (!a.characterId) continue;
    await db
      .update(schema.eventSignups)
      .set({ characterId: a.characterId, confirmationStatus: 'confirmed' })
      .where(eq(schema.eventSignups.id, a.signupId));
  }
}

async function insertNewAssignments(
  db: Tx,
  eventId: number,
  assignments: ResolvedAssignment[],
  signupById: Map<number, SignupRow>,
  benchPromotionService: BenchPromotionCanceller,
): Promise<number[]> {
  const values = assignments.map((a) => ({
    eventId,
    signupId: a.signupId,
    role: a.slot,
    position: a.position,
    isOverride: a.isOverride ? 1 : 0,
  }));
  await db.insert(schema.rosterAssignments).values(values);
  const reconfirmedUserIds = await confirmNonBenchSignups(
    db,
    assignments,
    signupById,
  );
  for (const a of assignments) {
    if (a.slot && a.slot !== 'bench') {
      await benchPromotionService.cancelPromotion(eventId, a.slot, a.position);
    }
  }
  return reconfirmedUserIds;
}

/**
 * Flips matching pending signups to confirmed, returning the userIds whose
 * status actually changed (ROK-1269 — caller emits signup_reconfirmed
 * activity-log entries per returned userId; anonymous signups have none).
 */
async function confirmNonBenchSignups(
  db: Tx,
  assignments: ResolvedAssignment[],
  signupById: Map<number, SignupRow>,
): Promise<number[]> {
  const flipped = assignments
    .filter((a) => a.slot && a.slot !== 'bench')
    .map((a) => signupById.get(a.signupId))
    .filter((s): s is SignupRow => s?.confirmationStatus === 'pending');
  const ids = flipped.map((s) => s.id);
  if (ids.length === 0) return [];
  await db
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'confirmed' })
    .where(inArray(schema.eventSignups.id, ids));
  return flipped.map((s) => s.userId).filter((u): u is number => u !== null);
}
