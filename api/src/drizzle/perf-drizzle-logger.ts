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
 * `db.transaction()` runs on the reserved `sql` postgres-js hands to the
 * `begin()` callback (and nested ones on the `savepoint()` callback's `sql`),
 * not on the pool client — so those scoped clients are instrumented the same
 * way as they are created (ROK-2177). Only the callback's argument is touched;
 * its return value, errors and the commit/rollback flow are passed through.
 *
 * No-op (passes the client through unchanged) when DEBUG is not enabled,
 * to avoid any per-query overhead in production.
 */
export function withQueryPerfLogging(client: Sql): Sql {
  if (!isPerfEnabled()) return client;
  instrumentSql(client);
  return client;
}

type UnsafeOwner = { unsafe: UnsafeFn };

const instrumented = new WeakSet<object>();

function hasUnsafe(sql: object): sql is UnsafeOwner {
  return typeof Reflect.get(sql, 'unsafe') === 'function';
}

function instrumentSql(sql: object): void {
  if (instrumented.has(sql) || !hasUnsafe(sql)) return;
  instrumented.add(sql);
  patchUnsafe(sql);
  patchScopeOpener(sql, 'begin');
  patchScopeOpener(sql, 'savepoint');
}

function patchUnsafe(sql: UnsafeOwner): void {
  const originalUnsafe = sql.unsafe.bind(sql);
  sql.unsafe = ((
    query: Parameters<UnsafeFn>[0],
    parameters?: Parameters<UnsafeFn>[1],
    queryOptions?: Parameters<UnsafeFn>[2],
  ) =>
    wrapPending(
      originalUnsafe(query, parameters, queryOptions) as unknown as Thenable,
      query,
    )) as UnsafeFn;
}

/**
 * `begin(fn)` / `begin(options, fn)` / `savepoint(fn)` / `savepoint(name, fn)`:
 * instrument the scoped `sql` each callback receives. Argument count and order
 * are preserved (postgres-js branches on `arguments.length`).
 */
function patchScopeOpener(sql: object, method: 'begin' | 'savepoint'): void {
  const original: unknown = Reflect.get(sql, method);
  if (typeof original !== 'function') return;
  Reflect.set(sql, method, (...args: unknown[]): unknown => {
    const result: unknown = Reflect.apply(
      original,
      sql,
      args.map(wrapScopeCallback),
    );
    return result;
  });
}

function wrapScopeCallback(arg: unknown): unknown {
  if (typeof arg !== 'function') return arg;
  return (scoped: unknown): unknown => {
    if (
      typeof scoped === 'function' ||
      (typeof scoped === 'object' && scoped)
    ) {
      instrumentSql(scoped);
    }
    const result: unknown = Reflect.apply(arg, undefined, [scoped]);
    return result;
  };
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
