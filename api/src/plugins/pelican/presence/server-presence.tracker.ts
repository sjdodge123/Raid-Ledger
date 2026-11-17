import {
  presenceKey,
  type GamePresenceEvent,
  type PlayerRef,
  type PresenceCharacterEvent,
} from './presence-events';
import { clampStoredName } from '../../../common/stored-name.helpers';

/** A player the tracker considers present. `name` is null until a character line names them. */
export interface PresentPlayer extends PlayerRef {
  name: string | null;
  /**
   * The owner id of the character that named them (ROK-1822 r3), so a
   * same-named stranger is not their respawn. Hydrate/restore input and
   * {@link ServerPresenceTracker.snapshotWithOwners} output only.
   */
  owner?: string;
}

/** One presence transition the tracker emits for the Quick Play bridge. */
export interface PresenceChange extends PresentPlayer {
  kind: 'joined' | 'left' | 'renamed';
}

/** Display label for a player: the character name, else the platform id (ROK-1798 ruling 3). */
export function presenceDisplayName(player: PresentPlayer): string {
  return player.name ?? player.playerId;
}

interface Entry {
  /** The player's platform id (ROK-2232); the map key is its {@link presenceKey}. */
  ref: PlayerRef;
  name: string | null;
  lastSeen: number;
  /** The character's owner id once a line names it (ROK-1802), else null. */
  owner: string | null;
}

/**
 * Game-agnostic per-server presence state, keyed by `idKind:playerId`
 * (ROK-1798 Q1/Q5, ROK-1800, ROK-2232) — a SteamID and an XUID with the same
 * digits are two players. Pure and synchronous — no I/O, no timers.
 *
 * - A handshake (`join`) is PENDING: it is not a player until the next
 *   character line pairs to it (FIFO), so a wrong-password attempt
 *   (`auth-failed`) retracts silently with no joined/left churn.
 * - A character line whose name AND owner id belong to a present player is
 *   that player's respawn, and any `0:0` line is a death — neither leaves nor
 *   pairs. The same name from another owner is a new player (ROK-1802).
 *   The session records deaths itself (ROK-1930), asking
 *   {@link ServerPresenceTracker.playerOfCharacter} who died first.
 * - A `heartbeat` count is trusted: 0 → everyone leaves; fewer than tracked →
 *   the longest-silent leave; more than tracked → still-pending handshakes are
 *   promoted unnamed (oldest first) and any remaining excess sets
 *   `overCount` (a missed join no later line can fix).
 * - `server-ready` / `server-stopping` → everyone leaves.
 */
export class ServerPresenceTracker {
  private readonly present = new Map<string, Entry>();
  /** Handshakes not yet a player, oldest first. */
  private readonly pending = new Map<string, { ref: PlayerRef; at: number }>();
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
        return this.onJoin(refOf(event), now);
      case 'character':
        return this.onCharacter(event, now);
      case 'auth-failed':
      case 'leave':
        return this.onLeave(presenceKey(event));
      case 'heartbeat':
        return this.onHeartbeat(event.count, now);
      case 'server-ready':
      case 'server-stopping':
        return this.leaveAll();
    }
  }

  /** Every present player, in join order. */
  snapshot(): PresentPlayer[] {
    return [...this.present.values()].map((e) => ({ ...e.ref, name: e.name }));
  }

  /**
   * {@link snapshot} plus each named player's owner id (ROK-1822 r4): the
   * restore point of a cold replay, and the before/after of an owner-only
   * change the sink must persist.
   */
  snapshotWithOwners(): PresentPlayer[] {
    return [...this.present.values()].map((e) =>
      e.owner === null
        ? { ...e.ref, name: e.name }
        : { ...e.ref, name: e.name, owner: e.owner },
    );
  }

  /** The owner id of a present player's character, else null (ROK-1822 r3). */
  ownerOf(player: PlayerRef): string | null {
    return this.present.get(presenceKey(player))?.owner ?? null;
  }

  /**
   * The first present player named `name`, else null (ROK-1930 D3) — the
   * precedence `findCharacter` uses with no owner, which is all a death line
   * carries. Read-only: touches no lastSeen.
   */
  playerOfCharacter(name: string): PlayerRef | null {
    const key = clampStoredName(name);
    for (const entry of this.present.values())
      if (entry.name === key) return entry.ref;
    return null;
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
      const key = presenceKey(p);
      if (this.present.has(key)) continue;
      this.pending.delete(key);
      this.addNeverSeen(p);
    }
  }

  /** Present with lastSeen 0; an unnamed one queues for the next character line. */
  private addNeverSeen(p: PresentPlayer): void {
    const owner = p.owner ?? null;
    const name = p.name === null ? null : clampStoredName(p.name);
    const key = presenceKey(p);
    this.present.set(key, { ref: refOf(p), name, lastSeen: 0, owner });
    if (p.name === null) this.unnamed.push(key);
  }

  private onJoin(ref: PlayerRef, now: number): PresenceChange[] {
    const key = presenceKey(ref);
    const entry = this.present.get(key);
    // A repeat handshake is a new login (its disconnect went unseen), with a
    // new ZDOID owner: unbind the old one so its next character line rebinds.
    if (entry) Object.assign(entry, { lastSeen: now, owner: null });
    else if (!this.pending.has(key)) this.pending.set(key, { ref, at: now });
    return [];
  }

  private onCharacter(
    event: PresenceCharacterEvent,
    now: number,
  ): PresenceChange[] {
    // Key by the stored (clamped) form so a name restored from the roster
    // still equals its own next line.
    const name = clampStoredName(event.name);
    const { zdoidZero } = event;
    const ownerId = zdoidZero ? undefined : event.ownerId;
    const known = this.findCharacter(name, ownerId);
    if (known) known.lastSeen = now;
    // A death (`0:0`) or a known character's respawn is never a new player.
    if (known || zdoidZero) return [];
    const owner = ownerId ?? null;
    const first = firstEntry(this.pending);
    if (first !== undefined) {
      const [key, { ref }] = first;
      this.pending.delete(key);
      this.present.set(key, { ref, name, lastSeen: now, owner });
      return [{ kind: 'joined', ...ref, name }];
    }
    return this.nameOldestUnnamed(name, now, owner);
  }

  private nameOldestUnnamed(
    name: string,
    now: number,
    owner: string | null,
  ): PresenceChange[] {
    const key = this.unnamed.shift();
    const entry = key === undefined ? undefined : this.present.get(key);
    if (key === undefined || !entry) return [];
    Object.assign(entry, { name, lastSeen: now, owner });
    return [{ kind: 'renamed', ...entry.ref, name }];
  }

  private onLeave(key: string): PresenceChange[] {
    this.pending.delete(key);
    const entry = this.present.get(key);
    if (!entry) return [];
    return [this.remove(key, entry)];
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
    return silent.map(([key, entry]) => this.remove(key, entry));
  }

  private promotePending(n: number, now: number): PresenceChange[] {
    const promoted = [...this.pending].slice(0, n);
    return promoted.map(([key, { ref }]) => {
      this.pending.delete(key);
      this.present.set(key, { ref, name: null, lastSeen: now, owner: null });
      this.unnamed.push(key);
      return { kind: 'joined' as const, ...ref, name: null };
    });
  }

  private leaveAll(): PresenceChange[] {
    const changes = [...this.present.values()].map((e) => ({
      kind: 'left' as const,
      ...e.ref,
      name: e.name,
    }));
    this.reset();
    return changes;
  }

  private remove(key: string, entry: Entry): PresenceChange {
    this.present.delete(key);
    const idx = this.unnamed.indexOf(key);
    if (idx >= 0) this.unnamed.splice(idx, 1);
    return { kind: 'left', ...entry.ref, name: entry.name };
  }

  /**
   * The present player a character line belongs to: same name and, when the
   * line carries one, same owner id (ROK-1802). A same-named player whose
   * owner is not yet known (a legacy row hydrated without one, or
   * re-handshaken) adopts it.
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

function firstEntry<V>(map: Map<string, V>): [string, V] | undefined {
  for (const entry of map) return entry;
  return undefined;
}

/** Just the id fields — never an event's other properties. */
function refOf(ref: PlayerRef): PlayerRef {
  return { playerId: ref.playerId, idKind: ref.idKind };
}
