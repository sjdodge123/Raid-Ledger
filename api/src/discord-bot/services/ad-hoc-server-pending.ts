/**
 * ROK-1800 — game-server players held below a binding's `minPlayers`, per
 * Pelican server. Each entry keeps its source so a live event that appears
 * from ANY source (voice, or another server) can drain every server of that
 * game (Codex r2), not just the server that next sees a join.
 *
 * ROK-1802 — a fresh presence session cannot vouch for players held by the
 * last one (one may have left while nobody watched), and Wings' replay is too
 * short to re-report a long-held player. So a reopen marks the holds
 * `unconfirmed` instead of dropping them. A join line confirms one again; a
 * heartbeat (a bare player COUNT) covers the unconfirmed ones once it is high
 * enough, dropping the oldest unconfirmed first until it is. Only confirmed or
 * covered holds count toward a spawn or are enrolled.
 */
import type {
  ServerPresencePlayer,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';

export interface HeldServer {
  source: ServerPresenceSource;
  players: ServerPresencePlayer[];
}

type HoldState = 'confirmed' | 'covered' | 'unconfirmed';

interface Held {
  player: ServerPresencePlayer;
  state: HoldState;
}

interface Entry {
  source: ServerPresenceSource;
  /** Insertion order = hold order, so the oldest hold comes first. */
  players: Map<string, Held>;
}

const eligible = (h: Held): boolean => h.state !== 'unconfirmed';

export class PendingServerPlayers {
  private readonly held = new Map<number, Entry>();

  /** Hold (or re-confirm) a player; returns how many this server can enrol. */
  hold(source: ServerPresenceSource, player: ServerPresencePlayer): number {
    const entry = this.held.get(source.pelicanServerId) ?? {
      source,
      players: new Map<string, Held>(),
    };
    // Codex r2: a remapped server's holds route to its CURRENT game.
    entry.source = source;
    entry.players.set(player.steamId, { player, state: 'confirmed' });
    this.held.set(source.pelicanServerId, entry);
    return this.players(source.pelicanServerId).length;
  }

  /** The players this server can enrol (confirmed or heartbeat-covered). */
  players(pelicanServerId: number): ServerPresencePlayer[] {
    const entry = this.held.get(pelicanServerId);
    return [...(entry?.players.values() ?? [])]
      .filter(eligible)
      .map((h) => h.player);
  }

  /** A held player's new character name (never enrols a stranger). */
  rename(pelicanServerId: number, player: ServerPresencePlayer): void {
    const held = this.held.get(pelicanServerId)?.players.get(player.steamId);
    if (held) held.player = player;
  }

  remove(pelicanServerId: number, steamId: string): void {
    this.held.get(pelicanServerId)?.players.delete(steamId);
    this.prune(pelicanServerId);
  }

  clear(pelicanServerId: number): void {
    this.held.delete(pelicanServerId);
  }

  /** A new presence session: every hold here needs re-confirming (ROK-1802). */
  unconfirm(pelicanServerId: number): void {
    for (const h of this.held.get(pelicanServerId)?.players.values() ?? [])
      h.state = 'unconfirmed';
  }

  /** True while any hold here is not confirmed by a join line. */
  hasUnconfirmed(pelicanServerId: number): boolean {
    const players = this.held.get(pelicanServerId)?.players.values() ?? [];
    return [...players].some((h) => h.state !== 'confirmed');
  }

  /**
   * Fit the unconfirmed holds to a heartbeat's player `count`: drop the
   * oldest until `confirmed + unconfirmed ≤ count`, then mark the rest
   * covered. Returns true when a hold became newly enrollable.
   */
  reconcile(pelicanServerId: number, count: number): boolean {
    const players = this.held.get(pelicanServerId)?.players;
    if (!players) return false;
    const all = [...players];
    const open = all.filter(([, h]) => h.state !== 'confirmed');
    const confirmed = all.length - open.length;
    while (open.length > 0 && confirmed + open.length > count) {
      const oldest = open.shift();
      if (oldest) players.delete(oldest[0]);
    }
    const fresh = open.filter(([, h]) => h.state === 'unconfirmed');
    for (const [, h] of open) h.state = 'covered';
    return fresh.length > 0;
  }

  /** Forget and return this server's enrollable players (others stay held). */
  take(pelicanServerId: number): ServerPresencePlayer[] {
    const entry = this.held.get(pelicanServerId);
    if (!entry) return [];
    const out: ServerPresencePlayer[] = [];
    for (const [steamId, h] of entry.players) {
      if (!eligible(h)) continue;
      out.push(h.player);
      entry.players.delete(steamId);
    }
    this.prune(pelicanServerId);
    return out;
  }

  /** Codex r2: an empty entry must not keep a stale `source` alive. */
  private prune(pelicanServerId: number): void {
    if (this.held.get(pelicanServerId)?.players.size === 0)
      this.held.delete(pelicanServerId);
  }

  hasGame(gameId: number): boolean {
    for (const [id, entry] of this.held)
      if (entry.source.gameId === gameId && this.players(id).length > 0)
        return true;
    return false;
  }

  /** Forget and return every server's enrollable players for `gameId`. */
  takeGame(gameId: number, exceptServerId?: number): HeldServer[] {
    const out: HeldServer[] = [];
    for (const [id, entry] of this.held) {
      if (entry.source.gameId !== gameId || id === exceptServerId) continue;
      const players = this.take(id);
      if (players.length > 0) out.push({ source: entry.source, players });
    }
    return out;
  }
}
