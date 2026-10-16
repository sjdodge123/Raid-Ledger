import type {
  GamePresenceEvent,
  PresenceCharacterEvent,
} from './presence-events';

/** A player the tracker considers present. `name` is null until a character line names them. */
export interface PresentPlayer {
  steamId: string;
  name: string | null;
}

/** One presence transition the tracker emits for the Quick Play bridge. */
export interface PresenceChange extends PresentPlayer {
  kind: 'joined' | 'left' | 'renamed';
}

/** Display label for a player: the character name, else the SteamID64 (ROK-1798 ruling 3). */
export function presenceDisplayName(player: PresentPlayer): string {
  return player.name ?? player.steamId;
}

interface Entry {
  name: string | null;
  lastSeen: number;
  /** The character's owner id once a line names it (ROK-1802), else null. */
  owner: string | null;
}

/**
 * Game-agnostic per-server presence state, keyed by SteamID64 (ROK-1798 Q1/Q5,
 * ROK-1800). Pure and synchronous — no I/O, no timers.
 *
 * - A handshake (`join`) is PENDING: it is not a player until the next
 *   character line pairs to it (FIFO), so a wrong-password attempt
 *   (`auth-failed`) retracts silently with no joined/left churn.
 * - A character line whose name AND owner id belong to a present player is
 *   that player's respawn, and any `0:0` line is a death — neither leaves nor
 *   pairs. The same name from another owner is a new player (ROK-1802).
 * - A `heartbeat` count is trusted: 0 → everyone leaves; fewer than tracked →
 *   the longest-silent leave; more than tracked → still-pending handshakes are
 *   promoted unnamed (oldest first) and any remaining excess sets
 *   `overCount` (a missed join no later line can fix).
 * - `server-ready` / `server-stopping` → everyone leaves.
 */
export class ServerPresenceTracker {
  private readonly present = new Map<string, Entry>();
  /** Handshakes not yet a player, oldest first (value = handshake time). */
  private readonly pending = new Map<string, number>();
  /** Present players still waiting for a character name, oldest first. */
  private readonly unnamed: string[] = [];
  private excess = false;

  /** True after a heartbeat reported more peers than the tracker could account for. */
  get overCount(): boolean {
    return this.excess;
  }

  /** Apply one event observed at `at` (receive time for live lines). */
  apply(event: GamePresenceEvent, at: Date): PresenceChange[] {
    const now = at.getTime();
    switch (event.kind) {
      case 'join':
        return this.onJoin(event.steamId, now);
      case 'character':
        return this.onCharacter(event, now);
      case 'auth-failed':
      case 'leave':
        return this.onLeave(event.steamId);
      case 'heartbeat':
        return this.onHeartbeat(event.count, now);
      case 'server-ready':
      case 'server-stopping':
        return this.leaveAll();
    }
  }

  /** Every present player, in join order. */
  snapshot(): PresentPlayer[] {
    return [...this.present].map(([steamId, e]) => ({ steamId, name: e.name }));
  }

  /** Replace all state with a persisted roster (RL restart path). Emits nothing. */
  hydrate(players: PresentPlayer[]): void {
    this.reset();
    for (const p of players) this.addNeverSeen(p);
  }

  /**
   * Re-add any of `players` the tracker no longer holds, as never-seen
   * (lastSeen 0, so a later low heartbeat evicts them first). Emits nothing.
   * Used after a cold-start replay, whose history must not remove players
   * the persisted roster says are present (ROK-1800 FB1).
   */
  restore(players: PresentPlayer[]): void {
    for (const p of players) {
      if (this.present.has(p.steamId)) continue;
      this.pending.delete(p.steamId);
      this.addNeverSeen(p);
    }
  }

  /** Present with lastSeen 0; an unnamed one queues for the next character line. */
  private addNeverSeen(p: PresentPlayer): void {
    this.present.set(p.steamId, { name: p.name, lastSeen: 0, owner: null });
    if (p.name === null) this.unnamed.push(p.steamId);
  }

  private onJoin(steamId: string, now: number): PresenceChange[] {
    const entry = this.present.get(steamId);
    // A repeat handshake is a new login (its disconnect went unseen), with a
    // new ZDOID owner: unbind the old one so its next character line rebinds.
    if (entry) Object.assign(entry, { lastSeen: now, owner: null });
    else if (!this.pending.has(steamId)) this.pending.set(steamId, now);
    return [];
  }

  private onCharacter(
    event: PresenceCharacterEvent,
    now: number,
  ): PresenceChange[] {
    const { name, zdoidZero } = event;
    const ownerId = zdoidZero ? undefined : event.ownerId;
    const known = this.findCharacter(name, ownerId);
    if (known) known.lastSeen = now;
    // A death (`0:0`) or a known character's respawn is never a new player.
    if (known || zdoidZero) return [];
    const owner = ownerId ?? null;
    const pendingId = firstKey(this.pending);
    if (pendingId !== undefined) {
      this.pending.delete(pendingId);
      this.present.set(pendingId, { name, lastSeen: now, owner });
      return [{ kind: 'joined', steamId: pendingId, name }];
    }
    return this.nameOldestUnnamed(name, now, owner);
  }

  private nameOldestUnnamed(
    name: string,
    now: number,
    owner: string | null,
  ): PresenceChange[] {
    const steamId = this.unnamed.shift();
    const entry = steamId === undefined ? undefined : this.present.get(steamId);
    if (steamId === undefined || !entry) return [];
    Object.assign(entry, { name, lastSeen: now, owner });
    return [{ kind: 'renamed', steamId, name }];
  }

  private onLeave(steamId: string): PresenceChange[] {
    this.pending.delete(steamId);
    const entry = this.present.get(steamId);
    if (!entry) return [];
    return [this.remove(steamId, entry)];
  }

  private onHeartbeat(count: number, now: number): PresenceChange[] {
    if (count === 0) return this.leaveAll();
    if (count < this.present.size) {
      this.excess = false;
      return this.leaveLongestSilent(this.present.size - count);
    }
    const changes = this.promotePending(count - this.present.size, now);
    this.excess = count > this.present.size;
    return changes;
  }

  private leaveLongestSilent(n: number): PresenceChange[] {
    const silent = [...this.present]
      .sort(([, a], [, b]) => a.lastSeen - b.lastSeen)
      .slice(0, n);
    return silent.map(([steamId, entry]) => this.remove(steamId, entry));
  }

  private promotePending(n: number, now: number): PresenceChange[] {
    const ids = [...this.pending.keys()].slice(0, n);
    return ids.map((steamId) => {
      this.pending.delete(steamId);
      this.present.set(steamId, { name: null, lastSeen: now, owner: null });
      this.unnamed.push(steamId);
      return { kind: 'joined' as const, steamId, name: null };
    });
  }

  private leaveAll(): PresenceChange[] {
    const changes = [...this.present].map(([steamId, e]) => ({
      kind: 'left' as const,
      steamId,
      name: e.name,
    }));
    this.reset();
    return changes;
  }

  private remove(steamId: string, entry: Entry): PresenceChange {
    this.present.delete(steamId);
    const idx = this.unnamed.indexOf(steamId);
    if (idx >= 0) this.unnamed.splice(idx, 1);
    return { kind: 'left', steamId, name: entry.name };
  }

  /**
   * The present player a character line belongs to: same name and, when the
   * line carries one, same owner id (ROK-1802). A same-named player whose
   * owner is not yet known (hydrated after a restart, or re-handshaken)
   * adopts it.
   */
  private findCharacter(
    name: string,
    ownerId: string | undefined,
  ): Entry | undefined {
    let unowned: Entry | undefined;
    for (const entry of this.present.values()) {
      if (entry.name !== name) continue;
      if (ownerId === undefined || entry.owner === ownerId) return entry;
      if (entry.owner === null) unowned ??= entry;
    }
    if (unowned && ownerId !== undefined) unowned.owner = ownerId;
    return unowned;
  }

  private reset(): void {
    this.present.clear();
    this.pending.clear();
    this.unnamed.length = 0;
    this.excess = false;
  }
}

function firstKey(map: Map<string, unknown>): string | undefined {
  for (const key of map.keys()) return key;
  return undefined;
}
