import { eq, and } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import { ForbiddenException } from '@nestjs/common';
import * as schema from '../../drizzle/schema';
import type { PugRole } from '@raid-ledger/contract';
import type { PugInviteDeps } from './pug-invite.helpers';
import { safeDeferReply, safeErrorReply } from './pug-invite.helpers';
import { errorStack } from '../../common/error-format.helpers';
import { assertClaimerIsInvitee } from '../../events/invite.helpers';

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
      `Error handling Join Event for invite ${inviteCode}`,
      errorStack(error),
    );
    await safeErrorReply(
      interaction,
      'Something went wrong. Please try again.',
    );
  }
}

interface JoinSlot {
  id: string;
  eventId: number;
  role: string;
  discordUserId: string | null;
}

interface ValidatedJoinContext {
  slot: JoinSlot;
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
  if (await refuseNonInvitee(interaction, ctx.slot)) return;
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

/**
 * ROK-1825: the web claim's invitee binding, applied before anything is
 * written — a reserved slot is never signed into or deleted by someone else.
 */
async function refuseNonInvitee(
  interaction: ButtonInteraction,
  slot: JoinSlot,
): Promise<boolean> {
  try {
    assertClaimerIsInvitee(slot, interaction.user.id);
    return false;
  } catch (err) {
    if (!(err instanceof ForbiddenException)) throw err;
    await interaction.editReply({
      content: 'This spot is reserved for another player.',
    });
    return true;
  }
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
  slot: JoinSlot,
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
    `Discord user ${interaction.user.username} joined event ${slot.eventId} via invite link ${slot.id}`,
  );
}
