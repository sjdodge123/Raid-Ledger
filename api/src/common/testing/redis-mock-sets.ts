/**
 * ROK-2260 — the Redis SET commands for the in-memory integration mock
 * (`sadd`, `srem`, `smembers`, `pexpireat`). Members live as a JSON array in
 * the shared `store`, like the list helpers in `redis-mock.ts`, so
 * `truncateAllTables` purges them the same way. Kept in its own module so
 * `redis-mock.ts` stays under the 300-line lint cap.
 */

function readSet(store: Map<string, string>, key: string): Set<string> {
  const raw = store.get(key);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(
  store: Map<string, string>,
  expiries: Map<string, number>,
  key: string,
  members: Set<string>,
): void {
  if (members.size > 0) {
    store.set(key, JSON.stringify([...members]));
    return;
  }
  // Redis deletes a set when its last member goes.
  store.delete(key);
  expiries.delete(key);
}

/** SADD / SREM / SMEMBERS / PEXPIREAT over the mock's backing store. */
export function mockRedisSets(
  store: Map<string, string>,
  expiries: Map<string, number>,
) {
  return {
    sadd: (key: string, ...members: string[]): Promise<number> => {
      const set = readSet(store, key);
      const before = set.size;
      for (const m of members) set.add(m);
      writeSet(store, expiries, key, set);
      return Promise.resolve(set.size - before);
    },
    srem: (key: string, ...members: string[]): Promise<number> => {
      const set = readSet(store, key);
      const before = set.size;
      for (const m of members) set.delete(m);
      writeSet(store, expiries, key, set);
      return Promise.resolve(before - set.size);
    },
    smembers: (key: string): Promise<string[]> =>
      Promise.resolve([...readSet(store, key)]),
    pexpireat: (key: string, atMs: number): Promise<number> => {
      if (!store.has(key)) return Promise.resolve(0);
      expiries.set(key, atMs);
      return Promise.resolve(1);
    },
  };
}
