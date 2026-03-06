import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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
import {
  resolveGameName,
  createAdHocEventRow,
  findAdminFallback,
  getEventById,
  restoreFromGracePeriod,
  setGracePeriodStatus,
} from './ad-hoc-event.helpers';

/** In-memory state for an active ad-hoc event. */
export interface ActiveAdHocState {
  eventId: number;
  memberSet: Set<string>;
  gameId?: number | null;
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

/** Spawn a brand new ad-hoc event. */
export async function spawnNewEvent(
  deps: AdHocHandlerDeps,
  eventKey: string,
  bindingId: string,
  effectiveBinding: { gameId: number | null | undefined },
  effectiveGameId: number | null | undefined,
  member: VoiceMemberInfo,
  resolvedGameName?: string,
): Promise<number | null> {
  const eventId = await createAdHocEvent(
    deps,
    bindingId,
    effectiveBinding,
    member,
    resolvedGameName,
  );
  if (!eventId) return null;
  registerNewEvent(deps, eventKey, eventId, effectiveGameId, member);
  await enrollMember(deps, eventId, member);
  await broadcastSpawn(
    deps,
    eventId,
    bindingId,
    effectiveGameId,
    member,
    resolvedGameName,
  );
  return eventId;
}

/** Notify spawn and broadcast live status + roster. */
async function broadcastSpawn(
  deps: AdHocHandlerDeps,
  eventId: number,
  bindingId: string,
  effectiveGameId: number | null | undefined,
  member: VoiceMemberInfo,
  resolvedGameName?: string,
): Promise<void> {
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
    gameId: effectiveGameId,
  });
  deps.voiceAttendanceService.handleJoin(
    eventId,
    member.discordUserId,
    member.discordUsername,
    null,
    member.discordAvatarHash,
  );
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
      gameName,
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
  deps: AdHocHandlerDeps,
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

async function createAdHocEvent(
  deps: AdHocHandlerDeps,
  bindingId: string,
  binding: { gameId: number | null | undefined },
  triggerMember: VoiceMemberInfo,
  resolvedGameName?: string,
): Promise<number | null> {
  let creatorId = triggerMember.userId;
  if (!creatorId) {
    creatorId = await findAdminFallback(deps.db);
    if (!creatorId) return null;
  }
  return createAdHocEventRow(
    deps.db,
    bindingId,
    { gameId: binding.gameId ?? null },
    creatorId,
    resolvedGameName,
  );
}

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
    { id: eventId, title: event.title, gameName },
    [
      {
        discordUserId: member.discordUserId,
        discordUsername: member.discordUsername,
      },
    ],
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
