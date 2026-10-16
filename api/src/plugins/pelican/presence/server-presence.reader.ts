import type { ServerPresenceSource } from './server-presence.sink';
import type { PresentPlayer } from './server-presence.tracker';

/**
 * ROK-1801 — the read side of game-server presence: who is on each tracked
 * server RIGHT NOW, straight from the supervisor's in-memory trackers (the
 * below-threshold state exists nowhere else).
 *
 * Direction mirrors `SERVER_PRESENCE_SINK`: Pelican never imports the Discord
 * bot, and the Discord bot never imports `PelicanModule` — it injects this
 * token (bound globally by `ServerPresenceReaderModule`) with
 * `@Optional() @Inject(SERVER_PRESENCE_READER)`. Unbound = plugin absent.
 */
export const SERVER_PRESENCE_READER = Symbol('SERVER_PRESENCE_READER');

/** Emitted (EventEmitter2) after a server's roster changed and the sink settled. */
export const SERVER_PRESENCE_EVENTS = {
  CHANGED: 'server-presence.changed',
} as const;

/** Payload of `SERVER_PRESENCE_EVENTS.CHANGED`: which server, which game. */
export type ServerPresenceChangedPayload = ServerPresenceSource;

/** One player on one tracked server. */
export interface ServerRosterPlayer extends ServerPresenceSource {
  /** SteamID64 — match against `users.steam_id`; never render it. */
  steamId: string;
  /** In-game character name; null until a character line names them. */
  name: string | null;
}

export interface ServerPresenceReader {
  /** Every player on every tracked server (synchronous, in-memory). */
  playersOnGames(): ServerRosterPlayer[];
  /** Every player on every tracked server of `gameId` — not deduped across servers. */
  playersForGame(gameId: number): ServerRosterPlayer[];
}

/** A tracker snapshot tagged with the server it came from. */
export function rosterOf(
  source: ServerPresenceSource,
  players: PresentPlayer[],
): ServerRosterPlayer[] {
  const { pelicanServerId, gameId } = source;
  return players.map((p) => ({ pelicanServerId, gameId, ...p }));
}
