import { Logger } from '@nestjs/common';
import type { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type {
  EventResponseDto,
  VoiceChannelResponseDto,
} from '@raid-ledger/contract';

const logger = new Logger('VoiceChannelResolver');

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
    // ROK-1389: route through the shared voice-aware resolver so a text override
    // no longer masquerades as the event's voice channel on the website.
    const channelId =
      await deps.channelResolver.resolveVoiceChannelHonoringOverride(
        event.game?.id ?? null,
        event.recurrenceGroupId ?? null,
        event.ephemeralVoiceChannelId ?? null,
        event.notificationChannelOverride ?? null,
      );
    if (!channelId) {
      return { channelId: null, channelName: null, guildId: null };
    }
    return await resolveChannelName(deps.bot, channelId, isAuthenticated);
  } catch (err) {
    // ROK-1189: the empty triple is deliberate (a voice lookup must never fail
    // the bundled detail response), but swallowing it silently hid real
    // override/resolver breakage. Warn so it is observable in the logs without
    // changing the HTTP contract.
    logger.warn(
      `[voice-channel] failed to resolve for event ${event.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
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
