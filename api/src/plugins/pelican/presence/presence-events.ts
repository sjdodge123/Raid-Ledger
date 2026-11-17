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

/**
 * Which platform namespace a player id belongs to (ROK-2232). Valheim's
 * handshake carries a SteamID64; Minecraft Java a player UUID, Bedrock an
 * Xbox XUID. Ids from different kinds never compare equal, even when their
 * digits match — see {@link presenceKey}.
 */
export type PlayerIdKind = 'steam' | 'minecraft-uuid' | 'xuid';

/** A player's platform id and the namespace it lives in (ROK-2232). */
export interface PlayerRef {
  playerId: string;
  idKind: PlayerIdKind;
}

/** The one map key for a player: `idKind:playerId`, so kinds never collide. */
export function presenceKey(ref: PlayerRef): string {
  return `${ref.idKind}:${ref.playerId}`;
}

/** A Steam player (Valheim's handshake / the persisted `steam_id` column). */
export function steamPlayer(steamId: string): PlayerRef {
  return { playerId: steamId, idKind: 'steam' };
}

/**
 * The SteamID64 of a player, or null for any other kind. The sink and the
 * reader carry the full `PlayerRef` (ROK-2232); only Steam-only consumers —
 * `users.steam_id` matching, hub membership, the Valheim death recorder —
 * use this, and a non-Steam id is never treated as a Steam (or Discord) id.
 */
export function steamIdOf(ref: PlayerRef): string | null {
  return ref.idKind === 'steam' ? ref.playerId : null;
}

const ID_KINDS: readonly PlayerIdKind[] = ['steam', 'minecraft-uuid', 'xuid'];

/**
 * A stored `(player_id, id_kind)` pair as a ref (ROK-2232); null when either
 * is missing or the kind is unknown — such a row is never guessed at.
 */
export function storedPlayerRef(
  playerId: string | null,
  idKind: string | null,
): PlayerRef | null {
  const kind = ID_KINDS.find((k) => k === idKind);
  return playerId === null || kind === undefined
    ? null
    : { playerId, idKind: kind };
}

/** A peer finished the handshake (pending until a character line names it). */
export interface PresenceJoinEvent extends PresenceEventBase, PlayerRef {
  kind: 'join';
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
export interface PresenceAuthFailedEvent extends PresenceEventBase, PlayerRef {
  kind: 'auth-failed';
}

/** The peer's socket closed. */
export interface PresenceLeaveEvent extends PresenceEventBase, PlayerRef {
  kind: 'leave';
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
