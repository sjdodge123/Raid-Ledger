import type { GuildMember } from 'discord.js';
import type { VoiceMemberInfo } from '../services/ad-hoc-participant.service';
import type { DiscordMemberInfo, ResolvedBinding } from './voice-state.helpers';
import {
  getGameFilteredCount,
  shouldSpawnImmediately,
  startVoiceGameTracking,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import {
  handleGameSpecificGroupRoster,
  handleGeneralLobbyGroupDetection,
} from './voice-state-recovery.handlers';

/** Spawn schedule callbacks for game-specific binding. */
export interface GameSpawnFns {
  scheduleSpawn: () => void;
  cancelSpawn: () => void;
}

/** Join an existing ad-hoc event for a game binding. */
async function joinExistingEvent(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  dm: DiscordMemberInfo,
  uid: number | null,
): Promise<void> {
  const mi: VoiceMemberInfo = { ...dm, userId: uid };
  await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    undefined,
    undefined,
    channelId,
  );
}

/** Handle join for a game-specific binding. */
export async function handleGameBindingJoin(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  dm: DiscordMemberInfo,
  spawnFns?: GameSpawnFns,
): Promise<void> {
  const rlUser = await deps.usersService.findByDiscordId(dm.discordUserId);
  const uid = rlUser?.id ?? null;
  startVoiceGameTracking(
    deps,
    dm.discordUserId,
    binding.gameId,
    binding.gameName ?? '',
    uid,
  );
  const state = deps.adHocEventService.getActiveState(binding.bindingId);
  if (state) {
    await joinExistingEvent(deps, channelId, binding, dm, uid);
    return;
  }
  // ROK-959: suppress ad-hoc if a sibling binding has a scheduled event
  const suppressed = await deps.adHocEventService.trySuppressForScheduled(
    binding.bindingId,
    binding.gameId,
    channelId,
  );
  if (suppressed) return;
  await checkGameBindingThreshold(deps, channelId, binding, spawnFns);
}

/** Check threshold and spawn for game-specific binding. */
async function checkGameBindingThreshold(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  spawnFns?: GameSpawnFns,
): Promise<void> {
  const minPlayers = binding.config?.minPlayers ?? 2;
  const { counted, allConfirmed } = await getGameFilteredCount(
    deps,
    channelId,
    binding,
  );
  if (counted < minPlayers) return;
  if (allConfirmed) {
    spawnFns?.cancelSpawn();
    await handleGameSpecificGroupRoster(deps, channelId, binding);
  } else {
    spawnFns?.scheduleSpawn();
  }
}

/** Result of checkGameBindingThreshold for the listener. */
export interface ThresholdResult {
  met: boolean;
  allConfirmed: boolean;
}

/** Check threshold for the listener to decide on spawn vs delay. */
export async function checkThreshold(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<ThresholdResult> {
  const minPlayers = binding.config?.minPlayers ?? 2;
  const { counted, allConfirmed } = await getGameFilteredCount(
    deps,
    channelId,
    binding,
  );
  return { met: counted >= minPlayers, allConfirmed };
}

/** Detect game for a general-lobby join. */
export async function detectGameForLobby(
  deps: VoiceHandlerDeps,
  binding: ResolvedBinding,
  discordMember: { discordUserId: string },
  guildMember?: GuildMember,
): Promise<{ gameId: number | null; gameName: string } | null> {
  if (!guildMember)
    return { gameId: null, gameName: 'Untitled Gaming Session' };
  const detected = await deps.presenceDetector.detectGameForMember(guildMember);
  if (detected.gameId !== null) return detected;
  if (!(binding.config?.allowJustChatting ?? false)) return null;
  return { gameId: null, gameName: 'Just Chatting' };
}

/** Schedule function callbacks for lobby join. */
export interface LobbyScheduleFns {
  scheduleRecheck: () => void;
  scheduleSpawn: () => void;
  cancelSpawn: () => void;
}

/** Lobby join context bundling all parameters. */
interface LobbyJoinCtx {
  deps: VoiceHandlerDeps;
  channelId: string;
  binding: ResolvedBinding;
  dm: DiscordMemberInfo;
  guildMember: GuildMember | undefined;
  scheduleFns: LobbyScheduleFns;
}

/** Handle general-lobby join logic. */
export async function handleGeneralLobbyJoin(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  dm: DiscordMemberInfo,
  guildMember: GuildMember | undefined,
  scheduleFns: LobbyScheduleFns,
): Promise<void> {
  const detected = await detectGameForLobby(deps, binding, dm, guildMember);
  if (!detected) {
    if (guildMember) scheduleFns.scheduleRecheck();
    return;
  }
  const uid =
    (await deps.usersService.findByDiscordId(dm.discordUserId))?.id ?? null;
  startVoiceGameTracking(
    deps,
    dm.discordUserId,
    detected.gameId,
    detected.gameName,
    uid,
  );
  await processLobbyMember(
    { deps, channelId, binding, dm, guildMember, scheduleFns },
    uid,
    detected,
  );
}

/** Process lobby member after game detection and tracking. */
async function processLobbyMember(
  ctx: LobbyJoinCtx,
  uid: number | null,
  detected: { gameId: number | null; gameName: string },
): Promise<void> {
  const { deps, channelId, binding, dm, guildMember, scheduleFns } = ctx;
  const state = deps.adHocEventService.getActiveState(
    binding.bindingId,
    detected.gameId,
  );
  const count = deps.channelMembers.get(channelId)?.size ?? 0;
  const min = binding.config?.minPlayers ?? 2;
  if (!state && count < min) return;
  if (!state && count >= min && guildMember) {
    await handleLobbyThreshold(deps, channelId, binding, scheduleFns);
    return;
  }
  const mi: VoiceMemberInfo = { ...dm, userId: uid };
  await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    detected.gameId,
    detected.gameName,
    channelId,
  );
}

/** Handle threshold check for lobby spawn. */
async function handleLobbyThreshold(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  scheduleFns: { scheduleSpawn: () => void; cancelSpawn: () => void },
): Promise<void> {
  if (await shouldSpawnImmediately(deps, channelId, binding)) {
    scheduleFns.cancelSpawn();
    await handleGeneralLobbyGroupDetection(deps, channelId, binding);
  } else {
    scheduleFns.scheduleSpawn();
  }
}

/** Execute delayed spawn logic (after timer fires). */
export async function executeDelayedSpawn(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<void> {
  const minPlayers = binding.config?.minPlayers ?? 2;
  if (binding.bindingPurpose !== 'general-lobby' && binding.gameId) {
    const { counted } = await getGameFilteredCount(deps, channelId, binding);
    if (counted < minPlayers) return;
  } else {
    const members = deps.channelMembers.get(channelId);
    if (!members || members.size < minPlayers) return;
  }
  const state =
    binding.bindingPurpose === 'general-lobby'
      ? undefined
      : deps.adHocEventService.getActiveState(binding.bindingId);
  if (state) return;
  if (binding.bindingPurpose === 'general-lobby') {
    await handleGeneralLobbyGroupDetection(deps, channelId, binding);
  } else {
    await handleGameSpecificGroupRoster(deps, channelId, binding);
  }
}
