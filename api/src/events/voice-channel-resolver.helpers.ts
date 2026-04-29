import type { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type {
  EventResponseDto,
  VoiceChannelResponseDto,
} from '@raid-ledger/contract';

export interface VoiceChannelResolverDeps {
  channelResolver: ChannelResolverService;
  bot: DiscordBotClientService;
}

export async function resolveVoiceChannelForEvent(
  deps: VoiceChannelResolverDeps,
  event: EventResponseDto,
  isAuthenticated: boolean,
): Promise<VoiceChannelResponseDto> {
  try {
    const channelId =
      event.notificationChannelOverride ??
      (await deps.channelResolver.resolveVoiceChannelForScheduledEvent(
        event.game?.id ?? null,
        event.recurrenceGroupId ?? null,
      ));
    if (!channelId) {
      return { channelId: null, channelName: null, guildId: null };
    }
    return await resolveChannelName(deps.bot, channelId, isAuthenticated);
  } catch {
    return { channelId: null, channelName: null, guildId: null };
  }
}

async function resolveChannelName(
  bot: DiscordBotClientService,
  channelId: string,
  isAuthenticated: boolean,
): Promise<VoiceChannelResponseDto> {
  try {
    const guildId = bot.getGuildId();
    const client = bot.getClient();
    if (guildId && client) {
      const guild =
        client.guilds.cache.get(guildId) ??
        (await client.guilds.fetch(guildId));
      const channel =
        guild.channels.cache.get(channelId) ??
        (await guild.channels.fetch(channelId));
      return {
        channelId,
        channelName: channel?.name ?? null,
        guildId: isAuthenticated ? guildId : null,
      };
    }
  } catch {
    // Discord API failure — return ID without name
  }
  return { channelId, channelName: null, guildId: null };
}
