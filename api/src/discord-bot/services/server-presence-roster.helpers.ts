/**
 * ROK-1801 layer B — the game-server roster as the Discord bot sees it.
 *
 * Pure: turns the Pelican reader's per-server players plus the matching
 * `users` rows into one per-game roster, deduped per person. The DB reads
 * live in `ServerPresenceRosterService`; everything decidable lives here.
 */
import type { ServerRosterPlayer } from '../../plugins/pelican/presence/server-presence.reader';

/** One person on a game's server(s). Never carries a SteamID as a name. */
export interface ServerRosterEntry {
  /** Dedupe key: `user:<id>` when linked, else `steam:<steamId>`. */
  key: string;
  steamId: string;
  userId: number | null;
  /** The linked user's Discord id — how a voice member is matched. */
  discordUserId: string | null;
  /**
   * Linked → RL `users.username`; unlinked → the character name; `null` for
   * an unlinked player no character line has named yet (shown as `+N on
   * server`, operator ruling Q4).
   */
  name: string | null;
}

/** Everyone on every tracked server, grouped by game. */
export interface ServerRoster {
  byGame: Map<number, ServerRosterEntry[]>;
  /** Display names for every game in `byGame` (a server-only group needs one). */
  gameNames: Map<number, string>;
}

/** What `VoiceHandlerDeps` / the card depend on — the service, or a fake. */
export interface ServerRosterSource {
  snapshot(): Promise<ServerRoster>;
}

/** A `users` row whose `steam_id` matched a server player. */
export interface LinkedSteamUser {
  id: number;
  discordId: string | null;
  steamId: string | null;
  username: string;
}

export interface RosterGameRow {
  id: number;
  name: string;
}

export function emptyServerRoster(): ServerRoster {
  return { byGame: new Map(), gameNames: new Map() };
}

function toEntry(
  player: ServerRosterPlayer,
  user: LinkedSteamUser | undefined,
): ServerRosterEntry {
  if (user)
    return {
      key: `user:${user.id}`,
      steamId: player.steamId,
      userId: user.id,
      discordUserId: user.discordId,
      name: user.username,
    };
  return {
    key: `steam:${player.steamId}`,
    steamId: player.steamId,
    userId: null,
    discordUserId: null,
    name: player.name,
  };
}

/** Add `entry` once per person; a named duplicate replaces an unnamed one. */
function addOnce(bucket: ServerRosterEntry[], entry: ServerRosterEntry): void {
  const at = bucket.findIndex((e) => e.key === entry.key);
  if (at === -1) bucket.push(entry);
  else if (bucket[at]?.name === null && entry.name !== null) bucket[at] = entry;
}

/**
 * Build the per-game roster. One person on two servers of the same game is
 * listed once (by user id when linked, else by SteamID). Players on a game
 * with no `games` row are dropped — a group needs a name to render.
 */
export function buildServerRoster(
  players: ServerRosterPlayer[],
  users: LinkedSteamUser[],
  games: RosterGameRow[],
): ServerRoster {
  const roster = emptyServerRoster();
  const nameOf = new Map(games.map((g) => [g.id, g.name]));
  const userBySteam = new Map(
    users.flatMap((u) => (u.steamId ? [[u.steamId, u] as const] : [])),
  );
  for (const player of players) {
    const gameName = nameOf.get(player.gameId);
    if (gameName === undefined) continue;
    roster.gameNames.set(player.gameId, gameName);
    const bucket = roster.byGame.get(player.gameId) ?? [];
    addOnce(bucket, toEntry(player, userBySteam.get(player.steamId)));
    roster.byGame.set(player.gameId, bucket);
  }
  return roster;
}
