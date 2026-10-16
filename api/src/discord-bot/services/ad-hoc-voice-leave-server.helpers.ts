/**
 * ROK-1821 (RCA F1 safety net) — a voice leave that empties the channel only
 * starts grace when nobody is on the game's server. Open on-server rows say
 * so first; failing that, a player the Pelican TRACKER reports for the game
 * keeps the event alive too, and is enrolled on the spot (the server-presence
 * service handles {@link SERVER_TRACKER_ENROL}) so a later server leave can
 * still start grace once the server empties.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { ServerPresenceReader } from '../../plugins/pelican/presence/server-presence.reader';
import { hasOpenServerPlayers } from './ad-hoc-server-presence.helpers';

/** Asks the server-presence service to enrol the tracker's players. */
export const SERVER_TRACKER_ENROL = 'ad-hoc.server-tracker.enrol';

export interface ServerTrackerEnrolPayload {
  eventId: number;
  gameId: number;
}

export interface ServerAliveDeps {
  db: PostgresJsDatabase<typeof schema>;
  reader: ServerPresenceReader | null;
  eventEmitter: Pick<EventEmitter2, 'emitAsync'>;
}

const logger = new Logger('AdHocVoiceLeaveServer');

/** Whether the game's server keeps a voice-emptied event out of grace. */
export async function serverKeepsEventAlive(
  deps: ServerAliveDeps,
  eventId: number,
  gameId: number | null,
): Promise<boolean> {
  if (await hasOpenServerPlayers(deps.db, eventId)) return true;
  if (gameId === null || !deps.reader) return false;
  if (deps.reader.playersForGame(gameId).length === 0) return false;
  const payload: ServerTrackerEnrolPayload = { eventId, gameId };
  try {
    await deps.eventEmitter.emitAsync(SERVER_TRACKER_ENROL, payload);
  } catch (err) {
    logger.warn(`Tracker enrol for event ${eventId} failed: ${String(err)}`);
  }
  return true;
}
