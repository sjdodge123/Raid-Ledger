import type { GameLogParser } from '../../plugin-host/extension-points';
import {
  PelicanConsoleSocket,
  type ConsoleCredentialsSource,
} from '../pelican-console-socket';
import type { WingsSocketFactory } from '../pelican-console-socket.helpers';
import {
  errName,
  LiveLineStats,
  netOwnerChanges,
  netPresenceChanges,
  PRESENCE_REPLAY_SETTLE_MS,
  PRESENCE_STOPPED_STATES,
  PRESENCE_UNREACHABLE_EMPTY_MS,
  ReplayWatermark,
  toPresentPlayers,
  toSinkPlayer,
} from './pelican-presence.helpers';
import { UntrackedHeldPlayers } from './pelican-presence.held';
import type { GamePresenceEvent } from './presence-events';
import { rosterOf, type ServerRosterPlayer } from './server-presence.reader';
import type {
  ServerPresenceSink,
  ServerPresenceSource,
} from './server-presence.sink';
import {
  ServerPresenceTracker,
  type PresenceChange,
  type PresentPlayer,
} from './server-presence.tracker';

/** The logger surface a session uses — messages carry ids/kinds/counts only. */
export interface PresenceLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface PresenceSessionOptions {
  source: ServerPresenceSource;
  /** Pelican client identifier. Never logged. */
  serverIdentifier: string;
  panelUrl: string;
  getCredentials: ConsoleCredentialsSource;
  parser: GameLogParser;
  sink: ServerPresenceSink;
  logger: PresenceLogger;
  socketFactory?: WingsSocketFactory;
  now?: () => number;
  /** Roster changed; called once the queued sink calls settled (ROK-1801). */
  onChanged?: (source: ServerPresenceSource) => void;
}

interface Buffered {
  event: GamePresenceEvent;
  at: Date;
}

/**
 * One tracked server's presence pipeline (ROK-1800 L5): console socket →
 * per-game parser → tracker → sink. Rehydrates from the sink before the
 * socket opens; nets each post-auth replay burst so already-known players
 * re-emit nothing. Raw console lines never leave `onLine`.
 */
export class PelicanPresenceSession {
  private readonly tracker = new ServerPresenceTracker();
  /** Holds a heartbeat may enrol that the tracker never saw (Codex r4). */
  private readonly held = new UntrackedHeldPlayers();
  private readonly watermark = new ReplayWatermark();
  private readonly stats = new LiveLineStats();
  private readonly now: () => number;
  private socket: PelicanConsoleSocket | null = null;
  private replay: Buffered[] | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private emptiedOutage: number | null = null;
  private emptiedOnce = false;
  /** True until the first replay after `start()` has been flushed. */
  private cold = true;
  private queue: Promise<void> = Promise.resolve();
  /** Set by `stop()`; a `start()` still rehydrating then never opens a socket. */
  private stopped = false;

  constructor(private readonly opts: PresenceSessionOptions) {
    this.now = opts.now ?? Date.now;
  }

  get serverId(): number {
    return this.opts.source.pelicanServerId;
  }

  /**
   * Who is on this server now, tagged with its source (ROK-1801 read port),
   * with each named player's character owner (ROK-1828).
   */
  players(): ServerRosterPlayer[] {
    return rosterOf(this.opts.source, this.tracker.snapshotWithOwners());
  }

  async start(): Promise<void> {
    await this.rehydrate();
    // Stopped while rehydrating (e.g. Pelican deactivated): the supervisor
    // no longer tracks this session, so a socket opened now would never close.
    if (this.stopped) return;
    const o = this.opts;
    this.socket = new PelicanConsoleSocket({
      serverIdentifier: o.serverIdentifier,
      panelUrl: o.panelUrl,
      getCredentials: o.getCredentials,
      onLine: (line) => this.onLine(line),
      onStatus: (state) => this.onStatus(state),
      onUnreachable: (since) => this.onUnreachable(since),
      onReachable: () => this.onReachable(),
      ...(o.socketFactory ? { socketFactory: o.socketFactory } : {}),
      now: this.now,
    });
    this.socket.start();
  }

  /** Close the socket; `empty` reports everyone present as gone. */
  async stop(empty: boolean): Promise<void> {
    this.stopped = true;
    this.socket?.stop();
    this.socket = null;
    this.clearSettle();
    this.replay = null;
    if (empty) this.emptyAll('session stopped');
    // Not emptied, but no longer read: the roster readers saw is gone.
    else if (this.tracker.snapshot().length > 0) this.notify();
    await this.idle();
  }

  /** Resolves once every queued sink call has settled. */
  idle(): Promise<void> {
    return this.queue;
  }

  /**
   * Seeds the tracker from the sink's open rows. A row comes back under its
   * character name — linked rows too (ROK-1822) — so its next character line
   * is that player's respawn, never a pending handshake's first line.
   */
  private async rehydrate(): Promise<void> {
    try {
      const { sink, source } = this.opts;
      const open = await sink.openPresence(source);
      const held = await sink.heldPresence(source);
      if (this.stopped) return;
      this.tracker.hydrate(toPresentPlayers(open));
      const ids = (ps: { steamId: string }[]) => ps.map((p) => p.steamId);
      this.held.reset(ids(held), ids(open));
      if (open.length > 0) this.notify();
    } catch (err) {
      this.opts.logger.error(
        `Presence rehydrate failed for server ${this.serverId}: ${errName(err)}`,
      );
    }
  }

  private onLine(line: string): void {
    const mode = this.replay ? 'replay' : 'live';
    const event = this.parse(line);
    const admitted = event !== null && this.watermark.admit(event.loggedAt);
    if (mode === 'live') this.stats.record(event !== null, admitted);
    if (!event || !admitted) return;
    // ROK-1821 F2: the kind and path only — never the line itself. Live only
    // (review MINOR 6): a replay already logs its own summary line.
    if (mode === 'live')
      this.opts.logger.log(
        `Presence event for server ${this.serverId}: ${event.kind} (${mode})`,
      );
    const at = new Date(this.now());
    if (this.replay) {
      this.replay.push({ event, at });
      this.armSettle();
    } else {
      this.applyLive(event, at);
    }
  }

  private parse(line: string): GamePresenceEvent | null {
    try {
      return this.opts.parser.parse(line);
    } catch (err) {
      this.opts.logger.warn(
        `Presence parser threw for server ${this.serverId}: ${errName(err)}`,
      );
      return null;
    }
  }

  private applyLive(event: GamePresenceEvent, at: Date): void {
    if (event.kind === 'server-stopping')
      return this.emptyAll('server-stopping line');
    const before = this.tracker.snapshotWithOwners();
    const changes = this.tracker.apply(event, at);
    this.forward(changes);
    this.forwardOwners(before, changes);
    this.forwardHeldLeaves(event);
    if (event.kind !== 'heartbeat') return;
    const { count } = event;
    this.enqueue('playerCount', (s, src) => s.playerCount(src, count));
  }

  /**
   * Codex r4: a held player the tracker never saw may be enrolled by a
   * heartbeat, so their disconnect line — or a count with no room left for
   * them — must still reach the sink, or their row never closes.
   */
  private forwardHeldLeaves(event: GamePresenceEvent): void {
    let gone: string[] = [];
    if (event.kind === 'leave' && this.held.forget(event.steamId))
      gone = [event.steamId];
    else if (event.kind === 'heartbeat')
      gone = this.held.fit(event.count, this.tracker.snapshot().length);
    for (const steamId of gone)
      this.enqueue('playerLeft', (s, src) => s.playerLeft(src, steamId));
  }

  private onReachable(): void {
    this.emptiedOutage = null;
    if (!this.cold) {
      this.opts.logger.log(
        `Presence re-auth for server ${this.serverId}: ${this.stats.take()} since the last auth`,
      );
    }
    // A re-auth inside the settle window: the buffered events already
    // advanced the watermark, so apply them now rather than drop them.
    this.flushReplay();
    this.watermark.beginPass();
    this.replay = [];
    this.armSettle();
  }

  private armSettle(): void {
    this.clearSettle();
    this.settleTimer = setTimeout(
      () => this.flushReplay(),
      PRESENCE_REPLAY_SETTLE_MS,
    );
  }

  private clearSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  /**
   * Applies a buffered replay and forwards only its net effect. The first
   * replay after `start()` is hydration only: the watermark is empty, so it
   * is history that predates this process and may sit before the persisted
   * roster's state (an old low heartbeat would evict a current player). It
   * can add or rename players but never removes a rehydrated one; a real
   * departure during downtime is repaired by the next live heartbeat, which
   * evicts never-seen players first. A false departure could not be repaired.
   */
  private flushReplay(): void {
    this.clearSettle();
    const buffered = this.replay;
    this.replay = null;
    if (!buffered) return;
    // With owners (ROK-1822 r4): a restore must not null a hydrated owner.
    const before = this.tracker.snapshotWithOwners();
    for (const { event, at } of buffered) this.tracker.apply(event, at);
    if (this.cold) this.tracker.restore(before);
    this.cold = false;
    const changes = netPresenceChanges(before, this.tracker.snapshot());
    this.opts.logger.log(
      `Presence replay for server ${this.serverId}: ${buffered.length} events, ${changes.length} changes`,
    );
    this.forward(changes);
    this.forwardOwners(before, changes);
  }

  private onStatus(state: string): void {
    if (!PRESENCE_STOPPED_STATES.has(state)) return;
    this.flushReplay();
    this.emptyAll(`status ${state}`);
  }

  private onUnreachable(sinceMs: number): void {
    if (this.now() - sinceMs < PRESENCE_UNREACHABLE_EMPTY_MS) return;
    if (this.emptiedOutage === sinceMs) return;
    this.emptiedOutage = sinceMs;
    this.opts.logger.warn(
      `Presence: server ${this.serverId} unreachable past the timeout — emptying`,
    );
    this.emptyAll('unreachable past the timeout');
    // The tracker no longer holds anyone the watermark saw: let the next
    // replay re-admit those lines so players still on the server re-enrol.
    this.watermark.reset();
  }

  /** Everyone leaves at once — one `serverEmptied` (see the guard below). */
  private emptyAll(reason: string): void {
    const tracked = this.tracker.snapshot().length;
    const hadPlayers = tracked > 0;
    // ROK-1821 F6: say why everyone is leaving (a stop vs a lost stream).
    this.opts.logger.log(
      `Presence: emptying server ${this.serverId} (${reason}); ${tracked} tracked`,
    );
    this.tracker.hydrate([]);
    this.held.clear(); // serverEmptied clears the sink's holds too
    // ROK-1802 Codex r2: a session's first empty runs even with nobody
    // tracked — it clears holds the tracker never knew (unconfirmed ones
    // from the last session). Later ones need someone present.
    if (!hadPlayers && this.emptiedOnce) return;
    this.emptiedOnce = true;
    this.enqueue('serverEmptied', (s, src) => s.serverEmptied(src));
    if (hadPlayers) this.notify();
  }

  private forward(changes: PresenceChange[]): void {
    for (const change of changes) {
      const owner = this.tracker.ownerOf(change.steamId);
      const player = toSinkPlayer(change, owner);
      if (change.kind === 'joined') {
        this.held.forget(change.steamId); // the tracker owns them now
        this.enqueue('playerJoined', (s, src) => s.playerJoined(src, player));
      } else if (change.kind === 'renamed') {
        this.enqueue('playerRenamed', (s, src) => s.playerRenamed(src, player));
      } else {
        this.enqueue('playerLeft', (s, src) =>
          s.playerLeft(src, player.steamId),
        );
      }
    }
    if (changes.length > 0) this.notify();
  }

  /**
   * ROK-1822 r4: an owner-only change (a repeat handshake clearing it, a
   * respawn adopting one) is persisted through `playerRenamed` under the
   * unchanged name. It is not a presence change: no join/leave, no notify.
   */
  private forwardOwners(
    before: PresentPlayer[],
    changes: PresenceChange[],
  ): void {
    const after = this.tracker.snapshotWithOwners();
    for (const p of netOwnerChanges(before, after, changes)) {
      const player = toSinkPlayer(p, p.owner ?? null);
      this.enqueue('playerRenamed', (s, src) => s.playerRenamed(src, player));
    }
  }

  /** Queued behind the sink calls, so a listener sees their outcome. */
  private notify(): void {
    const cb = this.opts.onChanged;
    if (cb)
      this.enqueue('onChanged', (_s, src) => Promise.resolve(cb({ ...src })));
  }

  /** Serialised, per-call isolated: one failing sink call never stops the next. */
  private enqueue(
    method: string,
    call: (
      sink: ServerPresenceSink,
      src: ServerPresenceSource,
    ) => Promise<void>,
  ): void {
    const { sink, source, logger } = this.opts;
    this.queue = this.queue.then(async () => {
      try {
        await call(sink, source);
      } catch (err) {
        logger.error(
          `Presence sink ${method} failed for server ${this.serverId}: ${errName(err)}`,
        );
      }
    });
  }
}
