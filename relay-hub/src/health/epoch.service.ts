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
 */
export class EpochCache {
  private cached: string | undefined;

  constructor(
    private readonly read: EpochReader,
    private readonly timeoutMs = 1000,
  ) {}

  async current(): Promise<string | undefined> {
    if (this.cached !== undefined) return this.cached;
    try {
      this.cached = await withTimeout(this.read(), this.timeoutMs);
    } catch {
      return undefined;
    }
    return this.cached;
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
