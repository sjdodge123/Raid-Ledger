import type { GuildMember, VoiceBasedChannel } from 'discord.js';
import {
  buildMemberInfo,
  resolveVoiceChannel,
  type ResolvedBinding,
} from './voice-state.helpers';
import {
  startVoiceGameTracking,
  type VoiceHandlerDeps,
} from './voice-state.handlers';

/** Discord member info shape. */
type DiscordMember = {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
};

/** Group shape from presence detector. */
type GameGroup = {
  gameId: number | null;
  gameName: string;
  memberIds: string[];
};

/** Recover voice state from all bound channels on startup. */
export async function recoverFromVoiceChannels(
  deps: VoiceHandlerDeps,
  resolveBindingFn: (channelId: string) => Promise<ResolvedBinding | null>,
  handleJoinFn: (
    channelId: string,
    dm: DiscordMember,
    gm?: GuildMember,
  ) => Promise<void>,
): Promise<void> {
  const client = deps.clientService.getClient();
  if (!client) return;
  const guildId = deps.clientService.getGuildId();
  if (!guildId) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  try {
    const voiceChannels = guild.channels.cache.filter((ch) =>
      ch.isVoiceBased(),
    );
    for (const [channelId, channel] of voiceChannels) {
      if (!channel.isVoiceBased() || channel.members.size === 0) continue;
      const binding = await resolveBindingFn(channelId);
      if (!binding) continue;
      await recoverChannel(deps, channelId, channel, handleJoinFn);
    }
  } catch (err) {
    deps.logger.error(`Voice channel recovery failed: ${err}`);
  }
}

/** Recover a single voice channel's members. */
async function recoverChannel(
  deps: VoiceHandlerDeps,
  channelId: string,
  channel: VoiceBasedChannel,
  handleJoinFn: (
    ch: string,
    dm: DiscordMember,
    gm?: GuildMember,
  ) => Promise<void>,
): Promise<void> {
  trackChannelMembers(deps, channelId, channel);
  for (const [memberId, gm] of channel.members) {
    const dm: DiscordMember = {
      discordUserId: memberId,
      discordUsername: gm.displayName ?? gm.user?.username ?? 'Unknown',
      discordAvatarHash: gm.user?.avatar ?? null,
    };
    await handleJoinFn(channelId, dm, gm);
  }
  deps.logger.log(
    `Recovery: reconciled ${channel.members.size} member(s) in channel ${channelId}`,
  );
}

/** Populate channel member tracking maps. */
function trackChannelMembers(
  deps: VoiceHandlerDeps,
  channelId: string,
  channel: VoiceBasedChannel,
): void {
  const memberSet = new Set<string>();
  for (const [memberId] of channel.members) {
    memberSet.add(memberId);
    deps.userChannelMap.set(memberId, channelId);
  }
  deps.channelMembers.set(channelId, memberSet);
}

/** Roster ALL members in a game-specific channel for threshold spawn. */
export async function handleGameSpecificGroupRoster(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<void> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  if (!channel) return;
  for (const [memberId, guildMember] of channel.members) {
    const rlUser = await deps.usersService.findByDiscordId(memberId);
    const memberInfo = buildMemberInfo(
      memberId,
      guildMember,
      rlUser?.id ?? null,
    );
    await deps.adHocEventService.handleVoiceJoin(
      binding.bindingId,
      memberInfo,
      binding,
      undefined,
      undefined,
      channelId,
    );
  }
}

/** Roster all members from detected groups into ad-hoc events. */
async function rosterGroupMembers(
  deps: VoiceHandlerDeps,
  channel: VoiceBasedChannel,
  groups: GameGroup[],
  binding: ResolvedBinding,
  channelId: string,
): Promise<void> {
  const addedMembers = new Set<string>();
  await addDetectedMembers(
    deps,
    channel,
    groups,
    binding,
    addedMembers,
    channelId,
  );
  await addRemainingMembers(
    deps,
    channel,
    groups,
    binding,
    addedMembers,
    channelId,
  );
}

/** Handle group detection and event creation for general-lobby channels. */
export async function handleGeneralLobbyGroupDetection(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<void> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  if (!channel) return;
  const voiceMembers = [...channel.members.values()];
  if (voiceMembers.length === 0) return;
  const allGroups = await deps.presenceDetector.detectGames(voiceMembers);
  const allowJustChatting = binding.config?.allowJustChatting ?? false;
  const groups = filterGroups(allGroups, allowJustChatting);
  if (groups.length === 0) return;
  await rosterGroupMembers(deps, channel, groups, binding, channelId);
}

/** Filter game groups based on Just Chatting setting. */
function filterGroups(
  allGroups: GameGroup[],
  allowJustChatting: boolean,
): GameGroup[] {
  return allowJustChatting
    ? allGroups.map((g) =>
        g.gameId === null ? { ...g, gameName: 'Just Chatting' } : g,
      )
    : allGroups.filter((g) => g.gameId !== null);
}

/** Add members from detected game groups to events. */
async function addDetectedMembers(
  deps: VoiceHandlerDeps,
  channel: VoiceBasedChannel,
  groups: GameGroup[],
  binding: ResolvedBinding,
  addedMembers: Set<string>,
  channelId?: string,
): Promise<void> {
  for (const group of groups) {
    for (const memberId of group.memberIds) {
      const gm = channel.members.get(memberId);
      if (!gm) continue;
      await addGroupMember(deps, memberId, gm, group, binding, channelId);
      addedMembers.add(memberId);
    }
  }
}

/** Add a single member from a detected game group. */
async function addGroupMember(
  deps: VoiceHandlerDeps,
  memberId: string,
  gm: GuildMember,
  group: GameGroup,
  binding: ResolvedBinding,
  channelId?: string,
): Promise<void> {
  const rlUser = await deps.usersService.findByDiscordId(memberId);
  const mi = buildMemberInfo(memberId, gm, rlUser?.id ?? null);
  await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    group.gameId,
    group.gameName,
    channelId,
  );
  startVoiceGameTracking(
    deps,
    memberId,
    group.gameId,
    group.gameName,
    rlUser?.id ?? null,
  );
}

/** Add remaining (undetected) members to the primary event group. */
async function addRemainingMembers(
  deps: VoiceHandlerDeps,
  channel: VoiceBasedChannel,
  groups: GameGroup[],
  binding: ResolvedBinding,
  addedMembers: Set<string>,
  channelId?: string,
): Promise<void> {
  if (groups.length === 0) return;
  const primaryGroup = groups[0];
  for (const [memberId, guildMember] of channel.members) {
    if (addedMembers.has(memberId)) continue;
    const rlUser = await deps.usersService.findByDiscordId(memberId);
    const mi = buildMemberInfo(memberId, guildMember, rlUser?.id ?? null);
    await deps.adHocEventService.handleVoiceJoin(
      binding.bindingId,
      mi,
      binding,
      primaryGroup.gameId,
      primaryGroup.gameName,
      channelId,
    );
  }
}
