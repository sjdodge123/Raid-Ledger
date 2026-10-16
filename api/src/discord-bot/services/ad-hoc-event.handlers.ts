import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SpawnClearance } from './ad-hoc-spawn-clearance';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type {
  AdHocParticipantService,
  VoiceMemberInfo,
} from './ad-hoc-participant.service';
import type { AdHocNotificationService } from './ad-hoc-notification.service';
import type { VoiceAttendanceService } from './voice-attendance.service';
import type { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import type { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import type { ChannelBindingsService } from './channel-bindings.service';
import { adoptEventState, bindingIdForEvent } from './ad-hoc-event-key.helpers';
import {
  resolveGameName,
  getEventById,
  restoreFromGracePeriod,
  setGracePeriodStatus,
} from './ad-hoc-event.helpers';

import { createVoiceQuickPlay } from './ad-hoc-game-spawn-lock';
/** In-memory state for an active ad-hoc event. */
export interface ActiveAdHocState {
  eventId: number;
  memberSet: Set<string>;
  gameId?: number | null;
}

/** Binding shape `handleVoiceJoin` needs (a `ResolvedBinding` satisfies it). */
export interface VoiceJoinBinding {
  gameId: number | null;
  config: {
    minPlayers?: number;
    gracePeriod?: number;
    notificationChannelId?: string;
  } | null;
}

/** Dependencies injected from AdHocEventService. */
export interface AdHocHandlerDeps {
  db: PostgresJsDatabase<typeof schema>;
  participantService: AdHocParticipantService;
  notificationService: AdHocNotificationService;
  voiceAttendanceService: VoiceAttendanceService;
  gateway: AdHocEventsGateway;
  gracePeriodQueue: AdHocGracePeriodQueueService;
  channelBindingsService: ChannelBindingsService;
  activeEvents: Map<string, ActiveAdHocState>;
  autoSignupParticipant: (
    eventId: number,
    member: VoiceMemberInfo,
  ) => Promise<void>;
}

/** Handle a join to an existing live event. Returns true if handled. */
export async function handleJoinExisting(
  deps: AdHocHandlerDeps,
  state: ActiveAdHocState,
  eventKey: string,
  bindingId: string,
  member: VoiceMemberInfo,
): Promise<boolean> {
  const existing = await getEventById(deps.db, state.eventId);
  if (!existing || existing.adHocStatus === 'ended' || existing.cancelledAt) {
    deps.activeEvents.delete(eventKey);
    return false;
  }

  state.memberSet.add(member.discordUserId);
  deps.voiceAttendanceService.handleJoin(
    state.eventId,
    member.discordUserId,
    member.discordUsername,
    null,
    member.discordAvatarHash,
  );

  await deps.gracePeriodQueue.cancel(state.eventId);
  const restored = await restoreFromGracePeriod(deps.db, state.eventId);
  if (restored) deps.gateway.emitStatusChange(state.eventId, 'live');
  await deps.participantService.addParticipant(state.eventId, member);
  await deps.autoSignupParticipant(state.eventId, member);

  deps.notificationService.queueUpdate(state.eventId, bindingId);
  await emitRosterToClients(deps, state.eventId);
  return true;
}

/**
 * Spawn a brand new ad-hoc event.
 *
 * `clearance` (ROK-1456) is the structural gate: only
 * `AdHocEventService.ensureNotSuppressed` can mint one, so a spawn is
 * unreachable without the ROK-959 suppression guard having run.
 */
export async function spawnNewEvent(
  deps: AdHocHandlerDeps,
  clearance: SpawnClearance,
  eventKey: string,
  bindingId: string,
  effectiveBinding: { gameId: number | null | undefined },
  effectiveGameId: number | null | undefined,
  member: VoiceMemberInfo,
  resolvedGameName?: string,
): Promise<number | null> {
  const created = await createVoiceQuickPlay(
    deps.db,
    bindingId,
    effectiveBinding,
    member,
    resolvedGameName,
  );
  if (!created) return null;
  await completeSpawn(deps, created, {
    eventKey,
    bindingId,
    effectiveGameId,
    member,
    resolvedGameName,
  });
  return created.eventId;
}

interface SpawnContext {
  eventKey: string;
  bindingId: string;
  effectiveGameId: number | null | undefined;
  member: VoiceMemberInfo;
  resolvedGameName?: string | undefined;
}

/** Join the race winner's event, or register + announce the new one. */
async function completeSpawn(
  deps: AdHocHandlerDeps,
  created: NonNullable<Awaited<ReturnType<typeof createVoiceQuickPlay>>>,
  ctx: SpawnContext,
): Promise<void> {
  const { eventKey, bindingId, effectiveGameId, member } = ctx;
  const { eventId } = created;
  if (created.existing) {
    await joinRaceWinner(
      deps,
      eventKey,
      bindingId,
      effectiveGameId,
      member,
      eventId,
    );
    return;
  }
  registerNewEvent(deps, eventKey, eventId, effectiveGameId, member);
  await enrollMember(deps, eventId, member);
  await broadcastSpawn(deps, eventId, ctx);
}

/** Notify spawn and broadcast live status + roster. */
async function broadcastSpawn(
  deps: AdHocHandlerDeps,
  eventId: number,
  ctx: SpawnContext,
): Promise<void> {
  const { bindingId, effectiveGameId, member, resolvedGameName } = ctx;
  await notifySpawn(
    deps,
    eventId,
    bindingId,
    effectiveGameId,
    member,
    resolvedGameName,
  );
  deps.gateway.emitStatusChange(eventId, 'live');
  await emitRosterToClients(deps, eventId);
}

/** Add a member as a participant and auto-signup. */
async function enrollMember(
  deps: AdHocHandlerDeps,
  eventId: number,
  member: VoiceMemberInfo,
): Promise<void> {
  await deps.participantService.addParticipant(eventId, member);
  await deps.autoSignupParticipant(eventId, member);
}

/**
 * ROK-1800: another spawn (the game-server path, or a concurrent voice join)
 * created this game's Quick Play while we waited on the spawn lock — adopt it
 * under our key and join it. Codex r2: when a voice spawn already registered
 * the event, MERGE into its state; a fresh empty `memberSet` would drop that
 * first joiner and their leave would never be seen.
 */
async function joinRaceWinner(
  deps: AdHocHandlerDeps,
  eventKey: string,
  bindingId: string,
  effectiveGameId: number | null | undefined,
  member: VoiceMemberInfo,
  eventId: number,
): Promise<void> {
  const state = adoptEventState(
    deps.activeEvents,
    eventKey,
    eventId,
    effectiveGameId,
  );
  await handleJoinExisting(deps, state, eventKey, bindingId, member);
}

/** Register a new event in active state and track voice attendance. */
function registerNewEvent(
  deps: AdHocHandlerDeps,
  eventKey: string,
  eventId: number,
  effectiveGameId: number | null | undefined,
  member: VoiceMemberInfo,
): void {
  deps.activeEvents.set(eventKey, {
    eventId,
    memberSet: new Set([member.discordUserId]),
    ...(effectiveGameId !== undefined ? { gameId: effectiveGameId } : {}),
  });
  deps.voiceAttendanceService.handleJoin(
    eventId,
    member.discordUserId,
    member.discordUsername,
    null,
    member.discordAvatarHash,
  );
}

/** `gameName` only when resolved — the notify payloads type it as optional. */
function gameNameField(gameName: string | undefined): { gameName?: string } {
  return gameName !== undefined ? { gameName } : {};
}

/** Send completed notification. */
export async function notifyCompleted(
  deps: AdHocHandlerDeps,
  eventId: number,
  event: typeof tables.events.$inferSelect,
  now: Date,
): Promise<void> {
  if (!event.channelBindingId) return;

  let gameName: string | undefined;
  if (event.gameId) {
    gameName = await resolveGameName(deps.db, event.gameId);
  }

  const participants = await deps.participantService.getRoster(eventId);
  await deps.notificationService.notifyCompleted(
    eventId,
    event.channelBindingId,
    {
      id: eventId,
      title: event.title,
      ...gameNameField(gameName),
      startTime: event.duration[0].toISOString(),
      endTime: now.toISOString(),
    },
    participants.map((p) => ({
      discordUserId: p.discordUserId,
      discordUsername: p.discordUsername,
      totalDurationSeconds: p.totalDurationSeconds,
    })),
  );
}

/** Start the grace period when all members leave. */
export async function startGracePeriod(
  deps: Pick<
    AdHocHandlerDeps,
    'db' | 'channelBindingsService' | 'gracePeriodQueue' | 'gateway'
  >,
  eventId: number,
  channelBindingId: string | null,
): Promise<void> {
  const binding = channelBindingId
    ? await deps.channelBindingsService.getBindingById(channelBindingId)
    : null;
  const rawGrace =
    (binding?.config as { gracePeriod?: number } | null)?.gracePeriod ?? 5;

  await deps.gracePeriodQueue.enqueue(
    eventId,
    Math.max(1, rawGrace) * 60 * 1000,
  );
  await setGracePeriodStatus(deps.db, eventId);
  deps.gateway.emitStatusChange(eventId, 'grace_period');
}

// ─── Internal helpers ──────────────────────────────────

async function notifySpawn(
  deps: AdHocHandlerDeps,
  eventId: number,
  bindingId: string,
  effectiveGameId: number | null | undefined,
  member: VoiceMemberInfo,
  resolvedGameName?: string,
): Promise<void> {
  const event = await getEventById(deps.db, eventId);
  if (!event) return;

  let gameName = resolvedGameName;
  if (!gameName && effectiveGameId) {
    gameName = await resolveGameName(deps.db, effectiveGameId);
  }

  await deps.notificationService.notifySpawn(
    eventId,
    bindingId,
    { id: eventId, title: event.title, ...gameNameField(gameName) },
    [
      {
        discordUserId: member.discordUserId,
        discordUsername: member.discordUsername,
      },
    ],
    effectiveGameId,
  );
}

async function emitRosterToClients(
  deps: AdHocHandlerDeps,
  eventId: number,
): Promise<void> {
  const participants = await deps.participantService.getRoster(eventId);
  const activeCount = await deps.participantService.getActiveCount(eventId);
  deps.gateway.emitRosterUpdate(eventId, participants, activeCount);
}

/**
 * Tear down a cancelled or deleted session: cancel its grace job and drop its
 * active state. A no-op for an event that is not active here (a scheduled
 * event, or a session already finalised).
 *
 * ROK-1766 M1: on CANCEL (`finaliseCard`) the session's card(s) are ended
 * first — the scheduled CANCELLED builder skips ad-hoc events, so nothing
 * else would. A DELETE skips it: the event row (and its tracked rows) is gone.
 */
export async function removeActiveSession(
  deps: AdHocHandlerDeps,
  eventId: number,
  finaliseCard: boolean,
): Promise<void> {
  const bindingId = bindingIdForEvent(deps.activeEvents, eventId);
  if (bindingId === undefined) return;
  if (finaliseCard) {
    await deps.notificationService.notifyCancelled(eventId, bindingId);
  }
  await deps.gracePeriodQueue.cancel(eventId);
  for (const [key, state] of deps.activeEvents) {
    if (state.eventId === eventId) deps.activeEvents.delete(key);
  }
}
