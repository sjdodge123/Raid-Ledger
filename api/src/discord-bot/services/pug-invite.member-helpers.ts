import { eq, and, isNull, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { Logger } from '@nestjs/common';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ChannelResolverService } from './channel-resolver.service';
import { buildInviteRelayEmbed } from './pug-invite.helpers';

/**
 * Find a guild member by username.
 */
export async function findGuildMember(
  clientService: DiscordBotClientService,
  discordUsername: string,
): Promise<{ id: string; avatarHash: string | null } | null> {
  const client = clientService.getClient();
  if (!client?.isReady()) return null;

  const guild = client.guilds.cache.first();
  if (!guild) return null;

  try {
    const members = await guild.members.fetch({
      query: discordUsername,
      limit: 10,
    });
    const match = members.find(
      (m) => m.user.username.toLowerCase() === discordUsername.toLowerCase(),
    );
    return match ? { id: match.user.id, avatarHash: match.user.avatar } : null;
  } catch {
    return null;
  }
}

/**
 * Update a PUG slot when a guild member is found.
 */
export async function handleMemberFound(
  db: PostgresJsDatabase<typeof schema>,
  pugSlotId: string,
  member: { id: string; avatarHash: string | null },
): Promise<typeof tables.pugSlots.$inferSelect | null> {
  await db
    .update(tables.pugSlots)
    .set({
      discordUserId: member.id,
      discordAvatarHash: member.avatarHash,
      status: 'invited',
      invitedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tables.pugSlots.id, pugSlotId));

  const [slot] = await db
    .select()
    .from(tables.pugSlots)
    .where(eq(tables.pugSlots.id, pugSlotId))
    .limit(1);
  return slot ?? null;
}

/**
 * Handle when a member is not found — generate invite and notify creator.
 */
export async function handleMemberNotFound(
  db: PostgresJsDatabase<typeof schema>,
  pugSlotId: string,
  discordUsername: string,
  inviteUrl: string | null,
  creatorUserId: number | undefined,
  clientService: DiscordBotClientService,
  logger: Logger,
): Promise<void> {
  if (!inviteUrl) return;

  await db
    .update(tables.pugSlots)
    .set({ serverInviteUrl: inviteUrl, updatedAt: new Date() })
    .where(eq(tables.pugSlots.id, pugSlotId));

  if (creatorUserId) {
    await notifyCreatorWithInvite(
      db,
      creatorUserId,
      discordUsername,
      inviteUrl,
      clientService,
      logger,
    );
  }
}

async function notifyCreatorWithInvite(
  db: PostgresJsDatabase<typeof schema>,
  creatorUserId: number,
  pugUsername: string,
  inviteUrl: string,
  clientService: DiscordBotClientService,
  logger: Logger,
): Promise<void> {
  const [creator] = await db
    .select({ discordId: tables.users.discordId })
    .from(tables.users)
    .where(eq(tables.users.id, creatorUserId))
    .limit(1);

  if (!creator?.discordId) return;

  const embed = buildInviteRelayEmbed(pugUsername, inviteUrl);
  try {
    await clientService.sendEmbedDM(creator.discordId, embed);
  } catch (error) {
    logger.warn(
      'Failed to send invite relay DM to creator %d: %s',
      creatorUserId,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

/**
 * Resolve the channel to use for generating a server invite.
 */
export async function resolveInviteChannel(
  guild: import('discord.js').Guild,
  channelResolver: ChannelResolverService,
): Promise<string | null> {
  let channelId = await channelResolver.resolveChannelForEvent();
  if (!channelId && guild.systemChannelId) {
    channelId = guild.systemChannelId;
  }
  if (!channelId) {
    const firstText = guild.channels.cache.find(
      (ch) => ch.isTextBased() && !ch.isThread() && !ch.isDMBased(),
    );
    if (firstText) channelId = firstText.id;
  }
  return channelId ?? null;
}

/**
 * Claim PUG slots for a new user by Discord ID or invite code.
 */
export async function claimPugSlotsInDb(
  db: PostgresJsDatabase<typeof schema>,
  discordUserId: string,
  userId: number,
  inviteCode?: string,
): Promise<number> {
  const conditions = [
    and(
      eq(tables.pugSlots.discordUserId, discordUserId),
      isNull(tables.pugSlots.claimedByUserId),
    ),
  ];

  if (inviteCode) {
    conditions.push(
      and(
        eq(tables.pugSlots.inviteCode, inviteCode),
        isNull(tables.pugSlots.claimedByUserId),
      ),
    );
  }

  const result = await db
    .update(tables.pugSlots)
    .set({
      claimedByUserId: userId,
      status: 'claimed',
      updatedAt: new Date(),
    })
    .where(or(...conditions))
    .returning();

  return result.length;
}
