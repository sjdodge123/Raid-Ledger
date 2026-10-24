import type { ServerPresenceSource } from './server-presence.sink';

/**
 * ROK-1930 — the seam between a game server's console (the Pelican presence
 * session) and a game plugin that records player deaths. Game-agnostic:
 * Pelican never imports the plugin; the sink is provided by token and
 * injected `@Optional()`, so servers with no bound sink record nothing.
 */
export const SERVER_DEATH_SINK = Symbol('SERVER_DEATH_SINK');

/** One death seen in a server's console. */
export interface ServerDeathEvent {
  /** The character name from the log line. Free game text — never logged. */
  characterName: string;
  /** The present player that name belongs to at that line, else null. */
  steamId: string | null;
  /** The line's own zone-less `yyyy-MM-ddTHH:mm:ss` timestamp (the dedupe key). */
  loggedAt: string;
  /** When the session observed the line (receive time). */
  at: Date;
}

export interface ServerDeathSink {
  /** A player died. Must be idempotent: replays resend old lines. */
  playerDied(
    source: ServerPresenceSource,
    death: ServerDeathEvent,
  ): Promise<void>;
}
