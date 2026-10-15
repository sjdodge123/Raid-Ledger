import { Logger } from '@nestjs/common';
import type { PelicanResult } from './pelican-client';
import type { PelicanWebsocketCredentials } from './pelican-api.schemas';
import {
  consoleBackoffMs,
  firstStringArg,
  nodeWingsSocketFactory,
  panelOrigin,
  parseWingsFrame,
  wingsFrame,
  type WingsFrame,
  type WingsSocket,
  type WingsSocketFactory,
} from './pelican-console-socket.helpers';

/** Fetches fresh Wings credentials — normally `PelicanClient.getWebsocketCredentials`. */
export type ConsoleCredentialsSource = (
  serverIdentifier: string,
) => Promise<PelicanResult<PelicanWebsocketCredentials>>;

export interface PelicanConsoleSocketOptions {
  /** Pelican client identifier (`ServerData.identifier`). Never logged. */
  serverIdentifier: string;
  /** Panel base URL; its origin is sent as `Origin` (Wings checks it). */
  panelUrl: string;
  getCredentials: ConsoleCredentialsSource;
  /** One raw console line. SECRET-BEARING: never log or persist it. */
  onLine: (line: string) => void;
  /** Wings power state push (`running`, `offline`, `starting`, …). */
  onStatus?: (state: string) => void;
  /**
   * Called after every failed connect/drop while unreachable, with the
   * epoch ms the outage began. The supervisor applies the 15-min rule.
   */
  onUnreachable?: (sinceMs: number) => void;
  /** Called on every `auth success` (the outage, if any, is over). */
  onReachable?: () => void;
  socketFactory?: WingsSocketFactory;
  /** Jitter source, [0, 1). Injected by specs. */
  random?: () => number;
  now?: () => number;
}

/**
 * One server's Wings console stream (ROK-1800). `start()` fetches a token,
 * opens the socket with `Origin`, sends `auth`, then `send logs` (≤150-line
 * replay) on `auth success`. Re-auths on `token expiring` on the same socket;
 * reconnects with backoff (1s→60s, jitter) on close / error / `token
 * expired` / `jwt error`. Logs only states and counts — never a line.
 */
export class PelicanConsoleSocket {
  private readonly logger = new Logger(PelicanConsoleSocket.name);
  private readonly origin: string;
  private readonly factory: WingsSocketFactory;
  private socket: WingsSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped per connection attempt and on stop — stale callbacks no-op. */
  private generation = 0;
  private attempt = 0;
  private running = false;
  private unreachableSince: number | null = null;
  private lines = 0;

  constructor(private readonly opts: PelicanConsoleSocketOptions) {
    this.origin = panelOrigin(opts.panelUrl);
    this.factory = opts.socketFactory ?? nodeWingsSocketFactory;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  /** Closes the socket and cancels any pending reconnect or re-auth. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    this.clearTimer();
    this.closeSocket();
  }

  private async connect(): Promise<void> {
    const gen = ++this.generation;
    const creds = await this.fetchCredentials();
    if (!this.isCurrent(gen)) return;
    if (!creds.ok) return this.fail(gen, `credentials ${creds.error.kind}`);
    const { socket, token } = creds.data;
    this.lines = 0;
    try {
      this.socket = this.factory(socket, this.origin, {
        onOpen: () => this.whenCurrent(gen, () => this.sendAuth(token)),
        onMessage: (data) =>
          this.whenCurrent(gen, () => this.dispatch(gen, data)),
        onClose: () => this.fail(gen, 'closed'),
      });
    } catch {
      this.fail(gen, 'connect threw');
    }
  }

  private dispatch(gen: number, data: unknown): void {
    const frame = parseWingsFrame(data);
    if (!frame) return;
    switch (frame.event) {
      case 'auth success':
        return this.onAuthenticated();
      case 'console output':
        return this.deliverLine(frame);
      case 'status':
        return this.deliverStatus(frame);
      case 'token expiring':
        return void this.reauth(gen);
      case 'token expired':
      case 'jwt error':
        return this.fail(gen, frame.event);
      default:
        return;
    }
  }

  private onAuthenticated(): void {
    this.attempt = 0;
    this.unreachableSince = null;
    this.send('send logs', [null]);
    this.logger.log('Wings console authenticated; requested log replay');
    this.safely('onReachable', () => this.opts.onReachable?.());
  }

  private deliverLine(frame: WingsFrame): void {
    const line = firstStringArg(frame);
    if (line === null) return;
    this.lines += 1;
    this.safely('onLine', () => this.opts.onLine(line));
  }

  private deliverStatus(frame: WingsFrame): void {
    const state = firstStringArg(frame);
    if (state === null) return;
    this.safely('onStatus', () => this.opts.onStatus?.(state));
  }

  /** `token expiring`: fresh token, re-`auth` on the SAME socket. */
  private async reauth(gen: number): Promise<void> {
    const creds = await this.fetchCredentials();
    if (!this.isCurrent(gen)) return;
    if (!creds.ok) {
      // `token expired` follows and triggers a reconnect.
      this.logger.warn(`Wings console re-auth failed: ${creds.error.kind}`);
      return;
    }
    this.sendAuth(creds.data.token);
  }

  /** Tear down the current socket and schedule the next attempt. */
  private fail(gen: number, reason: string): void {
    if (!this.isCurrent(gen)) return;
    this.generation += 1;
    this.closeSocket();
    const now = (this.opts.now ?? Date.now)();
    this.unreachableSince ??= now;
    const since = this.unreachableSince;
    const delay = consoleBackoffMs(
      this.attempt,
      (this.opts.random ?? Math.random)(),
    );
    this.attempt += 1;
    this.logger.warn(
      `Wings console ${reason} after ${this.lines} lines; reconnect #${this.attempt} in ${delay}ms`,
    );
    this.safely('onUnreachable', () => this.opts.onUnreachable?.(since));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  private async fetchCredentials(): Promise<
    PelicanResult<PelicanWebsocketCredentials>
  > {
    try {
      return await this.opts.getCredentials(this.opts.serverIdentifier);
    } catch {
      return { ok: false, error: { kind: 'network' } };
    }
  }

  private sendAuth(token: string): void {
    this.send('auth', [token]);
  }

  private send(event: string, args: unknown[]): void {
    try {
      this.socket?.send(wingsFrame(event, args));
    } catch {
      this.logger.warn(`Wings console send failed: ${event}`);
    }
  }

  private isCurrent(gen: number): boolean {
    return this.running && gen === this.generation;
  }

  private whenCurrent(gen: number, fn: () => void): void {
    if (this.isCurrent(gen)) fn();
  }

  /** Callback errors never break the stream; only the error name is logged. */
  private safely(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const kind = err instanceof Error ? err.name : typeof err;
      this.logger.error(`Wings console ${name} callback threw ${kind}`);
    }
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Already closed — nothing to do.
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
