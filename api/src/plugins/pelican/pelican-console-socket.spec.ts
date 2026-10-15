import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import type { PelicanResult } from './pelican-client';
import type { PelicanWebsocketCredentials } from './pelican-api.schemas';
import {
  PelicanConsoleSocket,
  type PelicanConsoleSocketOptions,
} from './pelican-console-socket';
import {
  CONSOLE_LIVENESS_MS,
  consoleBackoffMs,
  nodeWingsSocketFactory,
  type WingsSocketHandlers,
} from './pelican-console-socket.helpers';

const SECRET = '-password "hunter2-SECRET"';
const PANEL = 'https://panel.example.test/panel/';
const WSS = 'wss://node.example.test/api/servers/u/ws';

interface FakeSocket {
  url: string;
  origin: string;
  handlers: WingsSocketHandlers;
  sent: unknown[];
  closed: boolean;
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const ok = (token: string): PelicanResult<PelicanWebsocketCredentials> => ({
  ok: true,
  data: { token, socket: WSS },
});

/** Let resolved promises (credential fetches) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function setup(over: Partial<PelicanConsoleSocketOptions> = {}) {
  const sockets: FakeSocket[] = [];
  let n = 0;
  const getCredentials = jest.fn(() => Promise.resolve(ok(`token-${++n}`)));
  const onLine = jest.fn<void, [string]>();
  const onStatus = jest.fn<void, [string]>();
  const onUnreachable = jest.fn<void, [number]>();
  const onReachable = jest.fn<void, []>();
  const conn = new PelicanConsoleSocket({
    serverIdentifier: 'abc123',
    panelUrl: PANEL,
    getCredentials,
    onLine,
    onStatus,
    onUnreachable,
    onReachable,
    random: () => 0.5, // jitter factor exactly 1.0
    now: () => 1_000_000,
    socketFactory: (url, origin, handlers) => {
      const s: FakeSocket = { url, origin, handlers, sent: [], closed: false };
      sockets.push(s);
      return {
        send: (d) => {
          const parsed: unknown = JSON.parse(d);
          s.sent.push(parsed);
        },
        close: () => {
          s.closed = true;
        },
      };
    },
    ...over,
  });
  const socket = (i: number) => must(sockets[i], `socket ${i}`);
  const frame = (i: number, event: string, args: unknown[] = []) =>
    socket(i).handlers.onMessage(JSON.stringify({ event, args }));
  return {
    conn,
    sockets,
    socket,
    frame,
    getCredentials,
    onLine,
    onStatus,
    onUnreachable,
    onReachable,
  };
}

async function connected(t: ReturnType<typeof setup>, i = 0): Promise<void> {
  await flush();
  t.socket(i).handlers.onOpen();
  t.frame(i, 'auth success');
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PelicanConsoleSocket handshake', () => {
  it('connects with the panel Origin, sends auth, then send logs on auth success', async () => {
    const t = setup();
    t.conn.start();
    await flush();
    expect(t.getCredentials).toHaveBeenCalledWith('abc123');
    expect(t.socket(0).url).toBe(WSS);
    expect(t.socket(0).origin).toBe('https://panel.example.test');
    t.socket(0).handlers.onOpen();
    expect(t.socket(0).sent).toEqual([{ event: 'auth', args: ['token-1'] }]);
    t.frame(0, 'auth success');
    expect(t.socket(0).sent).toEqual([
      { event: 'auth', args: ['token-1'] },
      { event: 'send logs', args: [null] },
    ]);
    expect(t.onReachable).toHaveBeenCalledTimes(1);
  });

  it('delivers console lines in order and status pushes; ignores junk frames', async () => {
    const t = setup();
    t.conn.start();
    await connected(t);
    t.frame(0, 'console output', ['line one']);
    t.socket(0).handlers.onMessage('not json');
    t.frame(0, 'console output', [42]);
    t.frame(0, 'stats', ['{}']);
    t.frame(0, 'console output', ['line two']);
    t.frame(0, 'status', ['running']);
    expect(t.onLine.mock.calls).toEqual([['line one'], ['line two']]);
    expect(t.onStatus.mock.calls).toEqual([['running']]);
  });

  it('re-auths on token expiring with a fresh token on the SAME socket', async () => {
    const t = setup();
    t.conn.start();
    await connected(t);
    t.frame(0, 'token expiring');
    await flush();
    expect(t.sockets).toHaveLength(1);
    expect(t.socket(0).closed).toBe(false);
    expect(t.socket(0).sent.at(-1)).toEqual({
      event: 'auth',
      args: ['token-2'],
    });
  });
});

describe('PelicanConsoleSocket reconnect', () => {
  it('backs off 1s, 2s, 4s … capped at 60s while the socket keeps closing', async () => {
    const t = setup();
    t.conn.start();
    await flush();
    const delays = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000];
    for (const [i, delay] of delays.entries()) {
      t.socket(i).handlers.onClose();
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect({ attempt: i, sockets: t.sockets.length }).toEqual({
        attempt: i,
        sockets: i + 1,
      });
      await jest.advanceTimersByTimeAsync(1);
      expect({ attempt: i, sockets: t.sockets.length }).toEqual({
        attempt: i,
        sockets: i + 2,
      });
    }
    expect(t.getCredentials).toHaveBeenCalledTimes(delays.length + 1);
    expect(new Set(t.onUnreachable.mock.calls.map((c) => c[0]))).toEqual(
      new Set([1_000_000]),
    );
  });

  it('resets the backoff after auth success', async () => {
    const t = setup();
    t.conn.start();
    await flush();
    t.socket(0).handlers.onClose();
    await jest.advanceTimersByTimeAsync(1000);
    t.socket(1).handlers.onClose();
    await jest.advanceTimersByTimeAsync(2000);
    await connected(t, 2);
    t.socket(2).handlers.onClose();
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.sockets).toHaveLength(4);
  });

  it.each(['token expired', 'jwt error'])(
    'reconnects on %s with a fresh token',
    async (event) => {
      const t = setup();
      t.conn.start();
      await connected(t);
      t.frame(0, event);
      expect(t.socket(0).closed).toBe(true);
      await jest.advanceTimersByTimeAsync(1000);
      t.socket(1).handlers.onOpen();
      expect(t.socket(1).sent).toEqual([{ event: 'auth', args: ['token-2'] }]);
    },
  );

  it('retries a failed credential fetch with backoff and reports unreachable', async () => {
    const t = setup();
    t.getCredentials.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'timeout' },
    });
    t.conn.start();
    await flush();
    expect(t.sockets).toHaveLength(0);
    expect(t.onUnreachable).toHaveBeenCalledWith(1_000_000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.sockets).toHaveLength(1);
  });

  it('ignores frames and closes from a superseded socket', async () => {
    const t = setup();
    t.conn.start();
    await connected(t);
    t.frame(0, 'token expired');
    await jest.advanceTimersByTimeAsync(1000);
    t.frame(0, 'console output', ['stale']);
    t.socket(0).handlers.onClose();
    expect(t.onLine).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('PelicanConsoleSocket liveness watchdog (review m8)', () => {
  it('reconnects a socket that goes silent past the liveness window', async () => {
    const t = setup();
    t.conn.start();
    await connected(t);
    await jest.advanceTimersByTimeAsync(CONSOLE_LIVENESS_MS - 1);
    t.frame(0, 'stats'); // any frame proves the socket is alive
    await jest.advanceTimersByTimeAsync(CONSOLE_LIVENESS_MS - 1);
    expect(t.socket(0).closed).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.socket(0).closed).toBe(true);
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.sockets).toHaveLength(2);
  });
});

describe('PelicanConsoleSocket stop()', () => {
  it('cancels a pending reconnect timer and closes nothing new', async () => {
    const t = setup();
    t.conn.start();
    await flush();
    t.socket(0).handlers.onClose();
    expect(jest.getTimerCount()).toBe(1);
    t.conn.stop();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(t.sockets).toHaveLength(1);
  });

  it('closes the live socket and drops an in-flight re-auth', async () => {
    const t = setup();
    t.conn.start();
    await connected(t);
    t.frame(0, 'token expiring');
    t.conn.stop();
    await flush();
    expect(t.socket(0).closed).toBe(true);
    expect(t.socket(0).sent).toEqual([
      { event: 'auth', args: ['token-1'] },
      { event: 'send logs', args: [null] },
    ]);
    expect(t.conn.isRunning).toBe(false);
  });

  it('never opens a socket when stopped during the credential fetch', async () => {
    const t = setup();
    t.conn.start();
    t.conn.stop();
    await flush();
    expect(t.sockets).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('PelicanConsoleSocket never logs a raw line', () => {
  it('keeps console content out of every log call', async () => {
    const methods = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
    const spies = methods.map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(() => {}),
    );
    const t = setup({
      onLine: () => {
        throw new Error(`parser choked on ${SECRET}`);
      },
    });
    t.getCredentials.mockResolvedValueOnce(ok('token-0'));
    t.conn.start();
    await connected(t);
    t.frame(0, 'console output', [SECRET]);
    t.socket(0).handlers.onMessage(
      `{"event":"console output","args":["${SECRET}"`,
    );
    t.getCredentials.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'http', status: 500 },
    });
    t.frame(0, 'token expiring');
    await flush();
    t.socket(0).handlers.onClose();
    const logged = spies
      .flatMap((s) => s.mock.calls)
      .map((c) => JSON.stringify(c));
    expect(logged.length).toBeGreaterThan(2);
    expect(logged.filter((l) => l.includes('hunter2'))).toEqual([]);
  });
});

describe('consoleBackoffMs', () => {
  it('applies ±20% jitter and the 60s cap', () => {
    expect(consoleBackoffMs(0, 0)).toBe(800);
    expect(consoleBackoffMs(0, 0.5)).toBe(1000);
    expect(consoleBackoffMs(3, 0.5)).toBe(8000);
    expect(consoleBackoffMs(5, 0.9999)).toBe(38399);
    expect(consoleBackoffMs(6, 0.9999)).toBe(60000);
    expect(consoleBackoffMs(500, 0)).toBe(48000);
  });
});

describe('nodeWingsSocketFactory (real local upgrade, no Wings)', () => {
  it('sends the Origin header Wings checks', async () => {
    jest.useRealTimers();
    const server = createServer();
    const seen = new Promise<string | undefined>((resolve) => {
      server.on('upgrade', (req, sock) => {
        resolve(req.headers.origin);
        sock.destroy();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const { port } = addr;
    const closed = new Promise<void>((resolve) => {
      nodeWingsSocketFactory(
        `ws://127.0.0.1:${port}/ws`,
        'https://panel.example.test',
        {
          onOpen: () => {},
          onMessage: () => {},
          onClose: resolve,
        },
      );
    });
    try {
      expect(await seen).toBe('https://panel.example.test');
      await closed;
    } finally {
      server.close();
    }
  });
});
