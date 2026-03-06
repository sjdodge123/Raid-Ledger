import { eq, and } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import * as schema from '../../drizzle/schema';
import type { PugRole } from '@raid-ledger/contract';
import type { PugInviteDeps } from './pug-invite.helpers';
import { safeDeferReply, safeErrorReply } from './pug-invite.helpers';

/**
 * Handle "Join Event" button from invite link unfurl (ROK-263).
 */
export async function handleJoinEventButton(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  inviteCode: string,
): Promise<void> {
  if (!(await safeDeferReply(interaction, deps.logger))) return;
  try {
    await doJoinEvent(deps, interaction, inviteCode);
  } catch (error) {
    deps.logger.error(
      'Error handling Join Event for invite %s:',
      inviteCode,
      error,
    );
    await safeErrorReply(
      interaction,
      'Something went wrong. Please try again.',
    );
  }
}

interface ValidatedJoinContext {
  slot: { id: string; eventId: number; role: string };
  event: typeof schema.events.$inferSelect;
}

/** Validate the invite code and event, returning null if invalid. */
async function validateJoinContext(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  inviteCode: string,
): Promise<ValidatedJoinContext | null> {
  const slot = await deps.pugsService.findByInviteCode(inviteCode);
  if (!slot) {
    await interaction.editReply({ content: 'This invite is no longer valid.' });
    return null;
  }
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, slot.eventId))
    .limit(1);
  if (!event || event.cancelledAt) {
    await interaction.editReply({
      content: 'This event is no longer available.',
    });
    return null;
  }
  return { slot, event };
}

/** Inner logic for Join Event button. */
async function doJoinEvent(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  inviteCode: string,
): Promise<void> {
  const ctx = await validateJoinContext(deps, interaction, inviteCode);
  if (!ctx) return;
  const linkedUser = await findLinkedUser(deps, interaction.user.id);
  if (!linkedUser) {
    await replyWithWebLink(interaction, inviteCode);
    return;
  }
  if (await checkExistingSignup(deps, ctx.slot.eventId, linkedUser.id)) {
    await interaction.editReply({
      content: "You're already signed up for this event!",
    });
    return;
  }
  await createSignupAndCleanup(
    deps,
    interaction,
    ctx.slot,
    linkedUser,
    ctx.event.title,
  );
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

async function replyWithWebLink(
  interaction: ButtonInteraction,
  inviteCode: string,
): Promise<void> {
  const clientUrl = process.env.CLIENT_URL ?? '';
  const inviteUrl = `${clientUrl}/i/${inviteCode}`;
  await interaction.editReply({
    content: `You need a Raid Ledger account to join. Click here to sign up:\n${inviteUrl}`,
  });
}

async function checkExistingSignup(
  deps: PugInviteDeps,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const [existing] = await deps.db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return !!existing;
}

async function createSignupAndCleanup(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  slot: { id: string; eventId: number; role: string },
  linkedUser: { id: number },
  eventTitle: string,
): Promise<void> {
  try {
    await deps.signupsService.signup(slot.eventId, linkedUser.id, {
      slotRole: slot.role as PugRole,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to sign up';
    await interaction.editReply({ content: msg });
    return;
  }
  await deps.db.delete(schema.pugSlots).where(eq(schema.pugSlots.id, slot.id));
  await interaction.editReply({
    content: `You've joined **${eventTitle}**! Check the event page for details.`,
  });
  deps.logger.log(
    'Discord user %s joined event %d via invite link %s',
    interaction.user.username,
    slot.eventId,
    slot.id,
  );
}
