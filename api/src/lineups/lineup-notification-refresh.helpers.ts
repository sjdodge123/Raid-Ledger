/**
 * Persistence + in-place refresh helpers for the lineup-created embed (ROK-1063).
 * Extracted from lineup-notification.service.ts to keep the service under the
 * 300-line ESLint limit.
 */
import type { Logger } from '@nestjs/common';
import type { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Stored Discord reference for the lineup-created embed. */
export interface CreatedEmbedRef {
  channelId: string;
  messageId: string;
  targetDate: Date | null;
}

/** Persist the channel/message IDs of the lineup-created embed. */
export async function persistCreatedEmbedRef(
  db: Db,
  lineupId: number,
  channelId: string,
  messageId: string,
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({
      discordCreatedChannelId: channelId,
      discordCreatedMessageId: messageId,
    })
    .where(eq(schema.communityLineups.id, lineupId));
}

/** Load the stored creation-embed ref (null if not posted or channel missing). */
export async function loadCreatedEmbedRef(
  db: Db,
  lineupId: number,
): Promise<CreatedEmbedRef | null> {
  const [row] = await db
    .select({
      channelId: schema.communityLineups.discordCreatedChannelId,
      messageId: schema.communityLineups.discordCreatedMessageId,
      targetDate: schema.communityLineups.targetDate,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!row?.channelId || !row?.messageId) return null;
  return {
    channelId: row.channelId,
    messageId: row.messageId,
    targetDate: row.targetDate ?? null,
  };
}

/**
 * Edit a stored creation-embed in place.
 * Swallows Discord errors so the caller's flow is unaffected.
 */
export async function editCreatedEmbedSafe(
  botClient: DiscordBotClientService,
  logger: Logger,
  lineupId: number,
  ref: CreatedEmbedRef,
  embed: EmbedBuilder,
  row: ActionRowBuilder<ButtonBuilder>,
): Promise<void> {
  try {
    await botClient.editEmbed(ref.channelId, ref.messageId, embed, row);
  } catch (err) {
    logger.warn(
      `Failed to edit lineup-created embed for lineup ${lineupId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
