/**
 * Operator-scoped controller for listing Discord text channels (ROK-1064).
 *
 * Endpoint: GET /discord/channels
 * Query:    permissions=postable — filter to channels where the bot has
 *           ViewChannel + SendMessages + EmbedLinks. Any other value or
 *           omitted returns all text channels.
 *
 * Returns 503 when the Discord bot is not connected to a guild.
 */
import {
  Controller,
  Get,
  Query,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsBitField, type Guild, type GuildChannel } from 'discord.js';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DiscordBotClientService } from './discord-bot-client.service';
import type { DiscordChannelListResponseDto } from '@raid-ledger/contract';

/** Required permission flags for "postable" filtering. */
const POSTABLE_FLAGS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
] as const;

@Controller('discord/channels')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('operator')
export class DiscordChannelsController {
  constructor(private readonly clientService: DiscordBotClientService) {}

  /** GET /discord/channels — operator-scoped text channel list. */
  @Get()
  listChannels(
    @Query('permissions') permissions?: string,
  ): DiscordChannelListResponseDto {
    const guild = this.clientService.getGuild();
    if (!guild) {
      throw new ServiceUnavailableException(
        'Discord bot is not connected to a guild',
      );
    }
    const all = collectTextChannels(guild);
    const filtered =
      permissions === 'postable' ? filterPostable(guild, all) : all;
    const data = filtered
      .map((ch) => ({ id: ch.id, name: ch.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { data };
  }
}

/** Collect all text-capable, non-thread, non-DM channels from a guild. */
function collectTextChannels(guild: Guild): GuildChannel[] {
  const out: GuildChannel[] = [];
  guild.channels.cache.forEach((ch) => {
    if (!ch) return;
    if (typeof ch.isTextBased !== 'function' || !ch.isTextBased()) return;
    if (typeof ch.isDMBased === 'function' && ch.isDMBased()) return;
    if (
      'isThread' in ch &&
      typeof (ch as { isThread?: () => boolean }).isThread === 'function' &&
      (ch as { isThread: () => boolean }).isThread()
    )
      return;
    out.push(ch as GuildChannel);
  });
  return out;
}

/** Keep only channels where the bot can post embeds. */
function filterPostable(
  guild: Guild,
  channels: GuildChannel[],
): GuildChannel[] {
  const me = guild.members?.me;
  if (!me) return [];
  return channels.filter((ch) => botHasPostPerms(ch, me));
}

/** Check bot post perms on a single channel. */
function botHasPostPerms(
  channel: GuildChannel,
  me: Guild['members']['me'],
): boolean {
  if (!me) return false;
  if (typeof channel.permissionsFor === 'function') {
    const perms = channel.permissionsFor(me);
    if (!perms) return false;
    return perms.has([...POSTABLE_FLAGS]);
  }
  return false;
}
