/**
 * Socket-event instrumentation for the integration test HTTP server
 * (ROK-1249, AC1+AC2). Off by default; only attaches when
 * `RL_TEST_SOCKET_DEBUG=true` is set, so production CI is unaffected.
 *
 * Goal: name the request + elapsed time when the rotating-suite
 * `socket hang up` / ECONNRESET surfaces. Per-request timing is tracked
 * via WeakMap so we never mutate the socket object directly. Also exports
 * `wrapAgentForSnapshot` which captures a failure snapshot when supertest
 * rejects with `socket hang up` / ECONNRESET — Jest catches those before
 * they reach `process.on('uncaughtException')`, so the global handler in
 * `integration-setup.ts` does not see them.
 */
import type { Server } from 'http';
import type { Socket } from 'net';
import type * as supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { dumpFailureSnapshot } from './dump-failure-snapshot';

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

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'head',
  'options',
] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isFlakeError(err: unknown): boolean {
  const e = err as { message?: string; code?: string };
  const msg = String(e?.message ?? err);
  const code = String(e?.code ?? '');
  // Original ROK-1249/1250 trigger class: canonical socket-level RST.
  if (msg.includes('socket hang up') || msg.includes('ECONNRESET')) {
    return true;
  }
  // ROK-1264: HTTP-parser-level errors fire when a client reads non-HTTP
  // bytes from what should be a fresh response. Same root-cause class as
  // socket-RST (stale socket reuse from keep-alive pool, or half-closed
  // peer state) but surfaces with a different error code. Node's llhttp
  // uses the HPE_* prefix for all parser errors; the most common message
  // form is "Parse Error: Expected HTTP/, RTSP/ or ICE/".
  if (msg.includes('Parse Error') || code.startsWith('HPE_')) {
    return true;
  }
  return false;
}

function wrapMethod(
  agent: TestAgent<supertest.Test>,
  method: HttpMethod,
): (...args: unknown[]) => supertest.Test {
  const original = (
    agent as unknown as Record<string, (...args: unknown[]) => supertest.Test>
  )[method].bind(agent);
  return (...args: unknown[]) => {
    const test = original(...args);
    const firstArg = args[0];
    const url = typeof firstArg === 'string' ? firstArg : '';
    const startedAt = Date.now();
    const originalThen = test.then.bind(test);
    test.then = ((onFulfilled: unknown, onRejected: unknown) => {
      const wrappedRejected = async (err: unknown) => {
        if (isFlakeError(err)) {
          try {
            const file = await dumpFailureSnapshot(
              String((err as { message?: string })?.message ?? err),
              {
                method: method.toUpperCase(),
                url,
                elapsedMs: Date.now() - startedAt,
              },
            );
            console.error(`[SOCKET] snapshot written: ${file}`);
          } catch {
            // Snapshotter must never amplify the flake.
          }
        }
        if (typeof onRejected === 'function') {
          return (onRejected as (e: unknown) => unknown)(err);
        }
        throw err;
      };
      return originalThen(
        onFulfilled as Parameters<typeof originalThen>[0],
        wrappedRejected,
      );
    }) as typeof test.then;
    return test;
  };
}

export function wrapAgentForSnapshot(
  agent: TestAgent<supertest.Test>,
): TestAgent<supertest.Test> {
  for (const method of HTTP_METHODS) {
    (agent as unknown as Record<string, unknown>)[method] = wrapMethod(
      agent,
      method,
    );
  }
  return agent;
}
