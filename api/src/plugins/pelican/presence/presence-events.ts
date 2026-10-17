/**
 * Typed, game-agnostic presence events a per-game log parser emits from one
 * console line (ROK-1798 Q1 / ROK-1800). A parser NEVER returns or keeps the
 * raw line: the console stream is secret-bearing (the startup line can echo
 * the server password), so only these fields leave the parser.
 *
 * `loggedAt` is the line's own timestamp as a zone-less, lexically sortable
 * `yyyy-MM-ddTHH:mm:ss` string (container-local time). It is only for
 * ordering and deduping replayed lines; live lines use receive time.
 */
interface PresenceEventBase {
  loggedAt?: string;
}

/** A peer finished the handshake (pending until a character line names it). */
export interface PresenceJoinEvent extends PresenceEventBase {
  kind: 'join';
  steamId: string;
}

/** A character object was created; `zdoidZero` (`0:0`) means it died. */
export interface PresenceCharacterEvent extends PresenceEventBase {
  kind: 'character';
  name: string;
  zdoidZero: boolean;
  /**
   * The character's owner (Valheim: the ZDOID's user part — the connection's
   * session id), stable across that connection's respawns. It tells two
   * players sharing one character name apart (ROK-1802).
   */
  ownerId?: string;
}

/** The peer failed auth (wrong password) — it never became a player. */
export interface PresenceAuthFailedEvent extends PresenceEventBase {
  kind: 'auth-failed';
  steamId: string;
}

/** The peer's socket closed. */
export interface PresenceLeaveEvent extends PresenceEventBase {
  kind: 'leave';
  steamId: string;
}

/** The server's periodic peer count (Valheim: `Connections N ZDOS:` only). */
export interface PresenceHeartbeatEvent extends PresenceEventBase {
  kind: 'heartbeat';
  count: number;
}

/** The server is up and accepting players. */
export interface PresenceServerReadyEvent extends PresenceEventBase {
  kind: 'server-ready';
}

/** The server is shutting down. */
export interface PresenceServerStoppingEvent extends PresenceEventBase {
  kind: 'server-stopping';
}

export type GamePresenceEvent =
  | PresenceJoinEvent
  | PresenceCharacterEvent
  | PresenceAuthFailedEvent
  | PresenceLeaveEvent
  | PresenceHeartbeatEvent
  | PresenceServerReadyEvent
  | PresenceServerStoppingEvent;

export type GamePresenceEventKind = GamePresenceEvent['kind'];
