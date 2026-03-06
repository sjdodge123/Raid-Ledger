import { eq, and } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { PugInviteDeps } from './pug-invite.helpers';

type PugSlot = typeof schema.pugSlots.$inferSelect;
type SlotRole = 'tank' | 'healer' | 'dps' | 'flex' | 'player' | 'bench';

/** Create an event signup + roster for an accepted PUG. */
export async function createPugSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
  role: string,
): Promise<void> {
  const discordUserId = slot.discordUserId;
  if (!discordUserId) return;
  const linkedUser = await findLinkedUser(deps, discordUserId);
  if (linkedUser) {
    await createLinkedPugSignup(deps, slot, linkedUser, role);
    return;
  }
  await createAnonymousPugSignup(deps, slot, discordUserId, role);
}

async function findLinkedUser(
  deps: PugInviteDeps,
  discordId: string,
): Promise<{ id: number } | null> {
  const [user] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return user ?? null;
}

/** Create signup for a linked user PUG. */
async function createLinkedPugSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
  linkedUser: { id: number },
  role: string,
): Promise<void> {
  await deleteOrphanedAnonymousSignup(deps, slot);
  try {
    const result = await deps.signupsService.signup(
      slot.eventId,
      linkedUser.id,
      { slotRole: role as SlotRole },
    );
    deps.logger.log(
      'Created signup %d for PUG %s (linked user %d) on event %d',
      result.id,
      slot.discordUsername,
      linkedUser.id,
      slot.eventId,
    );
  } catch (err) {
    deps.logger.warn(
      'Failed to create signup for PUG %s: %s',
      slot.discordUsername,
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
}

/** ROK-652: Delete orphaned anonymous signup before creating linked signup. */
async function deleteOrphanedAnonymousSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
): Promise<void> {
  await deps.db
    .delete(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, slot.eventId),
        eq(schema.eventSignups.discordUserId, slot.discordUserId!),
      ),
    );
}

/** Create anonymous signup for unlinked PUG. */
async function createAnonymousPugSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
  discordUserId: string,
  role: string,
): Promise<void> {
  try {
    const [signup] = await insertAnonymousSignup(deps, slot, discordUserId);
    if (signup) {
      await assignAnonymousRoster(deps, slot.eventId, signup.id, role);
      deps.logger.log(
        'Created anonymous signup %d for PUG %s on event %d',
        signup.id,
        slot.discordUsername,
        slot.eventId,
      );
    }
  } catch (err) {
    deps.logger.warn(
      'Failed to create anonymous signup for PUG %s: %s',
      slot.discordUsername,
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
}

/** Insert the anonymous signup row. */
async function insertAnonymousSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
  discordUserId: string,
): Promise<(typeof schema.eventSignups.$inferSelect)[]> {
  return deps.db
    .insert(schema.eventSignups)
    .values({
      eventId: slot.eventId,
      discordUserId,
      discordUsername: slot.discordUsername,
      discordAvatarHash: slot.discordAvatarHash,
      confirmationStatus: 'pending',
      status: 'signed_up',
    })
    .onConflictDoNothing()
    .returning();
}

/** Assign roster position for an anonymous PUG signup. */
async function assignAnonymousRoster(
  deps: PugInviteDeps,
  eventId: number,
  signupId: number,
  role: string,
): Promise<void> {
  const positionsInRole = await deps.db
    .select({ position: schema.rosterAssignments.position })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, role),
      ),
    );
  const nextPosition =
    positionsInRole.reduce((max, r) => Math.max(max, r.position), 0) + 1;
  await deps.db.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role,
    position: nextPosition,
    isOverride: 0,
  });
}
