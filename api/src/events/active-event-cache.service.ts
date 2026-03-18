import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { and, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';

/** Lookback window: include events that ended up to 2h ago. */
const LOOKBACK_MS = 2 * 60 * 60 * 1000;
/** Lookahead window: include events starting within the next 24h. */
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

/** Minimal cached event shape — only the fields cron jobs need. */
export interface CachedEvent {
  id: number;
  startTime: Date;
  effectiveEndTime: Date;
  cancelledAt: Date | null;
  isAdHoc: boolean;
}

/**
 * In-memory cache of "interesting" events (recently ended, active, upcoming).
 * Cron jobs check this cache first to avoid no-op DB queries.
 *
 * Refreshes on bootstrap, every 5 minutes (safety net), and on event
 * lifecycle events (created/updated/cancelled/deleted).
 */
@Injectable()
export class ActiveEventCacheService implements OnModuleInit {
  private readonly logger = new Logger(ActiveEventCacheService.name);
  private cache = new Map<number, CachedEvent>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** Safety-net refresh every 5 minutes. */
  @Cron('0 */5 * * * *', { name: 'ActiveEventCacheService_refresh' })
  async handleRefresh(): Promise<void> {
    await this.refresh();
  }

  // ─── Query methods ──────────────────────────────────────

  /** Events currently in progress (startTime <= now < effectiveEndTime). */
  getActiveEvents(now: Date): CachedEvent[] {
    const t = now.getTime();
    return [...this.cache.values()].filter(
      (e) =>
        !e.cancelledAt &&
        e.startTime.getTime() <= t &&
        e.effectiveEndTime.getTime() > t,
    );
  }

  /** Events starting within the next `windowMs` milliseconds. */
  getUpcomingEvents(now: Date, windowMs: number): CachedEvent[] {
    const t = now.getTime();
    const cutoff = t + windowMs;
    return [...this.cache.values()].filter(
      (e) =>
        !e.cancelledAt &&
        e.startTime.getTime() > t &&
        e.startTime.getTime() <= cutoff,
    );
  }

  /** Events that ended within the last `lookbackMs` milliseconds. */
  getRecentlyEndedEvents(now: Date, lookbackMs: number): CachedEvent[] {
    const t = now.getTime();
    const earliest = t - lookbackMs;
    return [...this.cache.values()].filter(
      (e) =>
        !e.cancelledAt &&
        e.effectiveEndTime.getTime() <= t &&
        e.effectiveEndTime.getTime() >= earliest,
    );
  }

  /**
   * Check if any non-cancelled events exist in the window
   * from `now - lookbackMs` to `now + lookaheadMs`.
   */
  hasRelevantEvents(
    now: Date,
    lookbackMs: number,
    lookaheadMs: number,
  ): boolean {
    const t = now.getTime();
    const earliest = t - lookbackMs;
    const latest = t + lookaheadMs;
    for (const e of this.cache.values()) {
      if (e.cancelledAt) continue;
      if (
        e.startTime.getTime() <= latest &&
        e.effectiveEndTime.getTime() >= earliest
      ) {
        return true;
      }
    }
    return false;
  }

  /** Invalidate a single event (e.g. after extendedUntil update). */
  invalidate(eventId: number): void {
    this.cache.delete(eventId);
  }

  // ─── Event listeners ───────────────────────────────────

  @OnEvent(APP_EVENT_EVENTS.CREATED)
  handleCreated(): void {
    this.refresh().catch((e) =>
      this.logger.error(`Cache refresh on CREATED failed: ${e}`),
    );
  }

  @OnEvent(APP_EVENT_EVENTS.UPDATED)
  handleUpdated(): void {
    this.refresh().catch((e) =>
      this.logger.error(`Cache refresh on UPDATED failed: ${e}`),
    );
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED)
  handleCancelled(): void {
    this.refresh().catch((e) =>
      this.logger.error(`Cache refresh on CANCELLED failed: ${e}`),
    );
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED)
  handleDeleted(payload: { eventId: number }): void {
    this.cache.delete(payload.eventId);
  }

  // ─── Internals ─────────────────────────────────────────

  /** Full refresh from DB. */
  async refresh(): Promise<void> {
    const events = await this.fetchActiveWindow();
    const next = new Map<number, CachedEvent>();
    for (const e of events) {
      next.set(e.id, e);
    }
    this.cache = next;
    this.logger.debug(`Cache refreshed: ${next.size} event(s)`);
  }

  /** Fetch events in the active window from DB. */
  private async fetchActiveWindow(): Promise<CachedEvent[]> {
    const now = new Date();
    const lowerBound = new Date(now.getTime() - LOOKBACK_MS);
    const upperBound = new Date(now.getTime() + LOOKAHEAD_MS);
    const rows = await this.db
      .select({
        id: schema.events.id,
        duration: schema.events.duration,
        extendedUntil: schema.events.extendedUntil,
        cancelledAt: schema.events.cancelledAt,
        isAdHoc: schema.events.isAdHoc,
      })
      .from(schema.events)
      .where(
        and(
          isNull(schema.events.cancelledAt),
          sql`lower(${schema.events.duration}) <= ${upperBound.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${lowerBound.toISOString()}::timestamptz`,
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      startTime: r.duration[0],
      effectiveEndTime: r.extendedUntil ?? r.duration[1],
      cancelledAt: r.cancelledAt,
      isAdHoc: r.isAdHoc,
    }));
  }
}
