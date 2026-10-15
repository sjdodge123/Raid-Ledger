import type { GameLogParser } from '../../plugin-host/extension-points';
import type { ConsoleCredentialsSource } from '../pelican-console-socket';
import type {
  WingsSocketFactory,
  WingsSocketHandlers,
} from '../pelican-console-socket.helpers';
import type { GamePresenceEvent } from './presence-events';
import type { ServerPresencePlayer } from './server-presence.sink';

/** Spec-only fakes for the presence supervisor/session (ROK-1800 L5). */
export const SECRET = 'hunter2-SECRET';

export function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`missing ${label}`);
  return value;
}

/** Each spec line is a key for one event; anything else is noise. Throws on `boom`. */
const EVENTS = new Map<string, GamePresenceEvent>();

export const fakeParser: GameLogParser = {
  pluginSlug: 'valheim',
  parse(raw: string): GamePresenceEvent | null {
    if (raw.startsWith('boom')) throw new Error(`cannot parse ${raw}`);
    return EVENTS.get(raw) ?? null;
  },
};

export function line(event: GamePresenceEvent): string {
  const key = JSON.stringify(event);
  EVENTS.set(key, event);
  return key;
}

/** Handshake + character line for one player at `loggedAt`. */
export function arrive(
  steamId: string,
  name: string,
  loggedAt: string,
): string[] {
  return [
    line({ kind: 'join', steamId, loggedAt }),
    line({ kind: 'character', name, zdoidZero: false, loggedAt }),
  ];
}

export function fakeSink(open: ServerPresencePlayer[] = []) {
  const ok = () => Promise.resolve();
  return {
    playerJoined: jest.fn(ok),
    playerRenamed: jest.fn(ok),
    playerLeft: jest.fn(ok),
    serverEmptied: jest.fn(ok),
    openPresence: jest.fn(() => Promise.resolve(open)),
  };
}

export function fakeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/** A Wings socket factory whose sockets the spec drives by hand. */
export function fakeWings() {
  const sockets: Array<{ handlers: WingsSocketHandlers; close: jest.Mock }> =
    [];
  const factory: WingsSocketFactory = (_url, _origin, handlers) => {
    const close = jest.fn();
    sockets.push({ handlers, close });
    return { send: jest.fn(), close };
  };
  const current = () => must(sockets[sockets.length - 1], 'socket').handlers;
  const frame = (event: string, ...args: unknown[]) =>
    current().onMessage(JSON.stringify({ event, args }));
  return {
    factory,
    sockets,
    frame,
    /** Open + `auth success` on the newest socket. */
    authenticate: () => {
      current().onOpen();
      frame('auth success');
    },
    lines: (ls: string[]) => ls.forEach((l) => frame('console output', l)),
  };
}

export const okCredentials: ConsoleCredentialsSource = () =>
  Promise.resolve({
    ok: true,
    data: { token: 'tok', socket: 'wss://node.test/api/servers/x/ws' },
  });
