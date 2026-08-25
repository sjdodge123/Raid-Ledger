/**
 * In-memory Redis mock for integration tests.
 *
 * Extracted from test-app.ts (ROK-1058) so the file stays under the
 * 300-line ESLint cap and so a future redis-mock unit test can target this
 * module directly. The mock implements only the subset of ioredis methods
 * the codebase touches (set with NX, setex, del, incr, expire, ttl, exists,
 * keys with `*` glob, ping, quit, disconnect, duplicate). The `store` Map
 * is exposed via the returned handle so `truncateAllTables` can purge
 * cross-suite keys (e.g. `jwt_block:*`) without round-tripping the client.
 *
 * ROK-1436: `set`/`setex`/`expire` now record an expiry so `ttl` reports
 * the real remaining seconds instead of a flat -1. The mock deliberately
 * does NOT evict on expiry — specs run in milliseconds and nothing waits
 * a key out, so lazy eviction would only add a clock-dependent flake
 * surface. `ttl` returns -2 for a missing key and -1 for one with no
 * expiry, matching Redis.
 */

/**
 * Parses ioredis-style trailing `EX <seconds>` / `PX <millis>` tokens into
 * an absolute expiry timestamp. Returns null when no expiry was requested.
 */
function parseExpiryArgs(args: (string | number)[]): number | null {
  for (let i = 0; i < args.length - 1; i++) {
    const token = args[i];
    if (typeof token !== 'string') continue;
    const unit = token.toUpperCase();
    if (unit !== 'EX' && unit !== 'PX') continue;
    const amount = Number(args[i + 1]);
    if (!Number.isFinite(amount)) continue;
    return Date.now() + (unit === 'EX' ? amount * 1000 : amount);
  }
  return null;
}

/** Redis mock set with NX + EX/PX support. */
function mockRedisSet(
  store: Map<string, string>,
  expiries: Map<string, number>,
) {
  return (key: string, value: string, ...args: (string | number)[]) => {
    const hasNX = args.some(
      (a) => typeof a === 'string' && a.toUpperCase() === 'NX',
    );
    if (hasNX && store.has(key)) return Promise.resolve(null);
    store.set(key, value);
    const expiresAt = parseExpiryArgs(args);
    // A plain SET clears any prior TTL, same as Redis.
    if (expiresAt === null) expiries.delete(key);
    else expiries.set(key, expiresAt);
    return Promise.resolve('OK');
  };
}

/** Remaining whole seconds, Redis-style: -2 = no key, -1 = no expiry. */
function mockRedisTtl(
  store: Map<string, string>,
  expiries: Map<string, number>,
) {
  return (key: string) => {
    if (!store.has(key)) return Promise.resolve(-2);
    const expiresAt = expiries.get(key);
    if (expiresAt === undefined) return Promise.resolve(-1);
    return Promise.resolve(
      Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
    );
  };
}

/** Redis mock glob-style key search. */
function mockRedisKeys(store: Map<string, string>) {
  return (pattern: string) => {
    if (pattern === '*') return Promise.resolve([...store.keys()]);
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return Promise.resolve([...store.keys()].filter((k) => re.test(k)));
  };
}

/** Redis mock del helper. */
function mockRedisDel(
  store: Map<string, string>,
  expiries: Map<string, number>,
) {
  return (...keys: string[]) => {
    let count = 0;
    for (const k of keys) {
      expiries.delete(k);
      if (store.delete(k)) count++;
    }
    return Promise.resolve(count);
  };
}

/** Redis mock incr helper. */
function mockRedisIncr(store: Map<string, string>) {
  return (key: string) => {
    const next = parseInt(store.get(key) ?? '0', 10) + 1;
    store.set(key, String(next));
    return Promise.resolve(next);
  };
}

export interface RedisMockHandle {
  client: ReturnType<typeof buildRedisMockClient>;
  store: Map<string, string>;
}

/** JSON-array-in-the-store list helpers (ROK-1397: cooptimus review queue). */
function readList(store: Map<string, string>, key: string): string[] {
  const raw = store.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function buildRedisMockClient(
  store: Map<string, string>,
  expiries: Map<string, number>,
) {
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    lpush: (key: string, ...values: string[]) => {
      const list = readList(store, key);
      list.unshift(...values.reverse());
      store.set(key, JSON.stringify(list));
      return Promise.resolve(list.length);
    },
    ltrim: (key: string, start: number, stop: number) => {
      const list = readList(store, key);
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      store.set(key, JSON.stringify(list.slice(start, end)));
      return Promise.resolve('OK');
    },
    lrange: (key: string, start: number, stop: number) => {
      const list = readList(store, key);
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return Promise.resolve(list.slice(start, end));
    },
    set: mockRedisSet(store, expiries),
    setex: (key: string, seconds: number, value: string) => {
      store.set(key, value);
      expiries.set(key, Date.now() + seconds * 1000);
      return Promise.resolve('OK');
    },
    del: mockRedisDel(store, expiries),
    incr: mockRedisIncr(store),
    expire: (key: string, seconds: number) => {
      if (!store.has(key)) return Promise.resolve(0);
      expiries.set(key, Date.now() + seconds * 1000);
      return Promise.resolve(1);
    },
    ttl: mockRedisTtl(store, expiries),
    exists: (...keys: string[]) =>
      Promise.resolve(keys.filter((k) => store.has(k)).length),
    keys: mockRedisKeys(store),
    ping: () => Promise.resolve('PONG'),
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
    status: 'ready',
    duplicate: () => buildRedisMockClient(store, expiries),
  };
}

/** In-memory Redis mock whose backing store is exposed for cross-suite reset. */
export function createRedisMock(): RedisMockHandle {
  const store = new Map<string, string>();
  const expiries = new Map<string, number>();
  return { client: buildRedisMockClient(store, expiries), store };
}
