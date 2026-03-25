/**
 * Signup and roster slot helpers for ad-hoc events (ROK-959 extraction).
 * Extracted from ad-hoc-event.helpers.ts to stay within max-lines limit.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { VoiceMemberInfo } from './ad-hoc-participant.service';

/**
 * Auto-create a signup and roster slot for an ad-hoc participant.
 * Idempotent: skips if the participant already has a signup.
 */
export async function autoSignupParticipant(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  member: VoiceMemberInfo,
): Promise<void> {
  const [existing] = await db
    .select({ id: tables.eventSignups.id })
    .from(tables.eventSignups)
    .where(
      and(
        eq(tables.eventSignups.eventId, eventId),
        eq(tables.eventSignups.discordUserId, member.discordUserId),
      ),
    )
    .limit(1);

  if (existing) return;

  const signup = await insertSignup(db, eventId, member);
  if (!signup) return;

  await assignSlot(db, eventId, signup.id);
}

/** Insert a signup row for an ad-hoc participant. */
async function insertSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  member: VoiceMemberInfo,
): Promise<{ id: number } | null> {
  const [signup] = await db
    .insert(tables.eventSignups)
    .values({
      eventId,
      userId: member.userId,
      discordUserId: member.discordUserId,
      discordUsername: member.discordUsername,
      discordAvatarHash: member.discordAvatarHash,
      confirmationStatus: 'confirmed',
      status: 'signed_up',
    })
    .onConflictDoNothing()
    .returning({ id: tables.eventSignups.id });

  return signup ?? null;
}

/** Assign a signup to the next available player or bench slot. */
async function assignSlot(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<void> {
  const maxPlayers = 25;
  const maxBench = 10;

  const playerSlot = await findNextSlot(db, eventId, 'player', maxPlayers);
  if (playerSlot) {
    await db.insert(tables.rosterAssignments).values({
      eventId,
      signupId,
      role: 'player',
      position: playerSlot,
      isOverride: 0,
    });
    return;
  }

  const benchSlot = await findNextSlot(db, eventId, 'bench', maxBench);
  if (benchSlot) {
    await db.insert(tables.rosterAssignments).values({
      eventId,
      signupId,
      role: 'bench',
      position: benchSlot,
      isOverride: 0,
    });
  }
}

/** Find the next available position for a given role. */
async function findNextSlot(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  role: string,
  max: number,
): Promise<number | null> {
  const existing = await db
    .select({ position: tables.rosterAssignments.position })
    .from(tables.rosterAssignments)
    .where(
      and(
        eq(tables.rosterAssignments.eventId, eventId),
        eq(tables.rosterAssignments.role, role),
      ),
    );

  const used = new Set(existing.map((s) => s.position));
  let pos = 1;
  while (used.has(pos) && pos <= max) pos++;
  return pos <= max ? pos : null;
}
