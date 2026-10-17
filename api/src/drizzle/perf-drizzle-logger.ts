import type { Sql } from 'postgres';
import { isPerfEnabled, perfLog } from '../common/perf-logger';

type Thenable = {
  then: (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => unknown;
};

type UnsafeFn = Sql['unsafe'];

/**
 * Wrap a postgres-js `Sql` client so every `unsafe(query, params)` call
 * is timed and emits a `[PERF] DB | query | <ms>ms` line on resolution
 * (ROK-1199; replaces the prior Drizzle Logger approach which couldn't
 * observe execution duration — Drizzle's `Logger.logQuery` fires before
 * execution and never carries a duration).
 *
 * Drizzle's postgres-js session uses `client.unsafe(query, params)` and
 * either awaits it directly or chains `.values()`. Both paths return a
 * thenable; we wrap the `then` so duration is captured on the actual
 * settle of the query, regardless of which chained form Drizzle picks.
 *
 * No-op (passes the client through unchanged) when DEBUG is not enabled,
 * to avoid any per-query overhead in production.
 */
export function withQueryPerfLogging(client: Sql): Sql {
  if (!isPerfEnabled()) return client;

  const originalUnsafe = client.unsafe.bind(client);

  const timedUnsafe = ((
    query: Parameters<UnsafeFn>[0],
    parameters?: Parameters<UnsafeFn>[1],
    queryOptions?: Parameters<UnsafeFn>[2],
  ) =>
    wrapPending(
      originalUnsafe(query, parameters, queryOptions) as unknown as Thenable,
      query,
    )) as UnsafeFn;

  (client as { unsafe: UnsafeFn }).unsafe = timedUnsafe;

  return client;
}

/**
 * Wrap a postgres-js PendingQuery (or chained PendingValuesQuery / PendingRawQuery)
 * so that resolving/rejecting emits a perf log with the actual duration.
 *
 * Uses a Proxy so chained methods (`.values()`, `.raw()`, `.describe()`) are
 * themselves wrapped — the timer starts on the original `unsafe()` call and
 * fires whenever the chosen terminal thenable settles.
 */
function wrapPending<T extends Thenable>(pending: T, query: string): T {
  const start = performance.now();
  let logged = false;
  const log = (status: 'ok' | 'err'): void => {
    if (logged) return;
    logged = true;
    perfLog('DB', 'query', performance.now() - start, {
      status,
      table: extractTable(query),
      query: query.length > 200 ? query.slice(0, 200) + '...' : query,
    });
  };
  return new Proxy(pending, {
    get: (target, prop, receiver) =>
      proxyGet(target, prop, receiver, query, log),
  });
}

const CHAINED_METHODS = new Set(['values', 'raw', 'describe']);

function proxyGet(
  target: Thenable,
  prop: string | symbol,
  receiver: unknown,
  query: string,
  log: (status: 'ok' | 'err') => void,
): unknown {
  const value = Reflect.get(target, prop, receiver) as unknown;
  if (prop === 'then' && typeof value === 'function') {
    return wrapThen(target, value as Thenable['then'], log);
  }
  if (
    typeof prop === 'string' &&
    CHAINED_METHODS.has(prop) &&
    typeof value === 'function'
  ) {
    const fn = value as (...args: unknown[]) => Thenable;
    return (...args: unknown[]) => wrapPending(fn.apply(target, args), query);
  }
  return typeof value === 'function'
    ? (value as (...args: unknown[]) => unknown).bind(target)
    : value;
}

function wrapThen(
  target: Thenable,
  originalThen: Thenable['then'],
  log: (status: 'ok' | 'err') => void,
) {
  return (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) =>
    originalThen.call(
      target,
      (v: unknown) => {
        log('ok');
        return onFulfilled ? onFulfilled(v) : v;
      },
      (e: unknown) => {
        log('err');
        if (onRejected) return onRejected(e);
        throw e;
      },
    );
}

function extractTable(query: string): string {
  const match = /(?:from|into|update|join)\s+"?(\w+)"?/i.exec(query);
  return match?.[1] ?? 'unknown';
}
