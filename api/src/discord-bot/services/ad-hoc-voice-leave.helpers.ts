/**
 * A member's leave from a live ad-hoc event, after the in-memory state and
 * voice attendance are updated: close their participant row, refresh the card
 * and roster, and start grace once nobody is left. Split from
 * `AdHocEventService` (300-line cap); behaviour unchanged.
 */
import type * as schema from '../../drizzle/schema';
import {
  emitRosterToClients,
  type ActiveAdHocState,
  type AdHocHandlerDeps,
} from './ad-hoc-event.handlers';
import { hasOpenVoiceParticipants } from './ad-hoc-server-presence.helpers';
import { graceUnlessOnServer } from './ad-hoc-voice-leave-server.helpers';

/** Settle one member's leave; grace only when the event is truly empty. */
export async function processVoiceLeave(
  deps: AdHocHandlerDeps,
  eventEmitter: Parameters<typeof graceUnlessOnServer>[1],
  state: ActiveAdHocState,
  event: typeof schema.events.$inferSelect,
  discordUserId: string,
): Promise<void> {
  await deps.participantService.markLeave(state.eventId, discordUserId);
  if (event.channelBindingId) {
    deps.notificationService.queueUpdate(state.eventId, event.channelBindingId);
  }
  await emitRosterToClients(deps, state.eventId);
  // ROK-1800/1821: anyone on the game server (rows or tracker) keeps it alive.
  if (state.memberSet.size > 0) return;
  // ROK-1888: another channel's open voice row (in-memory drift) keeps it live.
  if (await hasOpenVoiceParticipants(deps.db, state.eventId)) return;
  await graceUnlessOnServer(deps, eventEmitter, {
    eventId: state.eventId,
    gameId: event.gameId,
    bindingId: event.channelBindingId,
  });
}
