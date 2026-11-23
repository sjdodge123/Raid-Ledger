import { HttpException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { PugInviteDeps } from './pug-invite.helpers';
import type { CreateDiscordSignupDto } from '@raid-ledger/contract';
import {
  ACCOUNT_BLOCKED_REPLY,
  resolveDiscordAccount,
} from '../../users/discord-account-status.helpers';

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

/** The Discord-button path's copy for a failed signup (signup-interaction.listener). */
const SIGNUP_FAILED_REPLY = 'Something went wrong. Please try again.';

/**
 * Create an event signup + roster for an accepted PUG.
 * @returns null when the signup was created (or there is no Discord id), else
 * the reply to show instead of "Accepted!" — the 409 reason (e.g. signups
 * closed) or the generic failure copy, as the Discord signup button replies.
 */
export async function createPugSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
  role: string,
): Promise<string | null> {
  const discordUserId = slot.discordUserId;
  if (!discordUserId) return null;
  const account = await resolveDiscordAccount(deps.db, discordUserId);
  // ROK-2298 (AC 3, Q5): a blocked invitee is refused — never anonymous.
  if (account.kind === 'blocked') return ACCOUNT_BLOCKED_REPLY;
  if (account.kind === 'linked') {
    return createLinkedPugSignup(deps, slot, account.user, role);
  }
  return createAnonymousPugSignup(deps, slot, discordUserId, role);
}

/** Reply copy for a signup that threw: the 409 reason, else generic copy. */
function signupFailureReply(err: unknown): string {
  if (err instanceof HttpException && err.getStatus() === 409) {
    return err.message;
  }
  return SIGNUP_FAILED_REPLY;
}

/** Replace the accept reply with why no signup was created. */
export async function replyPugSignupFailed(
  interaction: {
    editReply(options: { content: string; components: [] }): Promise<unknown>;
  },
  reply: string,
): Promise<void> {
  await interaction.editReply({ content: reply, components: [] });
}

/** Create signup for a linked user PUG. */
async function createLinkedPugSignup(
  deps: PugInviteDeps,
  slot: PugSlot,
  linkedUser: { id: number },
  role: string,
): Promise<string | null> {
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
    return null;
  } catch (err) {
    deps.logger.warn(
      `Failed to create signup for PUG ${slot.discordUsername}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
    return signupFailureReply(err);
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
): Promise<string | null> {
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
    return null;
  } catch (err) {
    deps.logger.warn(
      `Failed to create anonymous signup for PUG ${slot.discordUsername}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
    return signupFailureReply(err);
  }
}

/** Map a PUG slot role onto the Discord signup DTO's role (omit unknowns). */
function toDiscordRole(role: string): Pick<CreateDiscordSignupDto, 'role'> {
  return isDiscordRole(role) ? { role } : {};
}

function isDiscordRole(role: string): role is DiscordRole {
  return (DISCORD_ROLES as readonly string[]).includes(role);
}
