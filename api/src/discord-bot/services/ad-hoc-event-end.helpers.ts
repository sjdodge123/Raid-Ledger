/**
 * The end of an ad-hoc session — the completion card, the grace period that
 * follows the last leave, and teardown on cancel/delete. Split from
 * `ad-hoc-event.handlers.ts` (300-line cap); behaviour unchanged.
 */
import type * as tables from '../../drizzle/schema';
import type { AdHocHandlerDeps } from './ad-hoc-event.handlers';
import { bindingIdForEvent } from './ad-hoc-event-key.helpers';
import { resolveGameName, setGracePeriodStatus } from './ad-hoc-event.helpers';

/** `gameName` only when resolved — the notify payloads type it as optional. */
export function gameNameField(gameName: string | undefined): {
  gameName?: string;
} {
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

/**
 * Start the grace period when all members leave. The status flip runs first
 * and is guarded to `live`: when it matches no row (already ended, or already
 * in grace) nothing is enqueued or broadcast.
 */
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

  if (!(await setGracePeriodStatus(deps.db, eventId))) return;
  await deps.gracePeriodQueue.enqueue(
    eventId,
    Math.max(1, rawGrace) * 60 * 1000,
  );
  deps.gateway.emitStatusChange(eventId, 'grace_period');
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
