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
  deps.logger.debug(
    '[voice-pipe] trackJoin: channelId=%s activeEvents=%d',
    channelId,
    activeEvents.length,
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
  await moveToNewGame(deps, userId, binding, detected, guildMember);
}

/** Move a user from one game event to another. */
async function moveToNewGame(
  deps: VoiceHandlerDeps,
  userId: string,
  binding: ResolvedBinding,
  detected: { gameId: number | null; gameName: string },
  guildMember: GuildMember,
): Promise<void> {
  stopVoiceGameTracking(deps, userId);
  await deps.adHocEventService.handleVoiceLeave(binding.bindingId, userId);
  const rlUser = await deps.usersService.findByDiscordId(userId);
  const uid = rlUser?.id ?? null;
  startVoiceGameTracking(deps, userId, detected.gameId, detected.gameName, uid);
  const mi = buildMemberInfo(userId, guildMember, uid);
  await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    detected.gameId,
    detected.gameName,
  );
}

/** Get game-filtered count for threshold checking (ROK-697). */
export async function getGameFilteredCount(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<{ counted: number; allConfirmed: boolean }> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  if (!channel || !binding.gameId) return { counted: 0, allConfirmed: false };
  const voiceMembers = [...channel.members.values()];
  let counted = 0;
  let allConfirmed = true;
  for (const member of voiceMembers) {
    const detected = await deps.presenceDetector.detectGameForMember(member);
    if (detected.gameId !== null && detected.gameId !== binding.gameId)
      continue;
    counted++;
    if (detected.gameId === null) allConfirmed = false;
  }
  return { counted, allConfirmed };
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
  const voiceMembers = [...channel.members.values()];
  if (voiceMembers.length < minPlayers) return false;
  if (binding.bindingPurpose !== 'general-lobby') return false;
  const detections = await Promise.all(
    voiceMembers.map((m) => deps.presenceDetector.detectGameForMember(m)),
  );
  const firstGameId = detections[0]?.gameId;
  if (firstGameId === null || firstGameId === undefined) return false;
  return detections.every((d) => d.gameId === firstGameId);
}
