import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import {
  fetchWeekSignedUpEvents,
  fetchSignupsPreview,
  fetchOverrides,
  fetchAbsences,
  assembleCompositeView,
} from './game-time-composite.helpers';
import {
  fetchUpcomingSignedUpEvents,
  buildCommittedDbKeys,
} from './game-time-committed.helpers';

// Re-export types for backward compatibility
export type {
  TemplateSlot,
  CompositeSlot,
  EventBlockDescriptor,
  OverrideRecord,
  AbsenceRecord,
  CompositeViewResult,
} from './game-time.types';
import type {
  TemplateSlot,
  AbsenceRecord,
  CompositeViewResult,
} from './game-time.types';

/** TTL for in-memory game-time cache (ms). */
const CACHE_TTL_MS = 2 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Service for managing recurring weekly game time templates (ROK-189).
 */
@Injectable()
export class GameTimeService {
  private readonly logger = new Logger(GameTimeService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  /** Invalidate all cache entries for a user. */
  invalidateUserCache(userId: number): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`game-time:${userId}:`)) this.cache.delete(key);
    }
    this.logger.debug(`Invalidated game-time cache for user ${userId}`);
  }

  /** Get a user's game time template (raw slots, no status). */
  async getTemplate(userId: number): Promise<{ slots: TemplateSlot[] }> {
    const rows = await this.db
      .select({
        dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
        startHour: schema.gameTimeTemplates.startHour,
      })
      .from(schema.gameTimeTemplates)
      .where(eq(schema.gameTimeTemplates.userId, userId));
    return {
      slots: rows.map((r) => ({ dayOfWeek: r.dayOfWeek, hour: r.startHour })),
    };
  }

  /**
   * Replace a user's game time template entirely.
   * Committed-slot preservation: template slots overlapping active event
   * signups are automatically preserved server-side.
   */
  async saveTemplate(
    userId: number,
    slots: TemplateSlot[],
  ): Promise<{ slots: TemplateSlot[] }> {
    const dbSlots = slots.map((s) => ({
      ...s,
      dayOfWeek: (s.dayOfWeek + 6) % 7,
    }));
    const committedDbKeys = await this.getCommittedTemplateKeys(userId);
    const payloadKeys = new Set(dbSlots.map((s) => `${s.dayOfWeek}:${s.hour}`));
    const preservedSlots = committedDbKeys
      .filter((k) => !payloadKeys.has(`${k.dayOfWeek}:${k.hour}`))
      .map((k) => ({ dayOfWeek: k.dayOfWeek, hour: k.hour }));
    const mergedDbSlots = [...dbSlots, ...preservedSlots];
    await this.performTemplateSave(userId, mergedDbSlots);
    await this.updateGameTimeConfirmedAt(userId);
    this.invalidateUserCache(userId);
    const preservedDisplay = preservedSlots.map((s) => ({
      dayOfWeek: (s.dayOfWeek + 1) % 7,
      hour: s.hour,
    }));
    return { slots: [...slots, ...preservedDisplay] };
  }

  /** Persist template slots in a transaction. */
  private async performTemplateSave(
    userId: number,
    mergedDbSlots: Array<{ dayOfWeek: number; hour: number }>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.gameTimeTemplates)
        .where(eq(schema.gameTimeTemplates.userId, userId));
      if (mergedDbSlots.length > 0) {
        const now = new Date();
        await tx.insert(schema.gameTimeTemplates).values(
          mergedDbSlots.map((s) => ({
            userId,
            dayOfWeek: s.dayOfWeek,
            startHour: s.hour,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    });
  }

  /** Get committed template slot keys (DB convention: 0=Mon). */
  private async getCommittedTemplateKeys(
    userId: number,
  ): Promise<Array<{ dayOfWeek: number; hour: number }>> {
    const existingSlots = await this.db
      .select({
        dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
        startHour: schema.gameTimeTemplates.startHour,
      })
      .from(schema.gameTimeTemplates)
      .where(eq(schema.gameTimeTemplates.userId, userId));
    if (existingSlots.length === 0) return [];
    const signedUpEvents = await fetchUpcomingSignedUpEvents(this.db, userId);
    if (signedUpEvents.length === 0) return [];
    const committedKeys = buildCommittedDbKeys(signedUpEvents);
    return existingSlots
      .filter((s) => committedKeys.has(`${s.dayOfWeek}:${s.startHour}`))
      .map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.startHour }));
  }

  /** Save per-hour date-specific overrides (upsert). */
  async saveOverrides(
    userId: number,
    overrides: Array<{ date: string; hour: number; status: string }>,
  ): Promise<void> {
    if (overrides.length === 0) return;
    this.invalidateUserCache(userId);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const o of overrides) {
        await tx
          .insert(schema.gameTimeOverrides)
          .values({
            userId,
            date: o.date,
            hour: o.hour,
            status: o.status,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.gameTimeOverrides.userId,
              schema.gameTimeOverrides.date,
              schema.gameTimeOverrides.hour,
            ],
            set: { status: o.status, updatedAt: now },
          });
      }
    });
  }

  /** Create an absence range. */
  async createAbsence(
    userId: number,
    input: { startDate: string; endDate: string; reason?: string },
  ): Promise<AbsenceRecord> {
    this.invalidateUserCache(userId);
    const now = new Date();
    const [row] = await this.db
      .insert(schema.gameTimeAbsences)
      .values({
        userId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: schema.gameTimeAbsences.id,
        startDate: schema.gameTimeAbsences.startDate,
        endDate: schema.gameTimeAbsences.endDate,
        reason: schema.gameTimeAbsences.reason,
      });
    return row;
  }

  /** Delete an absence. */
  async deleteAbsence(userId: number, absenceId: number): Promise<void> {
    this.invalidateUserCache(userId);
    await this.db
      .delete(schema.gameTimeAbsences)
      .where(
        and(
          eq(schema.gameTimeAbsences.id, absenceId),
          eq(schema.gameTimeAbsences.userId, userId),
        ),
      );
  }

  /** Get all absences for a user. */
  async getAbsences(userId: number): Promise<AbsenceRecord[]> {
    return this.db
      .select({
        id: schema.gameTimeAbsences.id,
        startDate: schema.gameTimeAbsences.startDate,
        endDate: schema.gameTimeAbsences.endDate,
        reason: schema.gameTimeAbsences.reason,
      })
      .from(schema.gameTimeAbsences)
      .where(eq(schema.gameTimeAbsences.userId, userId));
  }

  /** Get composite view: merge template with event commitments, overrides, and absences. */
  async getCompositeView(
    userId: number,
    weekStart: Date,
    tzOffset = 0,
  ): Promise<CompositeViewResult> {
    const cacheKey = `game-time:${userId}:${weekStart.toISOString()}:${tzOffset}`;
    const cached = this.getCached<CompositeViewResult>(cacheKey);
    if (cached) return cached;
    const result = await this.buildCompositeResult(userId, weekStart, tzOffset);
    this.setCache(cacheKey, result);
    return result;
  }

  /** Fetch all data sources for composite view in parallel (including template). */
  private async fetchAllCompositeData(
    userId: number,
    weekStart: Date,
    weekEnd: Date,
  ) {
    const [startDate, endDate] = this.weekDateRange(weekStart, weekEnd);
    return Promise.all([
      this.getTemplate(userId),
      fetchWeekSignedUpEvents(this.db, userId, weekStart, weekEnd),
      fetchOverrides(this.db, userId, startDate, endDate),
      fetchAbsences(this.db, userId, startDate, endDate),
    ]);
  }

  /** Build the composite result from all data sources. */
  private async buildCompositeResult(
    userId: number,
    weekStart: Date,
    tzOffset: number,
  ): Promise<CompositeViewResult> {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const [template, signedUpEvents, overrideRows, absenceRows] =
      await this.fetchAllCompositeData(userId, weekStart, weekEnd);
    const confirmedAt = await this.fetchGameTimeConfirmedAt(userId);
    const remapped = template.slots.map((s) => ({
      ...s,
      dayOfWeek: (s.dayOfWeek + 1) % 7,
    }));
    const signupsMap = await fetchSignupsPreview(this.db, [
      ...new Set(signedUpEvents.map((e) => e.eventId)),
    ]);
    const view = assembleCompositeView(
      remapped,
      signedUpEvents,
      overrideRows,
      absenceRows,
      signupsMap,
      weekStart,
      weekEnd,
      tzOffset,
    );
    return { ...view, gameTimeStale: this.isGameTimeStale(confirmedAt) };
  }

  /** Compute week date range strings for override/absence queries. */
  private weekDateRange(weekStart: Date, weekEnd: Date): [string, string] {
    return [
      weekStart.toISOString().split('T')[0],
      new Date(weekEnd.getTime() - 1).toISOString().split('T')[0],
    ];
  }

  /** Update game_time_confirmed_at to NOW for a user (ROK-999). */
  async updateGameTimeConfirmedAt(userId: number): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ gameTimeConfirmedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  /** Fetch game_time_confirmed_at for a user (ROK-999). */
  async fetchGameTimeConfirmedAt(userId: number): Promise<Date | null> {
    const [row] = await this.db
      .select({ gameTimeConfirmedAt: schema.users.gameTimeConfirmedAt })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row?.gameTimeConfirmedAt ?? null;
  }

  /** Determine if game time is stale (null or > 7 days old) (ROK-999). */
  private isGameTimeStale(confirmedAt: Date | null): boolean {
    if (!confirmedAt) return true;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return confirmedAt < sevenDaysAgo;
  }
}
