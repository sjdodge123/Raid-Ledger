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
import { lobbyGroupSize } from './voice-lobby-groups.helpers';
import {
  gateCtx,
  joinExistingEvent,
  suppressOrCheckThreshold,
  type GameSpawnFns,
} from './voice-state-gate.handlers';
import { traceGate } from './voice-gate-trace';

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
  await suppressOrCheckThreshold(deps, channelId, binding, spawnFns);
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

/**
 * Schedule function callbacks for a lobby join. `scheduleSpawn`/`cancelSpawn`
 * take the detected game so the timer is armed per `(channel, game)` (AC13).
 */
export interface LobbyScheduleFns {
  scheduleRecheck: () => void;
  scheduleSpawn: (gameId: number | null) => void;
  cancelSpawn: (gameId: number | null) => void;
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
    if (!guildMember)
      return traceGate(
        deps.logger,
        'no-trigger-user',
        gateCtx(binding, channelId),
      );
    scheduleFns.scheduleRecheck();
    return traceGate(
      deps.logger,
      'lobby-no-game-detected',
      gateCtx(binding, channelId),
    );
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
  // ROK-1445 AC1: the threshold applies to the GAME GROUP that will populate
  // the roster, never to channel occupancy.
  const count = await lobbyGroupSize(deps, channelId, binding, detected.gameId);
  const min = binding.config?.minPlayers ?? 2;
  const trace = gateCtx(binding, channelId, {
    gameId: detected.gameId,
    members: deps.channelMembers.get(channelId)?.size ?? 0,
    minPlayers: min,
    counted: count,
  });
  // AC10: on a general lobby this IS the sub-threshold drop — the member's game
  // group is short, so no event is minted for it and they are never folded into
  // another game's roster.
  if (!state && count < min)
    return traceGate(deps.logger, 'group-below-threshold', trace);
  if (!state && count >= min && guildMember) {
    await handleLobbyThreshold(deps, channelId, binding, scheduleFns, detected);
    return;
  }
  const mi: VoiceMemberInfo = { ...dm, userId: uid };
  const handled = await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    detected.gameId,
    detected.gameName,
    channelId,
  );
  // Reviewer LOW-3 (same family as Codex P2): only claim the outcome when the
  // service actually processed the join — a gated join traced its own reason.
  if (handled) traceGate(deps.logger, 'joined-existing', trace);
}

/** Handle threshold check for lobby spawn. */
async function handleLobbyThreshold(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  scheduleFns: Pick<LobbyScheduleFns, 'scheduleSpawn' | 'cancelSpawn'>,
  detected: { gameId: number | null },
): Promise<void> {
  const trace = gateCtx(binding, channelId, { gameId: detected.gameId });
  // AC15: `shouldSpawnImmediately` requires channel-wide unanimity, so in a
  // genuinely multi-game lobby it never fires and every spawn takes the
  // delayed path. That is accepted, not a regression.
  if (await shouldSpawnImmediately(deps, channelId, binding)) {
    scheduleFns.cancelSpawn(detected.gameId);
    await handleGeneralLobbyGroupDetection(deps, channelId, binding);
    return traceGate(deps.logger, 'spawned-immediate', trace);
  }
  scheduleFns.scheduleSpawn(detected.gameId);
  return traceGate(deps.logger, 'spawn-scheduled', trace);
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
 * Execute a delayed spawn for the ONE `(channel, game)` group its timer was
 * armed for (ROK-1445 AC13). General-lobby re-resolves its groups at fire time
 * so a group that fell below `minPlayers` in the meantime simply drops.
 */
export async function executeDelayedSpawn(
  deps: VoiceHandlerDeps,
  channelId: string,
  gameId: number | null,
  binding: ResolvedBinding,
): Promise<void> {
  if (binding.bindingPurpose === 'general-lobby') {
    await handleGeneralLobbyGroupDetection(deps, channelId, binding, gameId);
    return;
  }
  const minPlayers = binding.config?.minPlayers ?? 2;
  const decision = await resolveGameBindingSpawn(deps, channelId, binding, minPlayers);
  if (!decision.shouldSpawn) return;
  // ROK-1394: abort if the fixed-game bind already has ANY active event (a
  // degraded `bindingId:null` session included) so the timer never spawns a
  // duplicate.
  if (deps.adHocEventService.getActiveBindingEventGameId(binding.bindingId))
    return;
  await handleGameSpecificGroupRoster(
    deps,
    channelId,
    binding,
    decision.resolvedGameId,
  );
}

/**
 * Threshold decision for a fixed-game bind. A null-game monitor (ROK-1415) has
 * no game to filter on, so it falls back to raw channel occupancy.
 */
async function resolveGameBindingSpawn(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  minPlayers: number,
): Promise<ThresholdSpawnDecision> {
  // ROK-1415 (TD1): `binding.gameId == null`, not `!binding.gameId` — a bound
  // game id of 0 is a real game, not a missing one.
  if (binding.gameId == null) {
    const members = deps.channelMembers.get(channelId);
    return {
      shouldSpawn: !!members && members.size >= minPlayers,
      resolvedGameId: undefined,
    };
  }
  return resolveThresholdSpawnGameId(deps, channelId, binding, minPlayers);
}
