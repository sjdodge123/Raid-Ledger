import type { PresenceChange, PresentPlayer } from './server-presence.tracker';
import type { ServerPresencePlayer } from './server-presence.sink';

/** Panel/Wings unreachable this long → everyone leaves (ROK-1798 Q5, operator Q7). */
export const PRESENCE_UNREACHABLE_EMPTY_MS = 15 * 60_000;

/**
 * Quiet period that ends a post-auth `send logs` replay burst. Replayed
 * events are buffered and netted (before vs after) so an old join+leave
 * pair inside the replay never reaches the sink.
 */
export const PRESENCE_REPLAY_SETTLE_MS = 3_000;

/** Pelican power states that mean "nobody can be on the server". */
export const PRESENCE_STOPPED_STATES: ReadonlySet<string> = new Set([
  'offline',
  'stopping',
]);

/** The net transitions between two presence snapshots, in a stable order. */
export function netPresenceChanges(
  before: PresentPlayer[],
  after: PresentPlayer[],
): PresenceChange[] {
  const prior = new Map(before.map((p) => [p.steamId, p.name]));
  const next = new Map(after.map((p) => [p.steamId, p.name]));
  const changes: PresenceChange[] = [];
  for (const [steamId, name] of prior) {
    if (!next.has(steamId)) changes.push({ kind: 'left', steamId, name });
  }
  for (const [steamId, name] of next) {
    if (!prior.has(steamId)) changes.push({ kind: 'joined', steamId, name });
    else if (name !== null && prior.get(steamId) !== name) {
      changes.push({ kind: 'renamed', steamId, name });
    }
  }
  return changes;
}

/** Rehydrated roster → tracker players (a SteamID-only label means "unnamed"). */
export function toPresentPlayers(
  players: ServerPresencePlayer[],
): PresentPlayer[] {
  return players.map((p) => ({
    steamId: p.steamId,
    name: p.displayName === p.steamId ? null : p.displayName,
  }));
}

/**
 * Dedupes replayed console events against the last processed parsed
 * timestamp (`loggedAt`, lexically sortable). Several events can share one
 * second, so it also counts how many it admitted at that second and, on a
 * new replay pass, skips that many again.
 */
export class ReplayWatermark {
  private last: string | null = null;
  private countAtLast = 0;
  private skip = 0;

  /** A new `send logs` replay is about to arrive. */
  beginPass(): void {
    this.skip = this.countAtLast;
  }

  /** Forget everything processed: the next replay is admitted in full. */
  reset(): void {
    this.last = null;
    this.countAtLast = 0;
    this.skip = 0;
  }

  /** True when the event is newer than anything processed before. */
  admit(loggedAt: string | undefined): boolean {
    if (loggedAt === undefined) return true;
    if (this.last === null || loggedAt > this.last) {
      this.last = loggedAt;
      this.countAtLast = 1;
      this.skip = 0;
      return true;
    }
    if (loggedAt < this.last) return false;
    if (this.skip > 0) {
      this.skip -= 1;
      return false;
    }
    this.countAtLast += 1;
    return true;
  }
}

/**
 * Live console-line counters between two auths (ROK-1821 F2). Counts only —
 * a raw line never reaches a log. `unparsed` is noise the parser ignored;
 * `stale` parsed but sat at or behind the replay watermark.
 */
export class LiveLineStats {
  private lines = 0;
  private applied = 0;
  private unparsed = 0;
  private stale = 0;

  record(parsed: boolean, admitted: boolean): void {
    this.lines += 1;
    if (!parsed) this.unparsed += 1;
    else if (admitted) this.applied += 1;
    else this.stale += 1;
  }

  /** The summary so far, then start counting afresh. */
  take(): string {
    const text = `${this.lines} live lines, ${this.applied} applied, ${this.unparsed} unparsed, ${this.stale} stale`;
    this.lines = this.applied = this.unparsed = this.stale = 0;
    return text;
  }
}

export function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown error';
}
