/**
 * Helpers for UsersMeController.
 * Extracted from users-me.controller.ts for file size compliance (ROK-719).
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DeleteAccountSchema } from '@raid-ledger/contract';
import type { DiscordMembershipResponseDto } from '@raid-ledger/contract';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';

/** Check guild membership and generate invite if needed. */
export async function checkGuildMembership(
  discordBotClientService: DiscordBotClientService,
  channelResolver: ChannelResolverService,
  discordId: string,
  guildName: string,
): Promise<DiscordMembershipResponseDto> {
  const client = discordBotClientService.getClient();
  const guild = client?.guilds.cache.first();
  if (!guild) return { botConnected: false };
  try {
    await guild.members.fetch(discordId);
    return { botConnected: true, guildName, isMember: true };
  } catch {
    const inviteUrl = await generateJoinInvite(channelResolver, guild);
    return {
      botConnected: true,
      guildName,
      isMember: false,
      inviteUrl: inviteUrl ?? undefined,
    };
  }
}

/** Generate a Discord server invite for the join banner. */
async function generateJoinInvite(
  channelResolver: ChannelResolverService,
  guild: import('discord.js').Guild,
): Promise<string | null> {
  try {
    let channelId = await channelResolver.resolveChannelForEvent();
    if (!channelId && guild.systemChannelId) channelId = guild.systemChannelId;
    if (!channelId) {
      const firstText = guild.channels.cache.find(
        (ch) => ch.isTextBased() && !ch.isThread() && !ch.isDMBased(),
      );
      if (firstText) channelId = firstText.id;
    }
    if (!channelId) return null;
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !('createInvite' in channel)) return null;
    const invite = await channel.createInvite({
      maxAge: 86400,
      maxUses: 0,
      unique: false,
      reason: 'Discord join banner invite (ROK-425)',
    });
    return invite.url;
  } catch {
    return null;
  }
}

/** Validate and execute account deletion (ROK-405). */
export async function validateAndDeleteAccount(
  reqUser: { id: number; impersonatedBy?: number | null },
  body: unknown,
  usersService: Pick<
    import('./users.service').UsersService,
    'findById' | 'findAdmin' | 'deleteUser'
  >,
  avatarService: { delete: (url: string) => Promise<void> },
): Promise<void> {
  if (reqUser.impersonatedBy)
    throw new ForbiddenException('Cannot delete account while impersonating');
  const dto = DeleteAccountSchema.parse(body);
  const user = await usersService.findById(reqUser.id);
  if (!user) throw new NotFoundException('User not found');
  const expectedName = user.displayName || user.username;
  if (dto.confirmName !== expectedName)
    throw new BadRequestException(
      'Confirmation name does not match your display name',
    );
  const admin = await usersService.findAdmin();
  const reassignTo = admin && admin.id !== reqUser.id ? admin.id : reqUser.id;
  if (user.customAvatarUrl) await avatarService.delete(user.customAvatarUrl);
  await usersService.deleteUser(reqUser.id, reassignTo);
}
