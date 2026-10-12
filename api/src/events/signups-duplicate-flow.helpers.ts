/**
 * Duplicate-signup row maintenance for the signup flow (ROK-1769).
 * Extracted from signups-flow.helpers.ts for file-size compliance.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CreateSignupDto, SignupResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import * as signupH from './signups-signup.helpers';
import { getCharacterById } from './signups-cancel.helpers';
import { buildSignupResponseDto } from './signups-roster.helpers';
import { getAssignedSlotRole } from './signups-roster-query.helpers';

type Tx = PostgresJsDatabase<typeof schema>;
type SignupRow = typeof schema.eventSignups.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

/**
 * Apply a duplicate signup's row updates: reactivate a departed/declined row,
 * sync character/discord id/preferred roles, and release any assignment the
 * caller's ensureAssignment must recompute. Returns whether the row was
 * reactivated so the service can emit SIGNUP_EVENTS.UPDATED.
 */
export async function applyDuplicateRowUpdates(
  tx: Tx,
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
  user: UserRow | undefined,
  hasCharacter: boolean,
): Promise<boolean> {
  // reactivateIfCancelled mutates `existing` in-place (including characterId).
  // updateCharacterIfNeeded's equality guard relies on this — it's a no-op for
  // the reactivation path because existing.characterId is already synced.
  const reactivated = await signupH.reactivateIfCancelled(
    tx,
    existing,
    dto,
    hasCharacter,
  );
  await signupH.updateCharacterIfNeeded(tx, existing, dto);
  // Opportunistic repair: back-fill discordUserId if user is linked (ROK-985)
  await signupH.repairSignupDiscordId(tx, existing, user);
  const rolesChanged = await signupH.updatePreferredRolesIfNeeded(
    tx,
    existing,
    dto,
  );
  if (rolesChanged || (reactivated && (await isBenched(tx, existing.id))))
    await clearAssignment(tx, existing.id);
  return reactivated;
}

/**
 * A departed member keeps a bench assignment (departure's moveToBench). On
 * reactivation that bench row is released so ensureAssignment re-slots them
 * like a fresh signup — back onto the roster if a slot is free, otherwise
 * onto the bench again.
 */
async function isBenched(tx: Tx, signupId: number): Promise<boolean> {
  return (await getAssignedSlotRole(tx, signupId)) === 'bench';
}

async function clearAssignment(tx: Tx, signupId: number): Promise<void> {
  await tx
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId));
}

/**
 * Duplicate-signup response, carrying the signup's current `assignedSlot` so
 * callers can tell a re-rostered member they landed on the bench.
 */
export async function buildDuplicateResponse(
  tx: Tx,
  existing: SignupRow,
  user: UserRow | undefined,
): Promise<SignupResponseDto> {
  const character = existing.characterId
    ? await getCharacterById(tx, existing.characterId)
    : null;
  const slot = await getAssignedSlotRole(tx, existing.id);
  return buildSignupResponseDto(existing, user, character, slot ?? undefined);
}
