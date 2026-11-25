import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { HUB_DB, type HubDb } from '../drizzle/drizzle.module';
import { hubMeta } from '../drizzle/schema';
import { withTimeout } from './with-timeout';

export type EpochReader = () => Promise<string | undefined>;

/**
 * L5 (ROK-1670): the catalogue epoch, cached after the first successful read
 * (it changes only on a deliberate reset, which restarts the hub). While it is
 * unknown (DB not reached yet) `current()` returns undefined, never throws.
 *
 * Single-flight: one read at a time, shared by every caller, and each caller
 * waits at most `timeoutMs` from when that read STARTED. A read that timed out
 * but has not settled (postgres.js holds it until `connect_timeout`) keeps
 * answering undefined at once, so a DB outage costs one `timeoutMs` wait per
 * read instead of one per request, and queries never stack up. After
 * `retryMs` a hung read is abandoned and the next call starts a fresh one.
 */
export class EpochCache {
  private cached: string | undefined;
  private inflight:
    | { readonly result: Promise<string | undefined>; readonly at: number }
    | undefined;

  constructor(
    private readonly read: EpochReader,
    private readonly timeoutMs = 1000,
    private readonly retryMs = 5000,
  ) {}

  current(): Promise<string | undefined> {
    if (this.cached !== undefined) return Promise.resolve(this.cached);
    const now = Date.now();
    if (!this.inflight || now - this.inflight.at >= this.retryMs) {
      this.inflight = { result: this.startRead(), at: now };
    }
    return this.inflight.result;
  }

  private startRead(): Promise<string | undefined> {
    const raw = new Promise<string | undefined>((resolve) => {
      resolve(this.read());
    });
    // Cache on the RAW read, so a value that lands after `timeoutMs` (the
    // caller already got undefined) is still kept for the next caller.
    const settled = raw.then((value) => {
      if (value !== undefined) this.cached = value;
      return value;
    });
    const result = withTimeout(settled, this.timeoutMs).catch(() => undefined);
    const clear = (): void => {
      if (this.inflight?.result === result) this.inflight = undefined;
    };
    settled.then(clear, clear);
    return result;
  }
}

export async function readCatalogEpoch(db: HubDb): Promise<string | undefined> {
  const rows = await db
    .select({ value: hubMeta.value })
    .from(hubMeta)
    .where(eq(hubMeta.key, 'catalog_epoch'))
    .limit(1);
  return rows[0]?.value;
}

@Injectable()
export class EpochService extends EpochCache {
  constructor(@Inject(HUB_DB) db: HubDb) {
    super(() => readCatalogEpoch(db));
  }
}
