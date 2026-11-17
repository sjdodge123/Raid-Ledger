import { steamIdOf, type PlayerRef } from './presence-events';
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

/**
 * Payload of `SERVER_PRESENCE_EVENTS.CHANGED`: which server, which game.
 * `rehydrated` marks the boot roster restored from the sink (ROK-1831 Codex
 * r2) and changes reconstructed from replayed console history — the first
 * replay after start, or one re-admitted after a watermark reset (Codex r3):
 * players already present, not arriving. Every unmarked event is a live
 * transition.
 */
export type ServerPresenceChangedPayload = ServerPresenceSource & {
  rehydrated?: true;
};

/**
 * One player on one tracked server, under their platform id of any kind
 * (ROK-2232) — never render the id. Steam-only consumers narrow with
 * {@link steamRoster}.
 */
export interface ServerRosterPlayer extends ServerPresenceSource, PlayerRef {
  /** In-game character name; null until a character line names them. */
  name: string | null;
  /**
   * ROK-1828: the owner id of the character that named them (Valheim: the
   * ZDOID session id). Set only next to a name. An enrol from the tracker
   * persists it, so a restart can tell a same-named stranger from a respawn.
   */
  characterOwnerId?: string;
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
  return players.map((p) => {
    const { playerId, idKind, name, owner } = p;
    return {
      pelicanServerId,
      gameId,
      playerId,
      idKind,
      name,
      // The owner only means something next to its name (ROK-1822 r3).
      ...(name !== null && owner !== undefined
        ? { characterOwnerId: owner }
        : {}),
    };
  });
}

/** A Steam player on a tracked server, with the SteamID64 to match on. */
export type SteamRosterPlayer = ServerRosterPlayer & { steamId: string };

/**
 * The Steam players of a roster (ROK-2232): for consumers that match on
 * `users.steam_id` (hub membership, the live roster panel). Other id kinds
 * are left out, never passed off as a SteamID.
 */
export function steamRoster(players: ServerRosterPlayer[]): SteamRosterPlayer[] {
  return players.flatMap((p) => {
    const steamId = steamIdOf(p);
    return steamId === null ? [] : [{ ...p, steamId }];
  });
}
