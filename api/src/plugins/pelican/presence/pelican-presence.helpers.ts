import type { GameLogParserSession } from '../../plugin-host/extension-points';
import {
  presenceKey,
  steamIdOf,
  steamPlayer,
  type GamePresenceEvent,
  type PlayerRef,
} from './presence-events';
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
  const prior = new Map(before.map((p) => [presenceKey(p), p]));
  const next = new Map(after.map((p) => [presenceKey(p), p]));
  const changes: PresenceChange[] = [];
  for (const [key, p] of prior) {
    if (!next.has(key)) changes.push(change('left', p, p.name));
  }
  for (const [key, p] of next) {
    const was = prior.get(key);
    if (!was) changes.push(change('joined', p, p.name));
    else if (p.name !== null && was.name !== p.name) {
      changes.push(change('renamed', p, p.name));
    }
  }
  return changes;
}

function change(
  kind: PresenceChange['kind'],
  ref: PlayerRef,
  name: string | null,
): PresenceChange {
  return { kind, playerId: ref.playerId, idKind: ref.idKind, name };
}

/**
 * Players still present under the same name whose character owner alone
 * changed (ROK-1822 r4) — a repeat handshake clears it, a respawn line
 * adopts one. Not a presence change, but the sink must persist it, or a
 * restart rehydrates a stale owner. Players in `changes` already carry theirs.
 */
export function netOwnerChanges(
  before: PresentPlayer[],
  after: PresentPlayer[],
  changes: PresenceChange[],
): PresentPlayer[] {
  const moved = new Set(changes.map((c) => presenceKey(c)));
  const prior = new Map(before.map((p) => [presenceKey(p), p]));
  return after.filter((p) => {
    const was = prior.get(presenceKey(p));
    if (!was || p.name === null || was.name !== p.name) return false;
    return !moved.has(presenceKey(p)) && was.owner !== p.owner;
  });
}

/**
 * A tracker player as the sink sees them; the owner rides only with a name.
 * Null for a non-Steam player: the sink is still keyed by `steam_id`, so it
 * is skipped rather than stored under the wrong namespace (ROK-2232 lane 2:
 * see {@link steamIdOf}).
 */
export function toSinkPlayer(
  player: PresentPlayer,
  owner: string | null,
): ServerPresencePlayer | null {
  const steamId = steamIdOf(player);
  if (steamId === null) return null;
  const base = { steamId, displayName: player.name ?? steamId };
  return owner === null || player.name === null
    ? base
    : { ...base, characterOwnerId: owner };
}

/** Rehydrated roster → tracker players (a SteamID-only label means "unnamed"). */
export function toPresentPlayers(
  players: ServerPresencePlayer[],
): PresentPlayer[] {
  return players.map((p) => {
    const name = p.displayName === p.steamId ? null : p.displayName;
    const base = { ...sinkPlayerRef(p), name };
    // ROK-1822 r3: the owner only means something next to its name.
    return name !== null && p.characterOwnerId
      ? { ...base, owner: p.characterOwnerId }
      : base;
  });
}

/**
 * The platform id of a player the sink returned. The sink persists only a
 * SteamID today (ROK-2232 lane 2: read the stored `id_kind`/`player_id`
 * once `ServerPresencePlayer` carries them).
 */
export function sinkPlayerRef(player: ServerPresencePlayer): PlayerRef {
  return steamPlayer(player.steamId);
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

/**
 * The parser's event for one console line, or null when it threw (logged by
 * error name only — never the line, which can carry secrets).
 */
export function safeParse(
  opts: {
    source: { pelicanServerId: number };
    parser: GameLogParserSession;
    logger: { warn(message: string): void };
  },
  line: string,
): GamePresenceEvent | null {
  try {
    return opts.parser.parse(line);
  } catch (err) {
    opts.logger.warn(
      `Presence parser threw for server ${opts.source.pelicanServerId}: ${errName(err)}`,
    );
    return null;
  }
}
