/**
 * ROK-1949 — in-memory LRU of masked base-map PNGs keyed by the mask
 * fingerprint (never the viewer id), byte-budgeted (default 64 MiB, env
 * `VALHEIM_MAP_MASK_CACHE_MB`), with in-flight dedup and a cap of 2
 * concurrent renders. A rejected render is never cached; an entry bigger
 * than ¼ of the budget is returned but not stored. At most 16 renders
 * queue behind the cap; past that a get rejects with 503 (retry later).
 */
import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface MaskCacheOptions {
  budgetBytes: number;
  concurrency: number;
  maxWaiters: number;
}

export const MASK_CACHE_OPTIONS = Symbol('MASK_CACHE_OPTIONS');

const MIB = 1024 * 1024;
const DEFAULT_BUDGET_MB = 64;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_WAITERS = 16;

function budgetFromEnv(): number {
  const mb = Number(process.env.VALHEIM_MAP_MASK_CACHE_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_BUDGET_MB) * MIB;
}

@Injectable()
export class ValheimMapMaskCache {
  private readonly budget: number;
  private readonly concurrency: number;
  private readonly maxWaiters: number;
  private readonly entries = new Map<string, Buffer>();
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private readonly waiters: (() => void)[] = [];
  private bytes = 0;
  private running = 0;

  constructor(
    @Optional() @Inject(MASK_CACHE_OPTIONS) opts?: Partial<MaskCacheOptions>,
  ) {
    this.budget = opts?.budgetBytes ?? budgetFromEnv();
    this.concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY);
    this.maxWaiters = Math.max(0, opts?.maxWaiters ?? DEFAULT_MAX_WAITERS);
  }

  /** Cached bytes for `key`, else `produce()` once (deduped, capped). */
  get(key: string, produce: () => Promise<Buffer>): Promise<Buffer> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return Promise.resolve(hit);
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const run = this.runCapped(produce)
      .then((buf) => {
        this.store(key, buf);
        return buf;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  /** Current entry count and stored bytes (for specs/metrics). */
  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
  }

  private store(key: string, buf: Buffer): void {
    if (buf.length > this.budget / 4) return;
    this.entries.set(key, buf);
    this.bytes += buf.length;
    for (const [oldKey, old] of this.entries) {
      if (this.bytes <= this.budget) break;
      this.entries.delete(oldKey);
      this.bytes -= old.length;
    }
  }

  private async runCapped(produce: () => Promise<Buffer>): Promise<Buffer> {
    while (this.running >= this.concurrency) {
      if (this.waiters.length >= this.maxWaiters) {
        throw new ServiceUnavailableException('base_map_render_busy');
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.running += 1;
    try {
      return await produce();
    } finally {
      this.running -= 1;
      this.waiters.shift()?.();
    }
  }
}
