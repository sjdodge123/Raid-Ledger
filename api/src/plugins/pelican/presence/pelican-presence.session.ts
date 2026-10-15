import type { GameLogParser } from '../../plugin-host/extension-points';
import {
  PelicanConsoleSocket,
  type ConsoleCredentialsSource,
} from '../pelican-console-socket';
import type { WingsSocketFactory } from '../pelican-console-socket.helpers';
import {
  errName,
  netPresenceChanges,
  PRESENCE_REPLAY_SETTLE_MS,
  PRESENCE_STOPPED_STATES,
  PRESENCE_UNREACHABLE_EMPTY_MS,
  ReplayWatermark,
  toPresentPlayers,
} from './pelican-presence.helpers';
import type { GamePresenceEvent } from './presence-events';
import type {
  ServerPresenceSink,
  ServerPresenceSource,
} from './server-presence.sink';
import {
  presenceDisplayName,
  ServerPresenceTracker,
  type PresenceChange,
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
  private readonly watermark = new ReplayWatermark();
  private readonly now: () => number;
  private socket: PelicanConsoleSocket | null = null;
  private replay: Buffered[] | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private emptiedOutage: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: PresenceSessionOptions) {
    this.now = opts.now ?? Date.now;
  }

  get serverId(): number {
    return this.opts.source.pelicanServerId;
  }

  async start(): Promise<void> {
    await this.rehydrate();
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
    this.socket?.stop();
    this.socket = null;
    this.clearSettle();
    this.replay = null;
    if (empty) this.emptyAll();
    await this.idle();
  }

  /** Resolves once every queued sink call has settled. */
  idle(): Promise<void> {
    return this.queue;
  }

  private async rehydrate(): Promise<void> {
    try {
      const open = await this.opts.sink.openPresence(this.opts.source);
      this.tracker.hydrate(toPresentPlayers(open));
    } catch (err) {
      this.opts.logger.error(
        `Presence rehydrate failed for server ${this.serverId}: ${errName(err)}`,
      );
    }
  }

  private onLine(line: string): void {
    const event = this.parse(line);
    if (!event || !this.watermark.admit(event.loggedAt)) return;
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
    if (event.kind === 'server-stopping') return this.emptyAll();
    this.forward(this.tracker.apply(event, at));
  }

  private onReachable(): void {
    this.emptiedOutage = null;
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

  private flushReplay(): void {
    this.clearSettle();
    const buffered = this.replay;
    this.replay = null;
    if (!buffered) return;
    const before = this.tracker.snapshot();
    for (const { event, at } of buffered) this.tracker.apply(event, at);
    const changes = netPresenceChanges(before, this.tracker.snapshot());
    this.opts.logger.log(
      `Presence replay for server ${this.serverId}: ${buffered.length} events, ${changes.length} changes`,
    );
    this.forward(changes);
  }

  private onStatus(state: string): void {
    if (!PRESENCE_STOPPED_STATES.has(state)) return;
    this.flushReplay();
    this.emptyAll();
  }

  private onUnreachable(sinceMs: number): void {
    if (this.now() - sinceMs < PRESENCE_UNREACHABLE_EMPTY_MS) return;
    if (this.emptiedOutage === sinceMs) return;
    this.emptiedOutage = sinceMs;
    this.opts.logger.warn(
      `Presence: server ${this.serverId} unreachable past the timeout — emptying`,
    );
    this.emptyAll();
  }

  /** Everyone leaves at once — one `serverEmptied`, only when someone was present. */
  private emptyAll(): void {
    const hadPlayers = this.tracker.snapshot().length > 0;
    this.tracker.hydrate([]);
    if (!hadPlayers) return;
    this.enqueue('serverEmptied', (s, src) => s.serverEmptied(src));
  }

  private forward(changes: PresenceChange[]): void {
    for (const change of changes) {
      const player = {
        steamId: change.steamId,
        displayName: presenceDisplayName(change),
      };
      if (change.kind === 'joined') {
        this.enqueue('playerJoined', (s, src) => s.playerJoined(src, player));
      } else if (change.kind === 'renamed') {
        this.enqueue('playerRenamed', (s, src) => s.playerRenamed(src, player));
      } else {
        this.enqueue('playerLeft', (s, src) => s.playerLeft(src, player.steamId));
      }
    }
  }

  /** Serialised, per-call isolated: one failing sink call never stops the next. */
  private enqueue(
    method: string,
    call: (sink: ServerPresenceSink, src: ServerPresenceSource) => Promise<void>,
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
