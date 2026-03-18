import type { GuildMember } from 'discord.js';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { VoiceMemberInfo } from '../services/ad-hoc-participant.service';

/** TTL for channel binding cache entries (ms). */
export const CACHE_TTL_MS = 60 * 1000;

/** Debounce window per user to avoid rapid join/leave thrashing. */
export const DEBOUNCE_MS = 2000;

/** Basic Discord member info used across voice state handlers. */
export interface DiscordMemberInfo {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
}

/** Resolved channel binding info. */
export interface ResolvedBinding {
  bindingId: string;
  gameId: number | null;
  gameName: string | null;
  bindingPurpose: string;
  config: {
    minPlayers?: number;
    gracePeriod?: number;
    notificationChannelId?: string;
    allowJustChatting?: boolean;
  } | null;
}

/** Dependencies for voice state helper functions. */
export interface VoiceStateDeps {
  clientService: DiscordBotClientService;
  channelBindingsService: ChannelBindingsService;
}

/** Build VoiceMemberInfo from a guild member. */
export function buildMemberInfo(
  memberId: string,
  guildMember: GuildMember,
  userId: number | null,
): VoiceMemberInfo {
  return {
    discordUserId: memberId,
    discordUsername:
      guildMember.displayName ?? guildMember.user?.username ?? 'Unknown',
    discordAvatarHash: guildMember.user?.avatar ?? null,
    userId,
  };
}

/** Build basic discord member info from a voice state event. */
export function buildDiscordMember(
  userId: string,
  member?: GuildMember | null,
): DiscordMemberInfo {
  return {
    discordUserId: userId,
    discordUsername: member?.displayName ?? member?.user?.username ?? 'Unknown',
    discordAvatarHash: member?.user?.avatar ?? null,
  };
}

/** Resolve a voice channel from the guild. */
export function resolveVoiceChannel(
  clientService: DiscordBotClientService,
  channelId: string,
): import('discord.js').VoiceBasedChannel | null {
  const client = clientService.getClient();
  if (!client) return null;
  const guildId = clientService.getGuildId();
  if (!guildId) return null;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) return null;
  return channel;
}

/** Cache shape for resolved bindings. */
type BindingCacheEntry = { cachedAt: number; value: ResolvedBinding[] };

/**
 * Resolve a channel ID to ALL matching bindings (with caching).
 * Matches 'game-voice-monitor' and 'general-lobby' binding purposes.
 */
export async function resolveAllBindings(
  deps: VoiceStateDeps,
  channelId: string,
  cache: Map<string, BindingCacheEntry>,
): Promise<ResolvedBinding[]> {
  const cached = cache.get(channelId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const guildId = deps.clientService.getGuildId();
  if (!guildId) {
    cache.set(channelId, { cachedAt: Date.now(), value: [] });
    return [];
  }

  const bindings =
    await deps.channelBindingsService.getBindingsWithGameNames(guildId);
  const matched = bindings
    .filter(
      (b) =>
        b.channelId === channelId &&
        (b.bindingPurpose === 'game-voice-monitor' ||
          b.bindingPurpose === 'general-lobby'),
    )
    .map(mapToResolvedBinding);

  cache.set(channelId, { cachedAt: Date.now(), value: matched });
  return matched;
}

/** Backward-compat: resolve first matching binding. */
export async function resolveBinding(
  deps: VoiceStateDeps,
  channelId: string,
  cache: Map<string, BindingCacheEntry>,
): Promise<ResolvedBinding | null> {
  const all = await resolveAllBindings(deps, channelId, cache);
  return all[0] ?? null;
}

/** Map a raw binding record to ResolvedBinding. */
function mapToResolvedBinding(binding: {
  id: string;
  gameId: number | null;
  gameName?: string | null;
  bindingPurpose: string;
  config: unknown;
}): ResolvedBinding {
  return {
    bindingId: binding.id,
    gameId: binding.gameId,
    gameName: binding.gameName ?? null,
    bindingPurpose: binding.bindingPurpose,
    config: binding.config as ResolvedBinding['config'],
  };
}

/** Add a user to a channel's member set. */
export function trackChannelMember(
  channelMembers: Map<string, Set<string>>,
  channelId: string,
  userId: string,
): void {
  let members = channelMembers.get(channelId);
  if (!members) {
    members = new Set();
    channelMembers.set(channelId, members);
  }
  members.add(userId);
}

/** Clear all timers in a map. */
export function clearTimerMap(map: Map<string, NodeJS.Timeout>): void {
  for (const timer of map.values()) {
    clearTimeout(timer);
  }
  map.clear();
}
