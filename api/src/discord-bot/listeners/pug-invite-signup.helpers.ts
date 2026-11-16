import { eq, and } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { PugInviteDeps } from './pug-invite.helpers';
import type { CreateDiscordSignupDto } from '@raid-ledger/contract';

type PugSlot = typeof schema.pugSlots.$inferSelect;
type SlotRole = 'tank' | 'healer' | 'dps' | 'flex' | 'player' | 'bench';
type DiscordRole = NonNullable<CreateDiscordSignupDto['role']>;
const DISCORD_ROLES: readonly DiscordRole[] = [
  'tank',
  'healer',
  'dps',
  'flex',
  'player',
];

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
      `Created signup ${result.id} for PUG ${slot.discordUsername} (linked user ${linkedUser.id}) on event ${slot.eventId}`,
    );
  } catch (err) {
    deps.logger.warn(
      `Failed to create signup for PUG ${slot.discordUsername}: ${err instanceof Error ? err.message : 'Unknown error'}`,
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

/**
 * Create the signup for an unlinked PUG through `signupDiscord` — the same
 * transaction as an anonymous Discord signup, so the one auto-bench rule
 * (`resolveAutoBench`) and ROK-459 tentative displacement apply (ROK-2203).
 */
async function createAnonymousPugSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
  discordUserId: string,
  role: string,
): Promise<void> {
  try {
    const result = await deps.signupsService.signupDiscord(slot.eventId, {
      discordUserId,
      discordUsername: slot.discordUsername ?? discordUserId,
      discordAvatarHash: slot.discordAvatarHash,
      ...toDiscordRole(role),
    });
    deps.logger.log(
      `Created anonymous signup ${result.id} for PUG ${slot.discordUsername} on event ${slot.eventId} (${result.assignedSlot ?? 'unassigned'})`,
    );
  } catch (err) {
    deps.logger.warn(
      `Failed to create anonymous signup for PUG ${slot.discordUsername}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

/** Map a PUG slot role onto the Discord signup DTO's role (omit unknowns). */
function toDiscordRole(role: string): Pick<CreateDiscordSignupDto, 'role'> {
  return isDiscordRole(role) ? { role } : {};
}

function isDiscordRole(role: string): role is DiscordRole {
  return (DISCORD_ROLES as readonly string[]).includes(role);
}
