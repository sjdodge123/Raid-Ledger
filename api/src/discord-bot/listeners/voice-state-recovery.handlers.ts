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
import {
  isBotMember,
  resolveLobbyGroups,
  traceDroppedGroups,
  type LobbyGameGroup,
} from './voice-lobby-groups.helpers';

/** Discord member info shape. */
type DiscordMember = {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
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
  // ROK-1445 review LOW-1: bots are excluded from `trackChannelMembers` above
  // (counts) and from every roster path, but they must STILL be dispatched —
  // `handleChannelJoin` is where scheduled-event attendance and ROK-959
  // sibling suppression run. Skipping them here reproduced the same bug the
  // dispatch-level filter caused, only on bot restart.
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
  for (const [memberId, gm] of channel.members) {
    if (isBotMember(gm)) continue;
    memberSet.add(memberId);
    deps.userChannelMap.set(memberId, channelId);
  }
  deps.channelMembers.set(channelId, memberSet);
}

/**
 * Roster ALL members in a game-specific channel for threshold spawn.
 *
 * `resolvedGameId` (ROK-1394): `undefined` → mint the sticky bind game
 * (unchanged); `null` → deliberate degrade to a null-game session when the
 * threshold was met with zero positive game confirmations.
 */
export async function handleGameSpecificGroupRoster(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  resolvedGameId?: number | null,
): Promise<boolean> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  if (!channel) return false;
  let handled = false;
  for (const [memberId, guildMember] of channel.members) {
    if (isBotMember(guildMember)) continue;
    const rlUser = await deps.usersService.findByDiscordId(memberId);
    const memberInfo = buildMemberInfo(
      memberId,
      guildMember,
      rlUser?.id ?? null,
    );
    const joined = await deps.adHocEventService.handleVoiceJoin(
      binding.bindingId,
      memberInfo,
      binding,
      resolvedGameId,
      undefined,
      channelId,
    );
    handled = handled || joined;
  }
  return handled;
}

/**
 * Detect the game groups in a general-lobby channel and mint one event per
 * QUALIFYING group (ROK-1445 AC2). Groups below `minPlayers` are dropped, never
 * folded into another game's roster (AC5) — but their members keep their
 * game-activity tracking (AC6) and the drop is traced (AC10).
 *
 * `targetGameId` restricts the mint to a single group — a delayed spawn timer
 * is armed per `(channel, game)` (AC13) and must spawn only the group it was
 * armed for. Omit it to fan out across every qualifying group.
 */
export async function handleGeneralLobbyGroupDetection(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  targetGameId?: number | null,
): Promise<void> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  if (!channel) return;
  const partition = await resolveLobbyGroups(deps, channelId, binding);
  traceDroppedGroups(deps, channelId, binding, partition);
  await trackDroppedMembers(deps, channel, partition.dropped);
  const selected =
    targetGameId === undefined
      ? partition.qualifying
      : partition.qualifying.filter((g) => g.gameId === targetGameId);
  if (selected.length === 0) return;
  await addDetectedMembers(deps, channel, selected, binding, channelId);
}

/**
 * AC6: dropping the event must NOT drop game-activity tracking. `bufferStart`
 * is keyed user+game+source and is independent of any event, so a player whose
 * group never reached `minPlayers` still keeps their play-time record.
 */
async function trackDroppedMembers(
  deps: VoiceHandlerDeps,
  channel: VoiceBasedChannel,
  dropped: LobbyGameGroup[],
): Promise<void> {
  for (const group of dropped) {
    for (const memberId of group.memberIds) {
      const gm = channel.members.get(memberId);
      if (!gm || isBotMember(gm)) continue;
      const rlUser = await deps.usersService.findByDiscordId(memberId);
      startVoiceGameTracking(
        deps,
        memberId,
        group.gameId,
        group.gameName,
        rlUser?.id ?? null,
      );
    }
  }
}

/** Add members from qualifying game groups to their own event. */
async function addDetectedMembers(
  deps: VoiceHandlerDeps,
  channel: VoiceBasedChannel,
  groups: LobbyGameGroup[],
  binding: ResolvedBinding,
  channelId?: string,
): Promise<void> {
  for (const group of groups) {
    for (const memberId of group.memberIds) {
      const gm = channel.members.get(memberId);
      // AC9: explicit bot guard on the roster so it cannot regress even if a
      // bot ever slipped into a detected group.
      if (!gm || isBotMember(gm)) continue;
      await addGroupMember(deps, memberId, gm, group, binding, channelId);
    }
  }
}

/** Add a single member from a detected game group. */
async function addGroupMember(
  deps: VoiceHandlerDeps,
  memberId: string,
  gm: GuildMember,
  group: LobbyGameGroup,
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
