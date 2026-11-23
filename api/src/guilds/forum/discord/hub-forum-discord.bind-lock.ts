import { Injectable } from '@nestjs/common';

/**
 * ROK-2208 Codex P2 — runs async tasks one at a time per key, in arrival
 * order. `bind()` keys it on the Discord guild so two hubs choosing the
 * shared `#event-planning` at once cannot both miss it and create two.
 *
 * In-process on purpose: the API runs as ONE process (the allinone image),
 * and the critical section spans Discord API calls, so a Postgres advisory
 * lock would pin a pooled connection (session lock) or hold a transaction
 * open across network calls (xact lock) for no extra safety.
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

/**
 * ROK-2258 Codex P2 #2 — the ONE per-Discord-guild bind lock, shared by the
 * bind/unbind service and the decor backfill so their `setAvailableTags`
 * writes never interleave (each rewrites the whole tag list).
 */
@Injectable()
export class HubForumBindLock extends KeyedSerializer {}
