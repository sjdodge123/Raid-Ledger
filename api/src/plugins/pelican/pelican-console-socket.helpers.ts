/**
 * Wings console websocket plumbing for {@link PelicanConsoleSocket}
 * (ROK-1800, design: docs/spikes/ROK-1798 Q2 + Q5).
 *
 * The console stream is secret-bearing (the egg's startup line can echo
 * `-password "…"`), so nothing in here ever logs or returns a raw frame.
 */

/** First reconnect delay. */
export const CONSOLE_BACKOFF_BASE_MS = 1_000;
/** Reconnect delays never exceed this (jitter included). */
export const CONSOLE_BACKOFF_CAP_MS = 60_000;
/** ± fraction applied to every backoff step. */
export const CONSOLE_BACKOFF_JITTER = 0.2;
/**
 * No frame at all for this long → treat the socket as half-open and
 * reconnect. Longer than the ~10-min token lifetime, whose `token expiring`
 * frame a live socket always delivers (ROK-1800 review m8).
 */
export const CONSOLE_LIVENESS_MS = 11 * 60_000;

/**
 * Delay before reconnect attempt `attempt` (0-based): 1s, 2s, 4s … capped at
 * 60s, each scaled by a jitter factor in [1-J, 1+J). `random` ∈ [0, 1).
 */
export function consoleBackoffMs(attempt: number, random: number): number {
  const exp = Math.min(Math.max(0, Math.floor(attempt)), 16);
  const base = Math.min(
    CONSOLE_BACKOFF_CAP_MS,
    CONSOLE_BACKOFF_BASE_MS * 2 ** exp,
  );
  const factor =
    1 - CONSOLE_BACKOFF_JITTER + 2 * CONSOLE_BACKOFF_JITTER * random;
  return Math.round(Math.min(CONSOLE_BACKOFF_CAP_MS, base * factor));
}

/** One Wings frame: `{ "event": string, "args"?: unknown[] }`. */
export interface WingsFrame {
  event: string;
  args: unknown[];
}

/** Parse a Wings frame; anything malformed is `null` (never echoed). */
export function parseWingsFrame(data: unknown): WingsFrame | null {
  if (typeof data !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const event: unknown = Reflect.get(raw, 'event');
  const args: unknown = Reflect.get(raw, 'args');
  if (typeof event !== 'string') return null;
  return { event, args: Array.isArray(args) ? args : [] };
}

/** First string arg of a frame, or `null`. */
export function firstStringArg(frame: WingsFrame): string | null {
  const first = frame.args[0];
  return typeof first === 'string' ? first : null;
}

/** Serialise an outbound Wings frame. */
export function wingsFrame(event: string, args: unknown[]): string {
  return JSON.stringify({ event, args });
}

/** The browser-style `Origin` Wings checks against the panel URL. */
export function panelOrigin(panelUrl: string): string {
  return new URL(panelUrl).origin;
}

/** Callbacks a {@link WingsSocketFactory} socket drives. */
export interface WingsSocketHandlers {
  onOpen(): void;
  onMessage(data: unknown): void;
  /** Fired once per socket, after an error or a close. */
  onClose(): void;
}

/** The minimal socket surface the console client uses. */
export interface WingsSocket {
  send(data: string): void;
  close(): void;
}

export type WingsSocketFactory = (
  url: string,
  origin: string,
  handlers: WingsSocketHandlers,
) => WingsSocket;

/**
 * undici's `WebSocket` accepts a non-standard `{ headers }` init (Node ≥22),
 * but the DOM-typed constructor only declares `protocols`. Construct it
 * reflectively and narrow the result instead of casting.
 */
function openUndiciSocket(url: string, origin: string): WebSocket {
  const init = { headers: { Origin: origin } };
  const ws: unknown = Reflect.construct(WebSocket, [url, init]);
  if (!(ws instanceof WebSocket)) throw new Error('WebSocket unavailable');
  return ws;
}

/**
 * Default factory: Node's global (undici) `WebSocket`. Its non-standard
 * `headers` init sets `Origin` explicitly — Wings refuses the upgrade
 * without it (spike Q2). No extra dependency needed.
 */
export const nodeWingsSocketFactory: WingsSocketFactory = (
  url,
  origin,
  handlers,
) => {
  const ws = openUndiciSocket(url, origin);
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    handlers.onClose();
  };
  ws.addEventListener('open', () => handlers.onOpen());
  ws.addEventListener('message', (e) => handlers.onMessage(e.data));
  ws.addEventListener('error', closeOnce);
  ws.addEventListener('close', closeOnce);
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
};
