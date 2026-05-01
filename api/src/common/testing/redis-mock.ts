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
 */

/** Redis mock set with NX support. */
function mockRedisSet(store: Map<string, string>) {
  return (key: string, value: string, ...args: (string | number)[]) => {
    const hasNX = args.some(
      (a) => typeof a === 'string' && a.toUpperCase() === 'NX',
    );
    if (hasNX && store.has(key)) return Promise.resolve(null);
    store.set(key, value);
    return Promise.resolve('OK');
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
function mockRedisDel(store: Map<string, string>) {
  return (...keys: string[]) => {
    let count = 0;
    for (const k of keys) {
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

function buildRedisMockClient(store: Map<string, string>) {
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: mockRedisSet(store),
    setex: (key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: mockRedisDel(store),
    incr: mockRedisIncr(store),
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(-1),
    exists: (...keys: string[]) =>
      Promise.resolve(keys.filter((k) => store.has(k)).length),
    keys: mockRedisKeys(store),
    ping: () => Promise.resolve('PONG'),
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
    status: 'ready',
    duplicate: () => buildRedisMockClient(store),
  };
}

/** In-memory Redis mock whose backing store is exposed for cross-suite reset. */
export function createRedisMock(): RedisMockHandle {
  const store = new Map<string, string>();
  return { client: buildRedisMockClient(store), store };
}
