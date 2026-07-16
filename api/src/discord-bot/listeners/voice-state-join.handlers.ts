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

/**
 * Join an existing ad-hoc event for a game binding.
 *
 * `resolvedGameId` (ROK-1394) must match the KEY of the existing event so the
 * join reconciles into it rather than minting a duplicate: `null` targets a
 * degraded Untitled session (`bindingId:null`), a number targets the sticky
 * game event (`bindingId:<gameId>`).
 */
async function joinExistingEvent(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  dm: DiscordMemberInfo,
  uid: number | null,
  resolvedGameId?: number | null,
): Promise<void> {
  const mi: VoiceMemberInfo = { ...dm, userId: uid };
  await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    resolvedGameId,
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
  // ROK-1394: a fixed-game bind holds ≤1 active event, but the degrade path may
  // have keyed it under `bindingId:null`. Look it up regardless of game key and
  // reconcile the join into that event (keep it as-is — no game upgrade) so a
  // later game confirmation never mints a second, sticky-game event.
  const existing = deps.adHocEventService.getActiveBindingEventGameId(
    binding.bindingId,
  );
  if (existing) {
    await joinExistingEvent(deps, channelId, binding, dm, uid, existing.gameId);
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
    // allConfirmed ⟹ every counted member positively confirmed the bound game
    // ⟹ confirmedCount === counted ≥ minPlayers > 0, so there is no zero-
    // confirmation case here and the sticky bind game is always correct. Pass
    // undefined explicitly (mint the bind game) — the degrade path is unreachable.
    await handleGameSpecificGroupRoster(deps, channelId, binding, undefined);
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

/** Threshold spawn decision + the game the event should mint with. */
interface ThresholdSpawnDecision {
  shouldSpawn: boolean;
  resolvedGameId: number | null | undefined;
}

/**
 * ROK-1394: a fixed-game bind (series AND non-series alike) must NOT mint its
 * stored game off pure presence-null counting — that path spawned a BG3 event
 * while the group actually played Hellcard and routed the Completed embed to
 * #general. On zero positive game confirmation we STILL spawn — preserving the
 * ROK-697 auto-event + attendance for invisible/console/no-rich-presence
 * raiders — but degrade to a null game rather than stamping the sticky bind
 * game. This supersedes ROK-1390's series-only hard-block with an
 * attendance-preserving degrade-to-null that applies uniformly.
 *
 * `undefined` → mint the sticky bind game (genuinely confirmed);
 * `null` → deliberate degrade to a null-game "Untitled" session.
 */
async function resolveThresholdSpawnGameId(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  minPlayers: number,
): Promise<ThresholdSpawnDecision> {
  const { counted, confirmedCount } = await getGameFilteredCount(
    deps,
    channelId,
    binding,
  );
  if (counted < minPlayers)
    return { shouldSpawn: false, resolvedGameId: undefined };
  if (confirmedCount > 0)
    return { shouldSpawn: true, resolvedGameId: undefined };
  deps.logger.warn(
    `[voice-spawn] Degrading spawn to null game for binding ${binding.bindingId} ` +
      `in channel ${channelId}: ${counted} member(s) met threshold but 0 confirmed ` +
      `game ${binding.gameId}`,
  );
  return { shouldSpawn: true, resolvedGameId: null };
}

/**
 * Gate + resolved game for a delayed spawn. `proceed: false` → abort (below
 * threshold). For fixed-game binds `resolvedGameId` carries the ROK-1394
 * degrade decision (`undefined` = sticky game, `null` = degrade); general-lobby
 * binds resolve their game later via presence detection so it stays `undefined`.
 */
async function resolveDelayedSpawnGate(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  minPlayers: number,
): Promise<{ proceed: boolean; resolvedGameId: number | null | undefined }> {
  if (binding.bindingPurpose !== 'general-lobby' && binding.gameId) {
    const decision = await resolveThresholdSpawnGameId(
      deps,
      channelId,
      binding,
      minPlayers,
    );
    return {
      proceed: decision.shouldSpawn,
      resolvedGameId: decision.resolvedGameId,
    };
  }
  const members = deps.channelMembers.get(channelId);
  return {
    proceed: !!members && members.size >= minPlayers,
    resolvedGameId: undefined,
  };
}

/** Execute delayed spawn logic (after timer fires). */
export async function executeDelayedSpawn(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<void> {
  const minPlayers = binding.config?.minPlayers ?? 2;
  const gate = await resolveDelayedSpawnGate(
    deps,
    channelId,
    binding,
    minPlayers,
  );
  if (!gate.proceed) return;
  // ROK-1394: abort if the fixed-game bind already has ANY active event (a
  // degraded `bindingId:null` session included) so the timer never spawns a
  // duplicate. General-lobby keeps its per-game keying and is checked later.
  const existing =
    binding.bindingPurpose === 'general-lobby'
      ? undefined
      : deps.adHocEventService.getActiveBindingEventGameId(binding.bindingId);
  if (existing) return;
  if (binding.bindingPurpose === 'general-lobby') {
    await handleGeneralLobbyGroupDetection(deps, channelId, binding);
  } else {
    await handleGameSpecificGroupRoster(
      deps,
      channelId,
      binding,
      gate.resolvedGameId,
    );
  }
}
