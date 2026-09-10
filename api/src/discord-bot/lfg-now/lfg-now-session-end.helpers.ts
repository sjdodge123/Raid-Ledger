/**
 * ROK-1494 Q4 / ROK-1505 AC10 — tell LFG that a spawned session has ended.
 *
 * `finalizeAll` is a single bulk UPDATE that deliberately bypasses
 * `markLeave`, so no `PARTICIPANT_LEFT` fires and the LFG surfaces never
 * learn the session is over: the forum post reads `PLAYING NOW · N in voice`
 * forever and its `lfg_group_messages` row stays `open`, which holds the game
 * hostage to `uq_lfg_group_messages_game_open` — that game can then never
 * post another LFM message. This is the one emit that closes the loop.
 *
 * `'converted'` with the event as its own target is chosen because it is the
 * existing vocabulary that produces the CONVERTED terminal render, closes the
 * row and archives the thread. Nothing new was added to the reason set.
 *
 * Emitted AFTER the end has been written, and never allowed to throw: it runs
 * inside the reaper's cron sweep AND inside `AdHocEventService.finalizeEvent`,
 * so one unreachable game must not stop the rest of the orphans from being
 * reaped, nor make a normal finalize look like a failure to its caller.
 *
 * ROK-1505 AC10a — this lives here, in ONE place, because BOTH session-end
 * paths must announce. The reaper only ever sees events it classifies as
 * ORPHANED; the ordinary end (grace period expires → `finalizeEvent`) never
 * reached the reaper at all, so before AC10 the common case left the row
 * `open` and wedged the game. Two callers, one body.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  LFG_EVENTS,
  type LfgGroupChangedPayload,
} from '../../lfg/lfg.constants';
import { lfgSpawnedEventGameId } from './lfg-now.db-helpers';

/** What the announce needs from its caller. */
export interface LfgSessionEndDeps {
  db: PostgresJsDatabase<typeof schema>;
  eventEmitter: EventEmitter2;
}

/** Shared fallback logger, so a caller need not pass one. */
const fallbackLogger = new Logger('LfgSessionEnd');

/**
 * Announce that an LFG-spawned session has ended.
 *
 * @param deps - Drizzle handle plus the application event emitter.
 * @param eventId - The event that was just ended.
 * @param logger - Caller's logger, so the warn line names the real origin.
 */
export async function announceLfgSessionEnd(
  deps: LfgSessionEndDeps,
  eventId: number,
  logger: Logger = fallbackLogger,
): Promise<void> {
  try {
    const gameId = await lfgSpawnedEventGameId(deps.db, eventId);
    if (gameId === null) return; // Not LFG-born: nothing subscribes.
    deps.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, {
      gameId,
      reason: 'converted',
      eventId,
    } satisfies LfgGroupChangedPayload);
  } catch (err) {
    logger.warn(
      `Could not tell LFG that session ${eventId} ended: ${String(err)}. ` +
        'Its group message will be closed by the next reconcile.',
    );
  }
}
