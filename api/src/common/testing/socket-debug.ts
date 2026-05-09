/**
 * Socket-event instrumentation for the integration test HTTP server
 * (ROK-1249, AC1). Off by default; only attaches when
 * `RL_TEST_SOCKET_DEBUG=true` is set, so production CI is unaffected.
 *
 * Goal: name the request + elapsed time when the rotating-suite
 * `socket hang up` / ECONNRESET surfaces. Per-request timing is tracked
 * via WeakMap so we never mutate the socket object directly.
 */
import type { Server } from 'http';
import type { Socket } from 'net';

interface RequestMeta {
  method: string;
  url: string;
  startedAt: number;
}

function logSocketError(
  meta: RequestMeta | undefined,
  err: NodeJS.ErrnoException,
): void {
  const elapsed = meta ? Date.now() - meta.startedAt : -1;
  console.error(
    `[SOCKET] error ${new Date().toISOString()} ${meta?.method ?? '-'} ${meta?.url ?? '-'} elapsed=${elapsed}ms code=${err.code ?? '-'} msg=${err.message}`,
  );
}

function logSocketClose(meta: RequestMeta | undefined): void {
  const elapsed = meta ? Date.now() - meta.startedAt : -1;
  console.error(
    `[SOCKET] close hadError=true ${new Date().toISOString()} ${meta?.method ?? '-'} ${meta?.url ?? '-'} elapsed=${elapsed}ms`,
  );
}

export function instrumentHttpServer(server: Server): void {
  const reqStart = new WeakMap<Socket, RequestMeta>();
  let reqCount = 0;
  server.on('request', (req) => {
    reqStart.set(req.socket, {
      method: req.method ?? 'UNKNOWN',
      url: req.url ?? '',
      startedAt: Date.now(),
    });
    // First request per app boot logs once so smoke runs can confirm
    // the instrumentation is wired without spamming healthy traffic.
    if (reqCount === 0) {
      console.error(
        `[SOCKET] instrumented ${new Date().toISOString()} first request: ${req.method ?? 'UNKNOWN'} ${req.url ?? ''}`,
      );
    }
    reqCount += 1;
  });
  server.on('connection', (socket: Socket) => {
    socket.on('error', (err: NodeJS.ErrnoException) =>
      logSocketError(reqStart.get(socket), err),
    );
    socket.on('close', (hadError) => {
      if (hadError) logSocketClose(reqStart.get(socket));
    });
  });
  server.on('clientError', (err: NodeJS.ErrnoException) => {
    console.error(
      `[SOCKET] clientError ${new Date().toISOString()} code=${err.code ?? '-'} msg=${err.message}`,
    );
  });
}
