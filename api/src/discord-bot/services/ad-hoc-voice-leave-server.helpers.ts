/**
 * ROK-1821 (RCA F1 safety net) — a voice leave that empties the channel only
 * starts grace when nobody is on the game's server. Open on-server rows say
 * so first; failing that, the server-presence service (which owns the Pelican
 * TRACKER) answers {@link SERVER_TRACKER_ENROL}: when the tracker reports
 * players for the game it enrols them into the event and answers `true`, so
 * a later server leave can still start grace once the server empties.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { startGracePeriod } from './ad-hoc-event.handlers';
import { hasOpenServerPlayers } from './ad-hoc-server-presence.helpers';

/** Asks the server-presence service to enrol the tracker's players. */
export const SERVER_TRACKER_ENROL = 'ad-hoc.server-tracker.enrol';

export interface ServerTrackerEnrolPayload {
  eventId: number;
  gameId: number;
}

type GraceDeps = Parameters<typeof startGracePeriod>[0];
type Emitter = Pick<EventEmitter2, 'emitAsync'>;

export interface VoiceEmptiedEvent {
  eventId: number;
  gameId: number | null;
  bindingId: string | null;
}

const logger = new Logger('AdHocVoiceLeaveServer');

/** True when any `SERVER_TRACKER_ENROL` listener reports tracked players. */
async function trackerKeepsAlive(
  emitter: Emitter,
  payload: ServerTrackerEnrolPayload,
): Promise<boolean> {
  try {
    const answers: unknown[] = await emitter.emitAsync(
      SERVER_TRACKER_ENROL,
      payload,
    );
    return answers.some((a) => a === true);
  } catch (err) {
    logger.warn(`Tracker check for ${payload.eventId} failed: ${String(err)}`);
    return false;
  }
}

/** Whether the game's server keeps a voice-emptied event out of grace. */
export async function serverKeepsEventAlive(
  deps: Pick<GraceDeps, 'db'>,
  emitter: Emitter,
  ev: VoiceEmptiedEvent,
): Promise<boolean> {
  if (await hasOpenServerPlayers(deps.db, ev.eventId)) return true;
  if (ev.gameId === null) return false;
  return trackerKeepsAlive(emitter, { eventId: ev.eventId, gameId: ev.gameId });
}

/** The voice channel emptied: start grace unless the server keeps it alive. */
export async function graceUnlessOnServer(
  deps: GraceDeps,
  emitter: Emitter,
  ev: VoiceEmptiedEvent,
): Promise<void> {
  if (await serverKeepsEventAlive(deps, emitter, ev)) return;
  await startGracePeriod(deps, ev.eventId, ev.bindingId);
}
