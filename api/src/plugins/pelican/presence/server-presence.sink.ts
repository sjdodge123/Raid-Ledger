/**
 * The seam between a game server's presence (the Pelican console supervisor)
 * and Quick Play (the ad-hoc event pipeline) — ROK-1800.
 *
 * The supervisor owns the socket, the per-game parser and the tracker, and
 * reports each transition here. The implementation (in the ad-hoc event
 * services) owns spawn/join/suppression/grace/finalize, identity matching
 * (SteamID64 → users.steam_id) and the one-participant-per-person rule.
 * Pelican never imports the Discord bot; the sink is provided by token.
 */
export const SERVER_PRESENCE_SINK = Symbol('SERVER_PRESENCE_SINK');

/** Which tracked game server a transition came from. */
export interface ServerPresenceSource {
  /** `pelican_servers.id`. */
  pelicanServerId: number;
  /** `pelican_servers.game_id` — the Quick Play's game. */
  gameId: number;
}

export interface ServerPresencePlayer {
  steamId: string;
  /** In-game character name, or the SteamID64 before a character line names them. */
  displayName: string;
  /**
   * ROK-1822 r3: the owner id of the character line that named them
   * (Valheim: the ZDOID session id). Persisted and rehydrated with the name.
   */
  characterOwnerId?: string;
}

export interface ServerPresenceSink {
  /** A player is now on the server (may spawn or join the game's live Quick Play). */
  playerJoined(
    source: ServerPresenceSource,
    player: ServerPresencePlayer,
  ): Promise<void>;
  /** A character line named a player who was already present. */
  playerRenamed(
    source: ServerPresenceSource,
    player: ServerPresencePlayer,
  ): Promise<void>;
  /** A player left the server (Quick Play keeps them while they are still in voice). */
  playerLeft(source: ServerPresenceSource, steamId: string): Promise<void>;
  /**
   * Everyone left at once: the server stopped, or the panel stayed
   * unreachable past the timeout. Equivalent to `playerLeft` for every
   * open server participant of this source.
   */
  serverEmptied(source: ServerPresenceSource): Promise<void>;
  /**
   * A live heartbeat's player count (ROK-1802) — the only evidence that a
   * player held before this session, whose join fell outside the replay, is
   * still on the server.
   */
  playerCount(source: ServerPresenceSource, count: number): Promise<void>;
  /** Server players still open on this source's live Quick Play, for rehydrating after an API restart. */
  openPresence(source: ServerPresenceSource): Promise<ServerPresencePlayer[]>;
  /**
   * Players held for this server below the spawn threshold, oldest first
   * (ROK-1802 Codex r4). A heartbeat can enrol one, so a new session asks
   * after `openPresence` to report their departures.
   */
  heldPresence(source: ServerPresenceSource): Promise<ServerPresencePlayer[]>;
}
