import type { Logger } from '@nestjs/common';
import type { GuildMember } from 'discord.js';
import type { AdHocEventService } from '../services/ad-hoc-event.service';
import type { VoiceAttendanceService } from '../services/voice-attendance.service';
import type { DepartureGraceService } from '../services/departure-grace.service';
import type { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import type { GameActivityService } from '../services/game-activity.service';
import type { UsersService } from '../../users/users.service';
import type { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  buildMemberInfo,
  resolveVoiceChannel,
  type ResolvedBinding,
} from './voice-state.helpers';
import {
  humanMembers,
  isBotMember,
  lobbyGroupSize,
} from './voice-lobby-groups.helpers';
import { gateCtx, traceGate } from './voice-gate-trace';

/** Dependencies bundle for voice state handler functions. */
export interface VoiceHandlerDeps {
  logger: Logger;
  clientService: DiscordBotClientService;
  adHocEventService: AdHocEventService;
  voiceAttendanceService: VoiceAttendanceService;
  departureGraceService: DepartureGraceService;
  presenceDetector: PresenceGameDetectorService;
  gameActivityService: GameActivityService;
  usersService: UsersService;
  adHocEventsGateway: AdHocEventsGateway;
  voiceGameTracker: Map<string, { gameName: string; userId: number }>;
  userChannelMap: Map<string, string>;
  channelMembers: Map<string, Set<string>>;
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

/** Handle presence change for users in general-lobby channels. */
export async function handlePresenceChange(
  deps: VoiceHandlerDeps,
  userId: string,
  binding: ResolvedBinding,
  guildMember: GuildMember,
): Promise<void> {
  if (isBotMember(guildMember)) return;
  let detected = await deps.presenceDetector.detectGameForMember(guildMember);
  if (detected.gameId === null) {
    if (!(binding.config?.allowJustChatting ?? false)) {
      stopVoiceGameTracking(deps, userId);
      await deps.adHocEventService.handleVoiceLeave(binding.bindingId, userId);
      return;
    }
    detected = { gameId: null, gameName: 'Just Chatting' };
  }
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
  const channelId =
    deps.userChannelMap.get(userId) ?? guildMember.voice?.channelId;
  if (
    !hasActiveEvent &&
    !(await switchClearsThreshold(deps, channelId, binding, detected.gameId))
  )
    return;
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
 * ROK-1445 review MED-2 — deliberately NO bot filter here, unlike every other
 * count surface. This is the game-binding path: AC9 targeted the general-lobby
 * occupancy gate (now filtered in `resolveLobbyGroups`/`humanMembers`), and
 * AC12 requires ROK-1390/1394 behaviour on fixed-game binds to be preserved
 * byte-for-byte. Known consequence, tracked in TECH-DEBT-BACKLOG.md: a bot
 * idling in a game-bound channel is presence-null, so ROK-697 null-counting
 * makes it count — one human plus one music bot reaches `counted = 2` and
 * spawns a 1-human event on the delayed path. Fixing it means changing a count
 * AC12 pins, so it is filed rather than folded in here.
 */
export async function getGameFilteredCount(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<{ counted: number; allConfirmed: boolean; confirmedCount: number }> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  // ROK-1415 (TD1): `== null`, not `!binding.gameId` — a bound game id of 0 is
  // a real game, not a missing one.
  if (!channel || binding.gameId == null)
    return { counted: 0, allConfirmed: false, confirmedCount: 0 };
  const voiceMembers = [...channel.members.values()];
  let counted = 0;
  let allConfirmed = true;
  let confirmedCount = 0;
  for (const member of voiceMembers) {
    const detected = await deps.presenceDetector.detectGameForMember(member);
    if (detected.gameId !== null && detected.gameId !== binding.gameId)
      continue;
    counted++;
    if (detected.gameId === null) allConfirmed = false;
    else confirmedCount++;
  }
  return { counted, allConfirmed, confirmedCount };
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
  if (voiceMembers.length < minPlayers) return false;
  if (binding.bindingPurpose !== 'general-lobby') return false;
  const detections = await Promise.all(
    voiceMembers.map((m) => deps.presenceDetector.detectGameForMember(m)),
  );
  const firstGameId = detections[0]?.gameId;
  if (firstGameId === null || firstGameId === undefined) return false;
  return detections.every((d) => d.gameId === firstGameId);
}
