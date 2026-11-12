import { Logger } from '@nestjs/common';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';

/** A compute superseded this many times in a row gives up (not stored). */
export const MAX_COMPUTE_ATTEMPTS = 3;
/** Background warms running at once, process-wide (the rest queue). */
export const MAX_CONCURRENT_WARMS = 2;

/** One uncached compute of a key. */
export type InsightsCompute = () => Promise<WowRosterInsightsDto>;

/** A finished compute; `current` false = every attempt was superseded. */
export interface ComputeOutcome {
  data: WowRosterInsightsDto;
  current: boolean;
}

/** What the coordinator needs from the cache that owns the entries. */
export interface FlightHooks {
  /** Write a fresh entry (only called for a non-superseded result). */
  store(key: string, data: WowRosterInsightsDto): void;
  /** True when the key already holds a live entry (a queued warm is moot). */
  isCached(key: string): boolean;
}

/**
 * ROK-2178 — per-key compute coordination for the roster-insights cache.
 * Every compute of a key (stale refresh, miss, warm) goes through `run`, so
 * at most one is in flight per key and later callers join it. A per-key
 * generation, bumped by invalidation, makes a compute that was overtaken
 * re-run instead of storing pre-invalidation data. Warms queue behind a
 * process-wide cap; a key queued twice keeps one slot (the latest compute),
 * and a queued key that a get or another compute already covers is skipped.
 */
export class InsightsFlights {
  private readonly generations = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<ComputeOutcome>>();
  private readonly queued = new Map<string, InsightsCompute>();
  private activeWarms = 0;
  private closed = false;
  private readonly logger = new Logger('RosterInsightsCache');

  constructor(private readonly hooks: FlightHooks) {}

  /** True while a compute of `key` is running. */
  isRunning(key: string): boolean {
    return this.inFlight.has(key);
  }

  /** Supersede every compute of the keys starting with `prefix`. */
  bumpPrefix(prefix: string): void {
    for (const [key, gen] of this.generations)
      if (key.startsWith(prefix)) this.generations.set(key, gen + 1);
  }

  /** Join the in-flight compute of `key`, or start one with `compute`. */
  run(key: string, compute: InsightsCompute): Promise<ComputeOutcome> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    if (!this.generations.has(key)) this.generations.set(key, 0);
    const flight = this.attempts(key, compute);
    this.inFlight.set(key, flight);
    return flight;
  }

  /** Stale-window refresh: fire and forget, failures logged. */
  refresh(key: string, compute: InsightsCompute): void {
    this.run(key, compute).catch((err: unknown) =>
      this.warn(`roster-insights refresh failed for ${key}`, err),
    );
  }

  /** Queue a background warm of `key` (no-op once closed or while running). */
  scheduleWarm(key: string, compute: InsightsCompute): void {
    if (this.closed || this.inFlight.has(key)) return;
    this.queued.set(key, compute);
    this.drain();
  }

  /** Stop warming and wait for every running compute to settle. */
  async close(): Promise<void> {
    this.closed = true;
    this.queued.clear();
    await Promise.allSettled([...this.inFlight.values()]);
  }

  /**
   * Run `compute` until a result lands under the generation it started in
   * (stored), or `MAX_COMPUTE_ATTEMPTS` ran (returned, not stored). The
   * in-flight marker is cleared in the same tick as the final check, so a
   * later invalidation always finds the key free.
   */
  private async attempts(
    key: string,
    compute: InsightsCompute,
  ): Promise<ComputeOutcome> {
    try {
      let gen = this.generation(key);
      let data = await compute();
      for (let n = 1; n < MAX_COMPUTE_ATTEMPTS; n++) {
        if (this.generation(key) === gen) break;
        gen = this.generation(key);
        data = await compute();
      }
      const current = this.generation(key) === gen;
      if (current) this.hooks.store(key, data);
      return { data, current };
    } finally {
      this.inFlight.delete(key);
    }
  }

  private generation(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  /** Start queued warms while under the cap; skip keys already covered. */
  private drain(): void {
    while (!this.closed && this.activeWarms < MAX_CONCURRENT_WARMS) {
      const next = this.queued.entries().next();
      if (next.done) return;
      const [key, compute] = next.value;
      this.queued.delete(key);
      if (this.inFlight.has(key) || this.hooks.isCached(key)) continue;
      this.startWarm(key, compute);
    }
  }

  private startWarm(key: string, compute: InsightsCompute): void {
    this.activeWarms++;
    void this.run(key, compute)
      .catch((err: unknown) =>
        this.warn(`roster-insights warm failed for ${key}`, err),
      )
      .finally(() => {
        this.activeWarms--;
        this.drain();
      });
  }

  /** Log a failed background compute, unless the module is shutting down. */
  private warn(prefix: string, err: unknown): void {
    if (this.closed) return;
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.warn(`${prefix}: ${msg}`);
  }
}
