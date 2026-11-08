/**
 * ROK-2097: a Discord button that resolves a signup the clicker may see but
 * not manage (owned by an account the Discord id was unlinked or re-linked
 * from) is treated as not-found — the service throws NotFoundException and
 * the clicker gets this reply instead of the dispatcher's generic error.
 */
import { NotFoundException } from '@nestjs/common';
import type { ButtonInteraction } from 'discord.js';

/** Reply when a button finds no signup this Discord user may manage. */
export const NOT_SIGNED_UP_REPLY = "You're not signed up for this event.";

/**
 * Run `action`; on NotFoundException reply {@link NOT_SIGNED_UP_REPLY} and
 * resolve `{ ok: false }`. Any other error is rethrown.
 */
export async function runOrReplyNotSignedUp<T>(
  interaction: Pick<ButtonInteraction, 'editReply'>,
  action: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    if (!(error instanceof NotFoundException)) throw error;
    await interaction.editReply({ content: NOT_SIGNED_UP_REPLY, embeds: [] });
    return { ok: false };
  }
}
