import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { buildCompositeViewResult } from './game-time-composite-view.helpers';
import {
  fetchUpcomingSignedUpEvents,
  buildCommittedDbKeys,
} from './game-time-committed.helpers';
import {
  resolveLocalToday,
  fetchAbsencesEndingOnOrAfter,
} from './game-time-absence.helpers';
import { stampGameTimeConfirmedAt } from './game-time-confirmation.helpers';
import { defined } from '../common/defined.helpers';
import { fetchCalendarBusyHours } from '../calendar-sync/read/calendar-busy-query.helpers';
import type { GameTimeCalendarBusy } from '@raid-ledger/contract';
import {
  CALENDAR_READ_QUEUE,
  GAME_TIME_TEMPLATE_SAVED_EVENT,
} from '../calendar-sync/calendar-sync.constants';
import { enqueueCalendarDerive } from '../calendar-sync/read/calendar-read.enqueue.helpers';
import {
  deleteManualAbsence,
  ignoreCalendarAbsence,
} from './game-time-absence-ignore.helpers';

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

/** Composite view plus the viewer's own synced-calendar busy hours (ROK-1593). */
type CompositeViewWithCalendar = CompositeViewResult & {
  calendarBusy?: GameTimeCalendarBusy[];
};

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
    @InjectQueue(CALENDAR_READ_QUEUE)
    private readonly calendarReadQueue: Queue,
    private readonly events: EventEmitter2,
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
    // ROK-1593 D16: committed — synced away days (Rule B) follow the template.
    this.events.emit(GAME_TIME_TEMPLATE_SAVED_EVENT, { userId });
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
    // "I'm away some days" answers the game-time check too (ROK-1564).
    await this.updateGameTimeConfirmedAt(userId);
    this.invalidateUserCache(userId); // after the insert + stamp (review MINOR a)
    await this.enqueueDerive(userId); // Q-D: a manual day hides a synced one
    // Same shape as the list read model (ROK-1593 NIT-1): a created row is manual.
    return { ...defined(row, 'inserted absence row'), source: 'manual' };
  }

  /** Delete a manual absence; a synced one → 409 `use_ignore` (ROK-1593). */
  async deleteAbsence(userId: number, absenceId: number): Promise<void> {
    this.invalidateUserCache(userId);
    await deleteManualAbsence(this.db, userId, absenceId);
    await this.enqueueDerive(userId); // Q-D: a synced day may come back
  }

  /**
   * Ignore a synced calendar absence (ROK-1593): the row goes and its dates
   * stay ignored. The derive re-runs so a neighbouring merged range is
   * rebuilt; a queue failure is logged, not surfaced — the Ignore committed.
   */
  async ignoreAbsence(userId: number, absenceId: number): Promise<void> {
    await ignoreCalendarAbsence(this.db, userId, absenceId);
    this.invalidateUserCache(userId);
    await this.enqueueDerive(userId);
  }

  /** Re-derive synced away days; a queue failure is logged, never surfaced. */
  private async enqueueDerive(userId: number): Promise<void> {
    await enqueueCalendarDerive(this.calendarReadQueue, userId).catch(
      (err: unknown) =>
        this.logger.warn(
          `derive enqueue failed for user ${userId}: ${String(err)}`,
        ),
    );
  }

  /**
   * Get a user's current + future absences for the absence list (ROK-1427).
   *
   * Expired absences are filtered out at query time (never deleted) using
   * "today" in the caller's timezone; `end_date` is inclusive. The composite
   * view uses its own week-bounded query and still sees past absences.
   */
  async getAbsences(
    userId: number,
    tzOffset: number,
  ): Promise<AbsenceRecord[]> {
    const today = resolveLocalToday(tzOffset);
    return fetchAbsencesEndingOnOrAfter(this.db, userId, today);
  }

  /** Get composite view: merge template with event commitments, overrides, and absences. */
  async getCompositeView(
    userId: number,
    weekStart: Date,
    tzOffset = 0,
  ): Promise<CompositeViewWithCalendar> {
    const cacheKey = `game-time:${userId}:${weekStart.toISOString()}:${tzOffset}`;
    const cached = this.getCached<CompositeViewWithCalendar>(cacheKey);
    if (cached) return cached;
    const view = await buildCompositeViewResult(
      this.db,
      (id) => this.getTemplate(id),
      userId,
      weekStart,
      tzOffset,
    );
    // ROK-1593 D15: a separate field — never folded into slot status.
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const calendarBusy = await fetchCalendarBusyHours(
      this.db,
      userId,
      weekStart,
      weekEnd,
      tzOffset,
    );
    const result = calendarBusy.length > 0 ? { ...view, calendarBusy } : view;
    this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Confirm the viewer's game time is still accurate WITHOUT writing a
   * template (ROK-1564). Stale means unconfirmed, not unedited, so the
   * "Looks right" answer only refreshes the timestamp.
   */
  async confirmGameTime(userId: number): Promise<{ confirmedAt: Date }> {
    const confirmedAt = await stampGameTimeConfirmedAt(this.db, userId);
    // Invalidate AFTER the write: a GET racing an invalidate-then-write would
    // re-cache `gameTimeStale: true` for the cache TTL (review MINOR a).
    this.invalidateUserCache(userId);
    return { confirmedAt };
  }

  /** Stamp game_time_confirmed_at to NOW for a user (ROK-999). */
  private async updateGameTimeConfirmedAt(userId: number): Promise<void> {
    await stampGameTimeConfirmedAt(this.db, userId);
  }
}
