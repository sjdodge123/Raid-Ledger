/**
 * ROK-1933 L3 — pure-ish pieces of the claim-DM button listener.
 */
import type { Logger } from '@nestjs/common';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { GuildActor } from '../../guilds/guild-access.service';
import type { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { claimSuggestKeys } from '../../plugins/valheim/armory/identity/valheim-claim-suggest.copy';

/** Edit the DM (buttons off), or answer only the clicker (DM untouched). */
export interface ClaimOutcome {
  edit: boolean;
  content: string;
}

/** An outcome that edits the DM and removes its buttons. */
export const editDm = (content: string): ClaimOutcome => ({
  edit: true,
  content,
});

/** An outcome only the clicker sees; the DM keeps its buttons. */
export const refuseClick = (content: string): ClaimOutcome => ({
  edit: false,
  content,
});

/**
 * The clicking RL user, resolved from the interaction's Discord id.
 *
 * @param db - Drizzle handle.
 * @param discordId - The interaction user's snowflake.
 * @returns The actor, or null when unlinked, deactivated or banned.
 */
export async function findClaimClicker(
  db: PostgresJsDatabase<typeof schema>,
  discordId: string,
): Promise<GuildActor | null> {
  const [u] = await db
    .select({
      id: schema.users.id,
      role: schema.users.role,
      deactivatedAt: schema.users.deactivatedAt,
      bannedAt: schema.users.bannedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  if (!u || u.deactivatedAt !== null || u.bannedAt !== null) return null;
  return { id: u.id, role: u.role };
}

/**
 * The clicker, but only when the DM scan actually asked them about this
 * character (the pair key is held) — so a forged id changes nothing.
 *
 * @param db - Drizzle handle.
 * @param dedup - Holds the scan's pair key.
 * @param discordId - The interaction user's snowflake.
 * @param profileId - The character the button names.
 * @returns The actor, or null when this press is not theirs to make.
 */
export async function findAskedClicker(
  db: PostgresJsDatabase<typeof schema>,
  dedup: NotificationDedupService,
  discordId: string,
  profileId: number,
): Promise<GuildActor | null> {
  const clicker = await findClaimClicker(db, discordId);
  if (!clicker) return null;
  const asked = await dedup.isMarked(
    claimSuggestKeys.pair(profileId, clicker.id),
  );
  return asked ? clicker : null;
}

/**
 * Answer a deferred press: an edit removes the DM's buttons, a refusal is an
 * ephemeral follow-up. A dead interaction is logged, never thrown.
 *
 * @param interaction - The deferred button interaction.
 * @param outcome - What to say and where.
 * @param logger - The listener's logger.
 */
export async function deliverClaimOutcome(
  interaction: ButtonInteraction,
  outcome: ClaimOutcome,
  logger: Logger,
): Promise<void> {
  const sent = outcome.edit
    ? interaction.editReply({ content: outcome.content, components: [] })
    : interaction.followUp({
        content: outcome.content,
        flags: MessageFlags.Ephemeral,
      });
  await sent.catch(() => {
    logger.warn(`Could not deliver the claim-DM answer: ${outcome.content}`);
  });
}
