import type { GamePresenceEvent } from '../pelican/presence/presence-events';

/**
 * Valheim console-line parser (ROK-1798 Q1 "Parser regexes", ROK-1800).
 * Pure: one line in, one typed event (or null) out. Regexes are unanchored
 * at the start — the on-disk log adds a `[Info   : Unity Log] ` prefix the
 * console stream lacks. Only vanilla lines match; mod chatter (e.g.
 * Seasonality's `Peer (…) disconnected`) never does. The raw line is never
 * returned or retained.
 */
const HANDSHAKE = /Got handshake from client (\d{17})\s*$/;
const WRONG_PASSWORD = /Peer (\d{17}) has wrong password/;
const CHARACTER = /Got character ZDOID from (.+?) : (-?\d+):(\d+)\s*$/;
const CLOSING_SOCKET = /Closing socket (\d{17})\s*$/;
/** Only the `ZDOS:` form is the peer count; dungeon gen prints a bare `Connections N`. */
const HEARTBEAT = /Connections (\d+) ZDOS:\d+/;
const SERVER_READY = /Game server connected/;
const SERVER_STOPPING = /OnApplicationQuit|ZNet Shutdown/;
const TIMESTAMP = /(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2}): /;

/** An event without its timestamp (distributes over the union). */
type EventBody<E = GamePresenceEvent> = E extends unknown
  ? Omit<E, 'loggedAt'>
  : never;

/** Parse one Valheim console line into a presence event, or null. */
export function parseValheimLine(line: string): GamePresenceEvent | null {
  const body = matchBody(line);
  if (!body) return null;
  const loggedAt = parseTimestamp(line);
  return loggedAt ? { ...body, loggedAt } : body;
}

function matchBody(line: string): EventBody | null {
  return (
    matchSteamEvent(line) ??
    matchCharacter(line) ??
    matchServerEvent(line)
  );
}

function matchSteamEvent(line: string): EventBody | null {
  const join = HANDSHAKE.exec(line)?.[1];
  if (join) return { kind: 'join', steamId: join };
  const failed = WRONG_PASSWORD.exec(line)?.[1];
  if (failed) return { kind: 'auth-failed', steamId: failed };
  const leave = CLOSING_SOCKET.exec(line)?.[1];
  if (leave) return { kind: 'leave', steamId: leave };
  return null;
}

function matchCharacter(line: string): EventBody | null {
  const m = CHARACTER.exec(line);
  const name = m?.[1]?.trim();
  if (!m || !name) return null;
  const zdoidZero = m[2] === '0' && m[3] === '0';
  return { kind: 'character', name, zdoidZero };
}

function matchServerEvent(line: string): EventBody | null {
  const count = HEARTBEAT.exec(line)?.[1];
  if (count !== undefined) return { kind: 'heartbeat', count: Number(count) };
  if (SERVER_READY.test(line)) return { kind: 'server-ready' };
  if (SERVER_STOPPING.test(line)) return { kind: 'server-stopping' };
  return null;
}

/** `MM/dd/yyyy HH:mm:ss: ` → `yyyy-MM-ddTHH:mm:ss` (zone-less, sortable). */
function parseTimestamp(line: string): string | undefined {
  const m = TIMESTAMP.exec(line);
  if (!m) return undefined;
  const [, month, day, year, hh, mm, ss] = m;
  return `${year}-${month}-${day}T${hh}:${mm}:${ss}`;
}
