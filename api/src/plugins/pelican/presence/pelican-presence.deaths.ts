import type { GamePresenceEvent } from './presence-events';
import type { ServerDeathSink } from './server-death.sink';
import type { ServerPresenceSource } from './server-presence.sink';
import type { ServerPresenceTracker } from './server-presence.tracker';

/** Queues one death-sink call behind the session's other sink calls. */
export type DeathEnqueue = (method: string, call: () => Promise<void>) => void;

export interface PresenceDeathRecorderOptions {
  source: ServerPresenceSource;
  /** Unbound → the recorder does nothing. */
  sink: ServerDeathSink | undefined;
  enqueue: DeathEnqueue;
  logger: { warn(message: string): void };
}

/**
 * ROK-1930 D3 — reports each death (`character` line with a `0:0` ZDOID) to
 * the death sink, attributed against the tracker's roster as it stands at
 * that line. The session calls `observe` BEFORE `tracker.apply`, on the live
 * path and inside the replay loop. A respawn (non-zero ZDOID) is never a
 * death. A death line with no timestamp has no stable dedupe key, so it is
 * dropped with a warn that names only the event kind (D4).
 */
export class PresenceDeathRecorder {
  private skipped = 0;

  constructor(private readonly opts: PresenceDeathRecorderOptions) {}

  /** Death lines dropped for want of a timestamp. */
  get skippedCount(): number {
    return this.skipped;
  }

  observe(
    event: GamePresenceEvent,
    tracker: ServerPresenceTracker,
    at: Date,
  ): void {
    const { sink, source, enqueue, logger } = this.opts;
    if (!sink || event.kind !== 'character' || !event.zdoidZero) return;
    const { loggedAt } = event;
    if (loggedAt === undefined) {
      this.skipped += 1;
      logger.warn(
        `Presence death for server ${source.pelicanServerId} dropped: ${event.kind} line has no timestamp (${this.skipped} so far)`,
      );
      return;
    }
    const death = {
      characterName: event.name,
      steamId: tracker.steamIdOfCharacter(event.name),
      loggedAt,
      at,
    };
    enqueue('playerDied', () => sink.playerDied(source, death));
  }
}
