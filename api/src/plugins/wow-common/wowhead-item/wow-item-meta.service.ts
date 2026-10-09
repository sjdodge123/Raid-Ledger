import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { asc, inArray, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { wowItemMeta } from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import {
  defaultResolverDeps,
  resolveItem,
  WOWHEAD_RESOLVER_DEPS,
  WowheadResolverDisabledError,
  type WowheadResolverDeps,
} from './wow-item-meta.resolve';
import type { WowItemMetaInsert, WowItemMetaRow } from './wowhead-item.types';
import { isWowheadResolverEnabled } from './wowhead-resolver.settings';

/** Max rows one `retryDue()` run re-probes (≤2 req each at ≤1 req/s). */
export const WOWHEAD_RETRY_BATCH = 500;

/** Valid, de-duplicated item ids. */
function uniqueIds(ids: readonly number[]): number[] {
  return [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * ROK-1727: Wowhead item metadata cache for WoW: Forever addon gear.
 * `getMeta` only reads; `enqueue` / `retryDue` resolve through the shared
 * ≤1 req/s limiter. Both resolving entry points no-op when the kill switch
 * is off — cached rows keep rendering. Callers fire-and-forget them.
 */
@Injectable()
export class WowItemMetaService {
  private readonly logger = new Logger(WowItemMetaService.name);
  private readonly inFlight = new Set<number>();
  private readonly deps: WowheadResolverDeps;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    @Optional()
    @Inject(WOWHEAD_RESOLVER_DEPS)
    deps?: Partial<WowheadResolverDeps>,
  ) {
    this.deps = {
      ...defaultResolverDeps(),
      isEnabled: () => this.isEnabled(),
      ...deps,
    };
  }

  /** Cached rows for `ids` (one select), keyed by item id. */
  async getMeta(ids: readonly number[]): Promise<Map<number, WowItemMetaRow>> {
    const unique = uniqueIds(ids);
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(wowItemMeta)
      .where(inArray(wowItemMeta.itemId, unique));
    return new Map(rows.map((r) => [r.itemId, r]));
  }

  /** Whether the resolver may call Wowhead (kill switch; unset ⇒ on). */
  isEnabled(): Promise<boolean> {
    return isWowheadResolverEnabled(this.settings);
  }

  /**
   * Resolve every id with no row or a due `next_retry_at`.
   * @returns how many rows were written.
   */
  async enqueue(ids: readonly number[]): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const meta = await this.getMeta(ids);
    const now = this.deps.now().getTime();
    const due = uniqueIds(ids).filter((id) => {
      const row = meta.get(id);
      return (
        !row || (row.nextRetryAt !== null && row.nextRetryAt.getTime() <= now)
      );
    });
    return this.resolveAll(due, meta);
  }

  /** Cron: re-probe rows whose `next_retry_at` has passed, oldest first. */
  async retryDue(): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const rows = await this.db
      .select()
      .from(wowItemMeta)
      .where(lte(wowItemMeta.nextRetryAt, this.deps.now()))
      .orderBy(asc(wowItemMeta.nextRetryAt))
      .limit(WOWHEAD_RETRY_BATCH);
    const meta = new Map(rows.map((r) => [r.itemId, r]));
    return this.resolveAll([...meta.keys()], meta);
  }

  private async resolveAll(
    ids: number[],
    meta: Map<number, WowItemMetaRow>,
  ): Promise<number> {
    const fresh = ids.filter((id) => !this.inFlight.has(id));
    fresh.forEach((id) => this.inFlight.add(id));
    const results = await Promise.all(
      fresh.map((id) => this.resolveOne(id, meta.get(id)?.attempts ?? 0)),
    );
    const stopped = results.filter((r) => r === 'disabled').length;
    if (stopped > 0) {
      this.logger.log(
        `Wowhead resolver switched off mid-run; ${stopped} item(s) left untouched`,
      );
    }
    return results.filter((r) => r === 'written').length;
  }

  /** `disabled` = the kill switch flipped off before this item's fetch. */
  private async resolveOne(
    id: number,
    attempts: number,
  ): Promise<'written' | 'failed' | 'disabled'> {
    try {
      await this.upsert(await resolveItem(id, attempts, this.deps));
      return 'written';
    } catch (err: unknown) {
      if (err instanceof WowheadResolverDisabledError) return 'disabled';
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Wowhead item ${id} not stored: ${msg}`);
      return 'failed';
    } finally {
      this.inFlight.delete(id);
    }
  }

  /**
   * Insert or update. An `error` outcome on an existing row only bumps the
   * retry bookkeeping — a transient failure never erases a resolved name.
   */
  private async upsert(row: WowItemMetaInsert): Promise<void> {
    const retry = {
      fetchedAt: row.fetchedAt,
      nextRetryAt: row.nextRetryAt,
      attempts: row.attempts,
    };
    const { status, env, name, quality, icon } = row;
    const set =
      status === 'error'
        ? retry
        : { ...retry, status, env, name, quality, icon };
    await this.db
      .insert(wowItemMeta)
      .values(row)
      .onConflictDoUpdate({ target: wowItemMeta.itemId, set });
  }
}
