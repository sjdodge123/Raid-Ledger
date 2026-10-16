/**
 * ROK-1800 — game-server players held below a binding's `minPlayers`, per
 * Pelican server. Each entry keeps its source so a live event that appears
 * from ANY source (voice, or another server) can drain every server of that
 * game (Codex r2), not just the server that next sees a join.
 */
import type {
  ServerPresencePlayer,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';

export interface HeldServer {
  source: ServerPresenceSource;
  players: ServerPresencePlayer[];
}

interface Entry {
  source: ServerPresenceSource;
  players: Map<string, ServerPresencePlayer>;
}

export class PendingServerPlayers {
  private readonly held = new Map<number, Entry>();

  /** Hold a player; returns how many this server now holds. */
  hold(source: ServerPresenceSource, player: ServerPresencePlayer): number {
    const entry = this.held.get(source.pelicanServerId) ?? {
      source,
      players: new Map<string, ServerPresencePlayer>(),
    };
    entry.players.set(player.steamId, player);
    this.held.set(source.pelicanServerId, entry);
    return entry.players.size;
  }

  players(pelicanServerId: number): ServerPresencePlayer[] {
    return [...(this.held.get(pelicanServerId)?.players.values() ?? [])];
  }

  /** A held player's new character name (never enrols a stranger). */
  rename(pelicanServerId: number, player: ServerPresencePlayer): void {
    const entry = this.held.get(pelicanServerId);
    if (entry?.players.has(player.steamId))
      entry.players.set(player.steamId, player);
  }

  remove(pelicanServerId: number, steamId: string): void {
    this.held.get(pelicanServerId)?.players.delete(steamId);
  }

  clear(pelicanServerId: number): void {
    this.held.delete(pelicanServerId);
  }

  /** Forget and return this server's held players. */
  take(pelicanServerId: number): ServerPresencePlayer[] {
    const players = this.players(pelicanServerId);
    this.held.delete(pelicanServerId);
    return players;
  }

  hasGame(gameId: number): boolean {
    for (const entry of this.held.values())
      if (entry.source.gameId === gameId && entry.players.size > 0) return true;
    return false;
  }

  /** Forget and return every server holding players for `gameId`. */
  takeGame(gameId: number, exceptServerId?: number): HeldServer[] {
    const out: HeldServer[] = [];
    for (const [id, entry] of this.held) {
      if (entry.source.gameId !== gameId || id === exceptServerId) continue;
      out.push({ source: entry.source, players: [...entry.players.values()] });
      this.held.delete(id);
    }
    return out;
  }
}
