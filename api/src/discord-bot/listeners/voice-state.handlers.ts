import type { GuildMember } from 'discord.js';
import type { VoiceHandlerDeps } from './voice-handler-deps';
import {
  buildMemberInfo,
  resolveVoiceChannel,
  type ResolvedBinding,
} from './voice-state.helpers';
import {
  detectLobbyMemberGame,
  humanMembers,
  isBotMember,
  lobbyGroupSize,
} from './voice-lobby-groups.helpers';
import { gateCtx, traceGate } from './voice-gate-trace';
import {
  tallyGameMembers,
  type GameMemberTally,
} from './voice-threshold-count.helpers';
import { handleGeneralLobbyGroupDetection } from './voice-state-recovery.handlers';
import { unanimousLobbySize } from './voice-threshold-server-count.helpers';

// ROK-1801 Q10: the deps bundle lives in its own file; re-exported so every
// existing `from './voice-state.handlers'` import keeps compiling.
export type { VoiceHandlerDeps } from './voice-handler-deps';

/**
 * ROK-1446 D6 — flag a `general-lobby` channel for re-render on the next tick.
 *
 * The lobby scoping lives HERE, in one place, rather than at each of the four
 * voice call sites: `game-voice-monitor` bindings keep the unchanged ROK-1447
 * per-event card (D1) and must never mark a channel dirty, or the room would
 * get a presence embed AND a per-spawn announcement for the same event.
 * `markDirty` is a cheap synchronous set-add by contract, so callers do not
 * need to await or guard it.
 */
export function markLobbyDirty(
  deps: VoiceHandlerDeps,
  binding: ResolvedBinding,
  channelId: string | null | undefined,
): void {
  if (binding.bindingPurpose !== 'general-lobby' || !channelId) return;
  deps.channelPresence.markDirty(channelId);
}

/** Track voice attendance for scheduled events on join. */
export async function trackScheduledEventJoin(
  deps: VoiceHandlerDeps,
  channelId: string,
  dm: {
    discordUserId: string;
    discordUsername: string;
    discordAvatarHash: string | null;
  },
): Promise<void> {
  const activeEvents =
    await deps.voiceAttendanceService.findActiveScheduledEvents(channelId);
  // ROK-1417 (TD3): NestJS Logger does not substitute printf tokens, so the
  // message must already carry the values.
  deps.logger.debug(
    `[voice-pipe] trackJoin: channelId=${channelId} activeEvents=${activeEvents.length}`,
  );
  if (activeEvents.length === 0) return;
  const rlUser = await deps.usersService.findByDiscordId(dm.discordUserId);
  for (const { eventId } of activeEvents) {
    trackSingleEventJoin(deps, eventId, dm, rlUser?.id ?? null);
  }
}

/** Track a single scheduled event join. */
function trackSingleEventJoin(
  deps: VoiceHandlerDeps,
  eventId: number,
  dm: {
    discordUserId: string;
    discordUsername: string;
    discordAvatarHash: string | null;
  },
  userId: number | null,
): void {
  deps.voiceAttendanceService.handleJoin(
    eventId,
    dm.discordUserId,
    dm.discordUsername,
    userId,
    dm.discordAvatarHash,
  );
}

/** Handle departure grace rejoin and emit roster update. */
export async function handleEventRejoin(
  deps: VoiceHandlerDeps,
  eventId: number,
  discordUserId: string,
): Promise<void> {
  await deps.departureGraceService.onMemberRejoin(eventId, discordUserId);
  const roster = deps.voiceAttendanceService.getActiveRoster(eventId);
  deps.adHocEventsGateway.emitRosterUpdate(
    eventId,
    roster.participants,
    roster.activeCount,
  );
}

/** Track voice attendance for scheduled events on leave. */
export async function trackScheduledEventLeave(
  deps: VoiceHandlerDeps,
  channelId: string,
  discordUserId: string,
): Promise<void> {
  const activeEvents =
    await deps.voiceAttendanceService.findActiveScheduledEvents(channelId);
  for (const { eventId } of activeEvents) {
    deps.voiceAttendanceService.handleLeave(eventId, discordUserId);
    await deps.departureGraceService.onMemberLeave(eventId, discordUserId);
    const roster = deps.voiceAttendanceService.getActiveRoster(eventId);
    deps.adHocEventsGateway.emitRosterUpdate(
      eventId,
      roster.participants,
      roster.activeCount,
    );
  }
}

/** Stop voice game tracking on leave. */
export function stopVoiceGameTracking(
  deps: VoiceHandlerDeps,
  discordUserId: string,
): void {
  const voiceGame = deps.voiceGameTracker.get(discordUserId);
  if (voiceGame) {
    deps.voiceGameTracker.delete(discordUserId);
    deps.gameActivityService.bufferStop(
      voiceGame.userId,
      voiceGame.gameName,
      new Date(),
      'voice',
    );
  }
}

/** Start voice game tracking for a member. */
export function startVoiceGameTracking(
  deps: VoiceHandlerDeps,
  discordUserId: string,
  gameId: number | null,
  gameName: string,
  rlUserId: number | null,
): void {
  if (gameId !== null && rlUserId) {
    deps.voiceGameTracker.set(discordUserId, { gameName, userId: rlUserId });
    deps.gameActivityService.bufferStart(
      rlUserId,
      gameName,
      new Date(),
      'voice',
    );
  }
}

/**
 * The voice channel a member is in: the listener's map first (authoritative for
 * the join/leave transition we just processed), then Discord's own cache.
 */
function memberChannelId(
  deps: VoiceHandlerDeps,
  userId: string,
  guildMember: GuildMember,
): string | null | undefined {
  return deps.userChannelMap.get(userId) ?? guildMember.voice?.channelId;
}

/**
 * Apply the null-presence policy to a lobby member's freshly detected game.
 *
 * Returns the game to move them onto, or `null` when policy says to drop them
 * from their current event instead (presence went null and the binding does not
 * `allowJustChatting`). Extracted from `handlePresenceChange` for the 30-line
 * function limit; behaviour is unchanged and pinned by the ROK-1445
 * presence-switch spec.
 */
async function resolveSwitchTarget(
  deps: VoiceHandlerDeps,
  userId: string,
  binding: ResolvedBinding,
  guildMember: GuildMember,
): Promise<{ gameId: number | null; gameName: string } | null> {
  const detected = await detectLobbyMemberGame(deps, guildMember);
  if (detected.gameId !== null) return detected;
  if (binding.config?.allowJustChatting ?? false)
    return { gameId: null, gameName: 'Just Chatting' };
  stopVoiceGameTracking(deps, userId);
  await deps.adHocEventService.handleVoiceLeave(binding.bindingId, userId);
  return null;
}

/** Handle presence change for users in general-lobby channels. */
export async function handlePresenceChange(
  deps: VoiceHandlerDeps,
  userId: string,
  binding: ResolvedBinding,
  guildMember: GuildMember,
): Promise<void> {
  if (isBotMember(guildMember)) return;
  // ROK-1446 D6: the game-switch path. Marked before detection because the room
  // changed either way — a switch INTO an undetectable game still moves the
  // member out of their old group's roster.
  markLobbyDirty(deps, binding, memberChannelId(deps, userId, guildMember));
  const detected = await resolveSwitchTarget(
    deps,
    userId,
    binding,
    guildMember,
  );
  if (!detected) return;
  const currentState = deps.adHocEventService.getActiveState(
    binding.bindingId,
    detected.gameId,
  );
  if (currentState?.memberSet.has(userId)) return;
  await moveToNewGame(
    deps,
    userId,
    binding,
    detected,
    guildMember,
    !!currentState,
  );
}

/**
 * Move a user from one game event to another.
 *
 * ROK-1445 AC3: this path had NO threshold gate at all, so one member switching
 * to CoD4 minted their own 1-person CoD4 event whatever `minPlayers` said.
 * Joining an EXISTING event stays unconditional (a 3rd member switching in must
 * still be able to join); minting a NEW one requires the switched-to game's
 * group to clear `minPlayers`. AC6: tracking is independent of the event, so
 * `startVoiceGameTracking` runs before the gate and a refused switch still
 * keeps its play-time record.
 */
async function moveToNewGame(
  deps: VoiceHandlerDeps,
  userId: string,
  binding: ResolvedBinding,
  detected: { gameId: number | null; gameName: string },
  guildMember: GuildMember,
  hasActiveEvent: boolean,
): Promise<void> {
  stopVoiceGameTracking(deps, userId);
  await deps.adHocEventService.handleVoiceLeave(binding.bindingId, userId);
  const rlUser = await deps.usersService.findByDiscordId(userId);
  const uid = rlUser?.id ?? null;
  startVoiceGameTracking(deps, userId, detected.gameId, detected.gameName, uid);
  const channelId = memberChannelId(deps, userId, guildMember);
  if (!hasActiveEvent)
    return spawnSwitchedGroup(deps, channelId, binding, detected.gameId);
  const mi = buildMemberInfo(userId, guildMember, uid);
  await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    detected.gameId,
    detected.gameName,
    channelId ?? undefined,
  );
}

/**
 * A switch with no live event for the game: mint it only if the group clears
 * `minPlayers` (AC3), and then roster the WHOLE group — the same set the join
 * path spawns. ROK-1782: rostering only the switcher dropped every earlier
 * switcher, who had been left waiting below the threshold with nothing else
 * ever adding them (u1 then u2 start Valheim → event rostered `[u2]`).
 */
async function spawnSwitchedGroup(
  deps: VoiceHandlerDeps,
  channelId: string | null | undefined,
  binding: ResolvedBinding,
  gameId: number | null,
): Promise<void> {
  if (!(await switchClearsThreshold(deps, channelId, binding, gameId))) return;
  if (!channelId) return;
  await handleGeneralLobbyGroupDetection(deps, channelId, binding, gameId);
}

/** Whether the switched-to game group clears `minPlayers` (AC3), else trace. */
async function switchClearsThreshold(
  deps: VoiceHandlerDeps,
  channelId: string | null | undefined,
  binding: ResolvedBinding,
  gameId: number | null,
): Promise<boolean> {
  const minPlayers = binding.config?.minPlayers ?? 2;
  const count = channelId
    ? await lobbyGroupSize(deps, channelId, binding, gameId)
    : 0;
  if (count >= minPlayers) return true;
  traceGate(
    deps.logger,
    'group-below-threshold',
    gateCtx(binding, channelId ?? 'unknown', {
      gameId,
      minPlayers,
      counted: count,
    }),
  );
  return false;
}

/**
 * Get game-filtered count for threshold checking (ROK-697).
 *
 * `counted` includes presence-null members (invisible/console raiders count
 * toward minPlayers). `confirmedCount` (ROK-1390) counts ONLY members whose
 * detected game positively matches the bound game — the series spawn guard
 * uses it to refuse minting a stored game off pure presence-null counting.
 *
 * ROK-1711 — Discord bots are skipped (a lone human plus an idle music bot
 * must not clear `minPlayers`); presence-null HUMANS still count (ROK-697).
 * A DEMO_MODE-only allowlist keeps the companion smoke bot counting.
 */
export async function getGameFilteredCount(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<GameMemberTally> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  // ROK-1415 (TD1): `== null`, not `!binding.gameId` — a bound game id of 0 is
  // a real game, not a missing one.
  if (!channel || binding.gameId == null)
    return { counted: 0, allConfirmed: false, confirmedCount: 0 };
  return tallyGameMembers(
    channel.members.values(),
    (m) => deps.presenceDetector.detectGameForMember(m),
    binding.gameId,
  );
}

/** Check if all members share the same game (ROK-697). */
export async function shouldSpawnImmediately(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<boolean> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  if (!channel) return false;
  const minPlayers = binding.config?.minPlayers ?? 2;
  // ROK-1445 AC9: a bot on the same game must never push a lone human over
  // `minPlayers`, nor break/satisfy the unanimity check.
  const voiceMembers = humanMembers(channel);
  // ROK-1801 Q9: server players can make up the shortfall, so only a room
  // with no server roster can be ruled out on voice occupancy alone.
  if (!deps.serverRoster && voiceMembers.length < minPlayers) return false;
  if (voiceMembers.length === 0) return false;
  if (binding.bindingPurpose !== 'general-lobby') return false;
  return (await unanimousLobbySize(deps, voiceMembers)) >= minPlayers;
}
